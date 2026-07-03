import time
from collections.abc import AsyncIterator
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.collect import build_source
from app.agents.models import ProviderNotImplemented, build_model
from app.agents.pipeline import build_pipeline
from app.auth.middleware import verify_request
from app.core.budget import BudgetTier, check_budget_tier, current_month_key
from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.pricing import estimate_cost_usd
from app.schemas.events import sse
from app.schemas.requests import NoteRequest
from app.store.firestore import get_methodology, get_prompt_template, record_usage

import logging

from app.core.logging import log_event

logger = logging.getLogger("app.notes")

_FALLBACK_SYSTEM = "你是專業的學習筆記整理者，輸出繁體中文 Markdown。"
_BUDGET_EXCEEDED_MESSAGE = "本月預算已用盡，暫時無法產生新筆記，請稍後再試。"

router = APIRouter()
_APP_NAME = "take-note"
_USER = "owner"


async def _drive_adk(agent, initial_state: dict) -> AsyncIterator:
    """跑 ADK Runner，yield 原始 event。⚠️ event 屬性名（author/partial/
    content.parts/grounding_metadata/is_final_response/usage_metadata）依 ADK 文件確認，
    尤其 usage_metadata 是否為每步驟累計值或逐則差值——見 cost-monitoring spec 的
    Token 用量估算章節，實作時務必對照真實 ADK 事件驗證，不可假設。"""
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name=_APP_NAME, user_id=_USER, state=initial_state)
    runner = Runner(app_name=_APP_NAME, agent=agent, session_service=session_service)
    msg = types.Content(role="user", parts=[types.Part(text="開始整理筆記")])
    run_config = RunConfig(streaming_mode=StreamingMode.SSE)
    async for event in runner.run_async(
        user_id=_USER, session_id=session.id, new_message=msg, run_config=run_config):
        yield event


def _accumulate_usage(last_usage_by_step: dict, author: str, event) -> None:
    # Overwrites (not adds) per author/step, assuming usage_metadata is a
    # cumulative-per-turn value (⚠️ unverified, see _drive_adk's docstring).
    usage = getattr(event, "usage_metadata", None)
    if usage is not None and author:
        last_usage_by_step[author] = usage


def _sum_token_usage(last_usage_by_step: dict) -> tuple[int, int]:
    prompt_tokens = 0
    output_tokens = 0
    for usage in last_usage_by_step.values():
        prompt_tokens += getattr(usage, "prompt_token_count", None) or 0
        output_tokens += getattr(usage, "candidates_token_count", None) or 0
    return prompt_tokens, output_tokens


def _record_usage_safely(model_id: str, prompt_tokens: int, output_tokens: int) -> float | None:
    cost_usd = estimate_cost_usd(model_id, prompt_tokens, output_tokens)
    try:
        record_usage(current_month_key(), cost_usd=cost_usd or 0.0,
                    prompt_tokens=prompt_tokens, output_tokens=output_tokens)
    except Exception as exc:
        # The generation already happened and was already streamed to the
        # client — a bookkeeping write failure must never surface as a client
        # error. Logged individually every time, so a sustained outage is a
        # sustained stream of these, not one silently forgotten failure.
        log_event(logger, logging.ERROR, "budget_increment_failed",
                 error_message=str(exc), cost_usd=cost_usd,
                 prompt_tokens=prompt_tokens, output_tokens=output_tokens)
    return cost_usd


