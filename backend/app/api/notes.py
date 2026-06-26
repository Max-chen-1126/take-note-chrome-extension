from collections.abc import AsyncIterator
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.collect import build_source
from app.agents.models import ProviderNotImplemented
from app.agents.pipeline import build_pipeline
from app.auth.middleware import verify_request
from app.core.config import get_settings
from app.schemas.events import sse
from app.schemas.requests import NoteRequest
from app.store.firestore import get_methodology, get_prompt_template

_FALLBACK_SYSTEM = "你是專業的學習筆記整理者，輸出繁體中文 Markdown。"

router = APIRouter()
_APP_NAME = "take-note"
_USER = "owner"


async def _drive_adk(agent, initial_state: dict) -> AsyncIterator:
    """跑 ADK Runner，yield 原始 event。⚠️ event 屬性名（author/partial/
    content.parts/grounding_metadata/is_final_response）依 ADK 文件確認。"""
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name=_APP_NAME, user_id=_USER, state=initial_state)
    runner = Runner(app_name=_APP_NAME, agent=agent, session_service=session_service)
    msg = types.Content(role="user", parts=[types.Part(text="開始整理筆記")])
    run_config = RunConfig(streaming_mode=StreamingMode.SSE)
    async for event in runner.run_async(
        user_id=_USER, session_id=session.id, new_message=msg, run_config=run_config):
        yield event


async def run_pipeline(req: NoteRequest, methodology, settings) -> AsyncIterator[str]:
    if methodology is None:
        yield sse("error", {"code": "methodology_not_found", "message": req.methodology_id})
        return

    tmpl = get_prompt_template("global-style")
    system = (tmpl or {}).get("system") or _FALLBACK_SYSTEM
    try:
        agent = build_pipeline(methodology, req.mode.value, req.provider,
                               req.model, req.web_search, system)
    except ProviderNotImplemented as exc:
        yield sse("error", {"code": "provider_not_implemented", "message": str(exc)})
        return
    initial_state = {
        "source": build_source(req.content),
        "direction": req.direction,
        "extra": req.extra_requirements or "",
        "date": datetime.now(ZoneInfo("Asia/Taipei")).date().isoformat(),
    }

    final_markdown = ""
    last_author = None
    try:
        async for event in _drive_adk(agent, initial_state):
            author = getattr(event, "author", "")
            if author != last_author and author.startswith("step_"):
                if last_author:
                    yield sse("step", {"step": last_author.removeprefix("step_"),
                                       "status": "done", "summary": None})
                yield sse("step", {"step": author.removeprefix("step_"), "status": "start"})
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
            yield sse("step", {"step": last_author.removeprefix("step_"),
                               "status": "done", "summary": None})
        yield sse("done", {"markdown": final_markdown})
    except Exception as exc:  # provider/runtime 錯誤 → error 事件，保留已串內容
        yield sse("error", {"code": "provider_error", "message": str(exc)})


def _citations_from(gm) -> list[dict]:
    items = []
    for chunk in getattr(gm, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        if web:
            items.append({"title": getattr(web, "title", ""), "url": getattr(web, "uri", "")})
    return items


@router.post("/notes/stream")
async def notes_stream(req: NoteRequest, _email: str = Depends(verify_request)):
    settings = get_settings()
    if len(req.content.text.strip()) < settings.min_content_chars:
        raise HTTPException(status_code=422, detail="content too short")
    methodology = get_methodology(req.methodology_id)
    if methodology is not None and req.category.value not in (methodology.get("categories") or []):
        raise HTTPException(status_code=422, detail="category not allowed for methodology")
    return StreamingResponse(run_pipeline(req, methodology, settings),
                             media_type="text/event-stream")