async def run_pipeline(req: NoteRequest, methodology, settings) -> AsyncIterator[str]:
    start = time.monotonic()
    if methodology is None:
        log_event(logger, logging.WARNING, "pipeline_error", code="methodology_not_found")
        yield sse("error", {"code": "methodology_not_found", "message": req.methodology_id})
        return

    # check_budget_tier() itself already logs "budget_check_unavailable" (with
    # error_message) on both its fail-open paths — don't log it again here,
    # or every fail-open produces two log lines for the same event, which
    # would double-count in the log-based metric built on this event name.
    tier, _usage_unavailable = check_budget_tier(settings)
    if tier == BudgetTier.BLOCK:
        log_event(logger, logging.WARNING, "pipeline_blocked", reason="budget_block")
        yield sse("error", {"code": "budget_exceeded", "message": _BUDGET_EXCEEDED_MESSAGE})
        return

    effective_web_search = req.web_search
    if tier == BudgetTier.DEGRADE_WEB_SEARCH:
        effective_web_search = False
        log_event(logger, logging.INFO, "pipeline_degraded", reason="budget_degrade")

    try:
        tmpl = get_prompt_template("global-style")
        system = (tmpl or {}).get("system") or _FALLBACK_SYSTEM
    except Exception:
        # Firestore transient/permission failure → degrade gracefully to the
        # built-in system prompt rather than failing the whole request.
        system = _FALLBACK_SYSTEM
    try:
        agent = build_pipeline(methodology, req.mode.value, req.provider,
                               req.model, effective_web_search, system)
    except ProviderNotImplemented as exc:
        log_event(logger, logging.WARNING, "pipeline_error", code="provider_not_implemented")
        yield sse("error", {"code": "provider_not_implemented", "message": str(exc)})
        return
    model_id = build_model(req.provider, req.model)
    initial_state = {
        "source": build_source(req.content),
        "direction": req.direction,
        "extra": req.extra_requirements or "",
        "date": datetime.now(ZoneInfo("Asia/Taipei")).date().isoformat(),
    }

    final_markdown = ""
    last_author = None
    last_usage_by_step: dict = {}
    try:
        async for event in _drive_adk(agent, initial_state):
            author = getattr(event, "author", "")
            _accumulate_usage(last_usage_by_step, author, event)
            if author != last_author and author.startswith("step_"):
                if last_author:
                    step_name = last_author.removeprefix("step_")
                    log_event(logger, logging.INFO, "pipeline_step", step=step_name, status="done")
                    yield sse("step", {"step": step_name,
                                       "status": "done", "summary": None})
                step_name = author.removeprefix("step_")
                log_event(logger, logging.INFO, "pipeline_step", step=step_name, status="start")
                yield sse("step", {"step": step_name, "status": "start"})
                last_author = author
            gm = getattr(event, "grounding_metadata", None)
            if gm:
                items = _citations_from(gm)
                if items:
                    yield sse("citations", {"items": items})
            if author == "step_format":
                text = ""
                content = getattr(event, "content", None)
                parts = getattr(content, "parts", None)
                if parts:
                    text = "".join(getattr(p, "text", None) or "" for p in parts)
                if getattr(event, "partial", False) and text:
                    yield sse("delta", {"text": text})
                elif event.is_final_response() and text:
                    final_markdown = text
        if last_author:
            step_name = last_author.removeprefix("step_")
            log_event(logger, logging.INFO, "pipeline_step", step=step_name, status="done")
            yield sse("step", {"step": step_name, "status": "done", "summary": None})
        prompt_tokens, output_tokens = _sum_token_usage(last_usage_by_step)
        cost_usd = _record_usage_safely(model_id, prompt_tokens, output_tokens)
        # Deliberately logs effective_web_search (what actually ran), not
        # req.web_search (what the client asked for) — under DEGRADE these
        # differ, and this field exists to recalibrate the token-only cost
        # estimate against real per-call grounding cost, so it must reflect
        # whether grounding actually happened. The original client intent is
        # still recoverable from the separate pipeline_degraded log event.
        log_event(logger, logging.INFO, "pipeline_done", markdown_chars=len(final_markdown),
                 elapsed_ms=round((time.monotonic() - start) * 1000, 1),
                 prompt_tokens=prompt_tokens, output_tokens=output_tokens,
                 estimated_cost_usd=cost_usd, web_search_used=effective_web_search)
        yield sse("done", {"markdown": final_markdown})
    except Exception as exc:  # provider/runtime 錯誤 → error 事件，保留已串內容
        prompt_tokens, output_tokens = _sum_token_usage(last_usage_by_step)
        _record_usage_safely(model_id, prompt_tokens, output_tokens)
        log_event(logger, logging.ERROR, "pipeline_error", code="provider_error",
                 error_message=str(exc))
        yield sse("error", {"code": "provider_error", "message": str(exc)})


def _citations_from(gm) -> list[dict]:
    items = []
    for chunk in getattr(gm, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        if web:
            items.append({"title": getattr(web, "title", ""), "url": getattr(web, "uri", "")})
    return items


@router.post("/notes/stream")
@limiter.limit(get_settings().rate_limit_per_minute)
async def notes_stream(request: Request, req: NoteRequest, _email: str = Depends(verify_request)):
    settings = get_settings()
    if len(req.content.text.strip()) < settings.min_content_chars:
        raise HTTPException(status_code=422, detail="content too short")
    methodology = get_methodology(req.methodology_id)
    if methodology is not None and req.category.value not in (methodology.get("categories") or []):
        raise HTTPException(status_code=422, detail="category not allowed for methodology")
    return StreamingResponse(run_pipeline(req, methodology, settings),
                             media_type="text/event-stream")
