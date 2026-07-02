# Backend Observability, Stability & Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `take-note-backend` FastAPI/Cloud Run service structured logging, GCP-native monitoring/alerting, CI/CD, a rate-limiter correctness guard, wired-up context hygiene, and a resolved IAP edge-auth question — without adding multi-provider support, per-user quotas, or any frontend change (those are separate sub-projects).

**Architecture:** No new services or major dependencies. Logging is stdlib `logging` + a JSON formatter writing to stdout (Cloud Run auto-captures to Cloud Logging). CI/CD is GitHub Actions wrapping the existing `uv`/`pytest`/`gcloud run deploy` toolchain. Monitoring is `gcloud` scripts consistent with the repo's existing manual-infra style (`infra/budget-kill-switch/`). All app-code changes follow the existing FastAPI + pydantic-settings + pytest patterns already in `backend/`.

**Tech Stack:** Python 3.12, FastAPI, pydantic-settings, slowapi, pytest/pytest-asyncio, uv, GitHub Actions, gcloud CLI (Cloud Logging / Cloud Monitoring / Cloud Run / IAM).

## Global Constraints

- Python `>=3.12`; dependency management via `uv` (`pyproject.toml` + `uv.lock`) — never hand-edit `uv.lock`, run `uv sync`/`uv add`.
- GCP project `max-personal-447802`, region `asia-east1`, Cloud Run service name `take-note-backend` (per `spec/backend-spec.md` §14).
- No Terraform / IaC — this repo's infra style is documented `gcloud` scripts + a README runbook for manual one-time steps (see `infra/budget-kill-switch/`). New infra work in this plan follows the same style.
- No new paid tooling — logging/monitoring must use Cloud Logging/Cloud Monitoring's free tier (already implicitly covered by the project's GCP billing), no external SaaS.
- Structured logs must never contain: raw ID tokens, full request bodies, raw Firestore document contents, or full generated Markdown. Log shape/size (e.g. char counts), not raw user content.
- `EXPECTED_MAX_INSTANCES` must stay `1` until the rate limiter is migrated off in-memory storage — this plan does not do that migration; a settings validator enforces it.
- `generate_config()` / Gemini thinking-budget wiring is explicitly **out of scope** for this plan (deferred to the cost sub-project). Do not wire it up here.
- Follow existing test conventions: `backend/tests/{unit,agents,api,bdd}/`, `pytest-asyncio` with `asyncio_mode = "auto"`, `monkeypatch` + `cfg.get_settings.cache_clear()` for settings-dependent tests (see `backend/tests/unit/test_config.py`).

---

### Task 1: Wire `hygiene.py` into the agent pipeline

**Files:**
- Modify: `backend/app/agents/pipeline.py`
- Test: `backend/tests/agents/test_pipeline.py`

**Interfaces:**
- Consumes: `app.core.hygiene.resolve(text: str, overrides: dict[str, str] | None = None) -> str` (already implemented, unchanged).
- Produces: no new public symbols — `build_pipeline()` signature is unchanged; its output `LlmAgent.instruction` strings now have `[[VAR]]` placeholders resolved.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/agents/test_pipeline.py`:

```python
def test_hygiene_placeholder_resolved(monkeypatch):
    monkeypatch.setenv("FOO", "bar")
    m = _methodology()
    m["steps"]["structure"]["instruction"] = {"concise": "use [[FOO]]", "detailed": "d"}
    agent = build_pipeline(m, "concise", Provider.gemini, None, False, "SYS")
    step = next(a for a in agent.sub_agents if a.name == "step_structure")
    assert "use bar" in step.instruction
    assert "[[FOO]]" not in step.instruction


def test_hygiene_unresolved_var_blanks_not_leaks_placeholder(monkeypatch):
    monkeypatch.delenv("MISSING_VAR", raising=False)
    m = _methodology()
    m["steps"]["structure"]["instruction"] = {"concise": "id=[[MISSING_VAR]]", "detailed": "d"}
    agent = build_pipeline(m, "concise", Provider.gemini, None, False, "SYS")
    step = next(a for a in agent.sub_agents if a.name == "step_structure")
    assert "[[MISSING_VAR]]" not in step.instruction
    assert "id=" in step.instruction
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/agents/test_pipeline.py -v`
Expected: the two new tests FAIL (placeholders not resolved yet); the three pre-existing tests still PASS.

- [ ] **Step 3: Implement the minimal change**

In `backend/app/agents/pipeline.py`, add the import and call `resolve()` on the assembled instruction before constructing `LlmAgent`:

```python
from google.adk.agents import LlmAgent, SequentialAgent

from app.agents.models import build_model
from app.agents.tools import web_search_tools
from app.core.hygiene import resolve as resolve_hygiene
from app.schemas.requests import Provider
```

Then, inside the `for name in STEP_ORDER:` loop in `build_pipeline`, right after the `output_contract` block and before `sub_agents.append(...)`:

```python
        contract = cfg.get("output_contract")
        if name == "format" and contract:
            instruction = f"{instruction}\n\n# 輸出規範（嚴格遵守）\n{contract}"
        instruction = resolve_hygiene(instruction)
        sub_agents.append(LlmAgent(
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/agents/test_pipeline.py -v`
Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/pipeline.py backend/tests/agents/test_pipeline.py
git commit -m "feat(backend): wire hygiene [[VAR]] resolver into pipeline instructions"
```

---

### Task 2: Rate limiter startup guard (`expected_max_instances`)

**Files:**
- Modify: `backend/app/core/config.py`
- Test: `backend/tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.expected_max_instances: int` (default `1`), enforced by a `model_validator` — later tasks (Task 5's deploy workflow) set this via `EXPECTED_MAX_INSTANCES` env var alongside `--max-instances`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/unit/test_config.py`:

```python
def test_expected_max_instances_default_is_one(monkeypatch):
    monkeypatch.delenv("EXPECTED_MAX_INSTANCES", raising=False)
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().expected_max_instances == 1


def test_expected_max_instances_above_one_raises(monkeypatch):
    monkeypatch.setenv("EXPECTED_MAX_INSTANCES", "2")
    cfg.get_settings.cache_clear()
    with pytest.raises(ValueError):
        cfg.get_settings()
    monkeypatch.delenv("EXPECTED_MAX_INSTANCES", raising=False)
    cfg.get_settings.cache_clear()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_config.py -v`
Expected: `test_expected_max_instances_default_is_one` FAILs with `AttributeError` (field doesn't exist); `test_expected_max_instances_above_one_raises` FAILs (no error raised).

- [ ] **Step 3: Implement the minimal change**

In `backend/app/core/config.py`, add the field after `max_body_bytes`:

```python
    max_body_bytes: int = 4_000_000   # 早期拒絕過大請求 body（413）
    expected_max_instances: int = 1   # 見 §rate limiter guard：in-memory limiter 僅在單一實例下正確
```

And add a second validator after `_require_oauth_client_id_on_cloud_run`:

```python
    @model_validator(mode="after")
    def _require_single_instance_for_in_memory_limiter(self) -> "Settings":
        # backend/app/core/limiter.py 用 slowapi 的 in-memory storage，只有在
        # 剛好一個 Cloud Run 實例時才是正確的 per-IP 上限。若要調高
        # max-instances，必須先把 limiter 換成分散式儲存（如
        # Redis/Memorystore），而不是默默調高這個值。
        if self.expected_max_instances != 1:
            raise ValueError(
                "expected_max_instances must stay 1 until the rate limiter is "
                "migrated off in-memory storage (see backend/app/core/limiter.py)."
            )
        return self
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_config.py -v`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/tests/unit/test_config.py
git commit -m "feat(backend): fail fast if max-instances would break the in-memory rate limiter"
```

---

### Task 3: Structured JSON logging

**Files:**
- Create: `backend/app/core/logging.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/auth/middleware.py`
- Modify: `backend/app/api/notes.py`
- Test: `backend/tests/unit/test_logging.py` (new)
- Test: `backend/tests/unit/test_request_logging.py` (new)
- Test: `backend/tests/unit/test_auth.py` (modify)
- Test: `backend/tests/api/test_notes.py` (modify)

**Interfaces:**
- Produces: `app.core.logging.configure_logging() -> None`, `app.core.logging.log_event(logger: logging.Logger, level: int, message: str, **fields) -> None`, `app.core.logging.request_id_var: contextvars.ContextVar[str]`. Every log record `log_event` emits carries a `.fields` dict attribute (used by tests) and renders as one JSON line with keys `severity`, `message`, `logger`, `request_id`, plus whatever's in `fields`.
- Consumes (Task 1/2 unaffected): nothing new from earlier tasks.

- [ ] **Step 1: Write the failing tests for the logging module**

Create `backend/tests/unit/test_logging.py`:

```python
import json
import logging

from app.core.logging import _JsonFormatter, log_event, request_id_var


def test_json_formatter_includes_request_id_and_fields():
    token = request_id_var.set("req-123")
    try:
        logger = logging.getLogger("test.logging")
        record = logger.makeRecord(
            "test.logging", logging.INFO, __file__, 0, "hello", (), None,
        )
        record.fields = {"status_code": 200}
        line = _JsonFormatter().format(record)
    finally:
        request_id_var.reset(token)
    data = json.loads(line)
    assert data["message"] == "hello"
    assert data["request_id"] == "req-123"
    assert data["status_code"] == 200
    assert data["severity"] == "INFO"


def test_log_event_attaches_fields_to_record(caplog):
    logger = logging.getLogger("test.logging.event")
    with caplog.at_level(logging.INFO, logger="test.logging.event"):
        log_event(logger, logging.INFO, "auth_denied", status_code=401)
    assert any(getattr(r, "fields", None) == {"status_code": 401} for r in caplog.records)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_logging.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.logging'`.

- [ ] **Step 3: Implement `backend/app/core/logging.py`**

```python
"""Structured JSON logging.

Cloud Run captures container stdout into Cloud Logging automatically, so this
module only needs to emit one JSON object per line — no exporter/handler
config beyond stdout. Callers of `log_event` are responsible for redaction:
never pass raw ID tokens, full request bodies, or full generated Markdown
into `fields` — log shape/size (e.g. char counts), not raw user content.
"""

import contextvars
import json
import logging
import sys

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "request_id": request_id_var.get(),
        }
        payload.update(getattr(record, "fields", None) or {})
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    """Install the JSON formatter on the root logger. Call once at startup."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


def log_event(logger: logging.Logger, level: int, message: str, **fields) -> None:
    """Log one structured event with arbitrary `fields` attached."""
    logger.log(level, message, extra={"fields": fields})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_logging.py -v`
Expected: PASS.

- [ ] **Step 5: Commit the logging module**

```bash
git add backend/app/core/logging.py backend/tests/unit/test_logging.py
git commit -m "feat(backend): add structured JSON logging module"
```

- [ ] **Step 6: Write the failing test for request-level logging**

Create `backend/tests/unit/test_request_logging.py`:

```python
import logging

from fastapi.testclient import TestClient

from app.main import app


def test_request_logged_with_status_and_request_id(caplog):
    client = TestClient(app)
    with caplog.at_level(logging.INFO, logger="app.request"):
        resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.headers["X-Request-Id"]
    events = [
        r for r in caplog.records
        if getattr(r, "fields", None) and r.fields.get("path") == "/healthz"
    ]
    assert events and events[0].fields["status_code"] == 200
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_request_logging.py -v`
Expected: FAIL — no `X-Request-Id` header, no matching log record.

- [ ] **Step 8: Wire request logging into `backend/app/main.py`**

Replace the top of the file (imports through `logging.basicConfig`) and add the new middleware. Full new file content:

```python
import logging
import os
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import health, methodologies, notes
from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.logging import configure_logging, log_event, request_id_var

configure_logging()
logger = logging.getLogger("app.request")


# Hide API docs/schema in production (Cloud Run sets K_SERVICE) to shrink the
# attack surface; keep them in local dev for convenience.
def docs_kwargs(in_cloud_run: bool) -> dict:
    if in_cloud_run:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


app = FastAPI(title="take-note-backend", **docs_kwargs(bool(os.environ.get("K_SERVICE"))))
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def _reject_oversized_body(request: Request, call_next):
    # Reject obviously-oversized requests by Content-Length BEFORE routing/auth,
    # so a giant body can't waste memory or work. Streaming SSE responses are
    # unaffected (this only inspects the request).
    max_bytes = get_settings().max_body_bytes
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError:
            # A present-but-non-integer Content-Length is malformed; reject it
            # rather than skipping the size check (which it could otherwise bypass).
            return JSONResponse(
                status_code=400, content={"detail": "invalid Content-Length header"}
            )
        if declared > max_bytes:
            return JSONResponse(
                status_code=413, content={"detail": "request body too large"}
            )
    return await call_next(request)


app.add_middleware(SlowAPIMiddleware)


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    # Registered last so it's the outermost middleware layer (Starlette builds
    # its stack in reverse registration order) — this lets it see the final
    # status code even for 413s/429s raised by the middlewares above.
    token = request_id_var.set(uuid.uuid4().hex[:12])
    start = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        log_event(logger, logging.ERROR, "request_failed",
                  method=request.method, path=request.url.path,
                  latency_ms=round((time.monotonic() - start) * 1000, 1))
        request_id_var.reset(token)
        raise
    log_event(logger, logging.INFO, "request_completed",
             method=request.method, path=request.url.path,
             status_code=response.status_code,
             latency_ms=round((time.monotonic() - start) * 1000, 1))
    response.headers["X-Request-Id"] = request_id_var.get()
    request_id_var.reset(token)
    return response


app.include_router(health.router)
app.include_router(methodologies.router)
app.include_router(notes.router)
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_request_logging.py -v`
Expected: PASS.

- [ ] **Step 10: Run the full existing suite to check for regressions**

Run: `cd backend && uv run pytest -v`
Expected: PASS (no regressions in `test_protection.py`'s 413/429 tests or any other existing test).

- [ ] **Step 11: Commit request logging**

```bash
git add backend/app/main.py backend/tests/unit/test_request_logging.py
git commit -m "feat(backend): log every request as structured JSON with a request id"
```

- [ ] **Step 12: Write the failing test for auth-denial logging**

Add to `backend/tests/unit/test_auth.py` (add `import logging` at the top alongside the existing imports):

```python
def test_denied_403_logs_auth_denied_event(monkeypatch, caplog):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    monkeypatch.setattr(mw.id_token, "verify_oauth2_token",
                        lambda *a, **k: {"email": "bad@x.com"})
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        with pytest.raises(HTTPException):
            mw.verify_request(_req({"Authorization": "Bearer t"}))
    events = [r for r in caplog.records if getattr(r, "fields", None)]
    assert any(r.fields.get("status_code") == 403 and r.fields.get("email") == "bad@x.com"
              for r in events)
```

- [ ] **Step 13: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_auth.py -v`
Expected: `test_denied_403_logs_auth_denied_event` FAILs (no log event emitted yet).

- [ ] **Step 14: Wire logging into `backend/app/auth/middleware.py`**

Full new file content:

```python
import logging

from fastapi import HTTPException, Request
from google.auth.transport import requests as ga_requests
from google.oauth2 import id_token

from app.core.config import get_settings
from app.core.logging import log_event

logger = logging.getLogger("app.auth")

_transport = ga_requests.Request()


def verify_request(request: Request) -> str:
    settings = get_settings()
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=401, reason="missing_bearer_token")
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = auth.split(" ", 1)[1]
    try:
        claims = id_token.verify_oauth2_token(
            token, _transport, audience=settings.oauth_client_id or None
        )
    except ValueError as exc:
        # google.oauth2.id_token.verify_oauth2_token 對無效/過期/格式錯誤的
        # token 一律拋 ValueError；其他例外（例如網路或憑證取得失敗）不應
        # 冒充成「無效 token」的 401，讓它往外傳並變成 500。
        logger.warning("ID token verification failed: %s", exc)
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=401, reason="invalid_token")
        raise HTTPException(status_code=401, detail="invalid token")
    email = claims.get("email")
    if not email or email not in settings.allowed_email_set:
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=403, reason="not_allowlisted", email=email or "")
        raise HTTPException(status_code=403, detail="forbidden")
    return email
```

- [ ] **Step 15: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_auth.py -v`
Expected: PASS (all tests green).

- [ ] **Step 16: Commit auth logging**

```bash
git add backend/app/auth/middleware.py backend/tests/unit/test_auth.py
git commit -m "feat(backend): log structured auth_denied events on 401/403"
```

- [ ] **Step 17: Write the failing test for pipeline step logging**

Add to `backend/tests/api/test_notes.py` (add `import logging` at the top):

```python
@pytest.mark.asyncio
async def test_pipeline_logs_step_and_done_events(monkeypatch, caplog):
    methodology = {"categories": ["youtube"],
                   "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                             for s in ["structure", "draft", "augment", "verify", "format"]}}

    async def fake_events():
        from types import SimpleNamespace as N
        for s in ["structure", "draft", "augment", "verify"]:
            yield N(author=f"step_{s}", partial=False, content=N(parts=[N(text="ok")]),
                    grounding_metadata=None, is_final_response=lambda: False)
        yield N(author="step_format", partial=False, content=N(parts=[N(text="done")]),
                grounding_metadata=None, is_final_response=lambda: True)

    monkeypatch.setattr(notes, "_drive_adk", lambda *a, **k: fake_events())
    with caplog.at_level(logging.INFO, logger="app.notes"):
        "".join([c async for c in notes.run_pipeline(_req(), methodology, notes.get_settings())])
    steps_seen = [r.fields["step"] for r in caplog.records
                 if getattr(r, "fields", None) and "step" in r.fields]
    assert "structure" in steps_seen
    assert "format" in steps_seen
```

- [ ] **Step 18: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/api/test_notes.py -v`
Expected: `test_pipeline_logs_step_and_done_events` FAILs (no log records with a `step` field).

- [ ] **Step 19: Wire logging into `backend/app/api/notes.py`**

Add the import (after the existing `from app.store.firestore import ...` line):

```python
import logging

from app.core.logging import log_event

logger = logging.getLogger("app.notes")
```

Then update `run_pipeline` — replace its body with (unchanged lines omitted for brevity are marked `# ... unchanged ...`; apply these as targeted edits to the existing function):

```python
async def run_pipeline(req: NoteRequest, methodology, settings) -> AsyncIterator[str]:
    if methodology is None:
        log_event(logger, logging.WARNING, "pipeline_error", code="methodology_not_found")
        yield sse("error", {"code": "methodology_not_found", "message": req.methodology_id})
        return

    try:
        tmpl = get_prompt_template("global-style")
        system = (tmpl or {}).get("system") or _FALLBACK_SYSTEM
    except Exception:
        system = _FALLBACK_SYSTEM
    try:
        agent = build_pipeline(methodology, req.mode.value, req.provider,
                               req.model, req.web_search, system)
    except ProviderNotImplemented as exc:
        log_event(logger, logging.WARNING, "pipeline_error", code="provider_not_implemented")
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
        log_event(logger, logging.INFO, "pipeline_done", markdown_chars=len(final_markdown))
        yield sse("done", {"markdown": final_markdown})
    except Exception as exc:  # provider/runtime 錯誤 → error 事件，保留已串內容
        log_event(logger, logging.ERROR, "pipeline_error", code="provider_error", message=str(exc))
        yield sse("error", {"code": "provider_error", "message": str(exc)})
```

- [ ] **Step 20: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/test_notes.py -v`
Expected: PASS (all tests green).

- [ ] **Step 21: Run the full suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS, no regressions.

- [ ] **Step 22: Commit pipeline logging**

```bash
git add backend/app/api/notes.py backend/tests/api/test_notes.py
git commit -m "feat(backend): log structured pipeline_step/pipeline_error/pipeline_done events"
```

---

### Task 4: CI workflow (lint + test gate)

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `.github/workflows/backend-ci.yml`

**Interfaces:** none (infra-only task).

- [ ] **Step 1: Add ruff as a dev dependency**

In `backend/pyproject.toml`, update the `[dependency-groups]` block:

```toml
[dependency-groups]
dev = [
    "httpx>=0.28.1",
    "pytest>=9.1.1",
    "pytest-asyncio>=1.4.0",
    "pytest-bdd>=8.1.0",
    "ruff>=0.9.0",
]
```

Add a minimal ruff config at the end of the file:

```toml
[tool.ruff]
line-length = 100
```

Run: `cd backend && uv sync --all-groups`
Expected: `ruff` installed, `uv.lock` updated.

- [ ] **Step 2: Run ruff and fix any reported violations**

Run: `cd backend && uv run ruff check .`
Expected: ruff reports violations (if any) against the existing codebase (default rule set: pyflakes + basic pycodestyle). Fix each reported violation in place (e.g. unused imports, obvious style issues) until the command exits 0. Do not change behavior — only fix what ruff flags.

Run: `cd backend && uv run ruff check .`
Expected: PASS (no output, exit code 0).

- [ ] **Step 3: Run the full test suite to confirm nothing broke from lint fixes**

Run: `cd backend && uv run pytest -v`
Expected: PASS.

- [ ] **Step 4: Commit lint setup**

```bash
git add backend/pyproject.toml backend/uv.lock
git commit -m "chore(backend): add ruff lint gate, fix reported violations"
```

- [ ] **Step 5: Create the CI workflow**

Create `.github/workflows/backend-ci.yml`:

```yaml
name: backend-ci

on:
  push:
    paths:
      - "backend/**"
      - ".github/workflows/backend-ci.yml"
  pull_request:
    paths:
      - "backend/**"
      - ".github/workflows/backend-ci.yml"

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: uv sync --all-groups
      - run: uv run ruff check .
      - run: uv run pytest
```

- [ ] **Step 6: Validate the workflow YAML is well-formed**

Run: `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/backend-ci.yml'))" && echo OK`
Expected: `OK` (no YAML parse error). If `pyyaml` isn't installed, run `pip install --user pyyaml` first, or use any available YAML linter.

- [ ] **Step 7: Commit the CI workflow**

```bash
git add .github/workflows/backend-ci.yml
git commit -m "ci(backend): add GitHub Actions lint+test gate"
```

- [ ] **Step 8: Push and verify in GitHub Actions**

Push the branch and open a PR (or push to a branch with an existing PR). Confirm in the GitHub Actions tab that `backend-ci` runs and passes. This is the real verification — the local steps above are a proxy for it.

---

### Task 5: Deploy workflow (manual, Workload Identity Federation)

**Files:**
- Create: `.github/workflows/backend-deploy.yml`
- Create: `.github/workflows/README.md`

**Interfaces:** consumes `EXPECTED_MAX_INSTANCES` contract from Task 2 (the workflow must always set `--max-instances` and `EXPECTED_MAX_INSTANCES` to the same value, sourced from a single `MAX_INSTANCES` workflow variable, so they can't drift).

- [ ] **Step 1: Create the deploy workflow**

Create `.github/workflows/backend-deploy.yml`:

```yaml
name: backend-deploy

on:
  workflow_dispatch: {}

env:
  PROJECT_ID: max-personal-447802
  REGION: asia-east1
  SERVICE_NAME: take-note-backend
  MAX_INSTANCES: "1"

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy "$SERVICE_NAME" \
            --project="$PROJECT_ID" \
            --region="$REGION" \
            --source=backend \
            --allow-unauthenticated \
            --timeout=3600 \
            --max-instances="$MAX_INSTANCES" \
            --concurrency=8 \
            --service-account="${{ secrets.GCP_RUNTIME_SA }}" \
            --set-env-vars="OAUTH_CLIENT_ID=${{ secrets.OAUTH_CLIENT_ID }},ALLOWED_EMAILS=${{ secrets.ALLOWED_EMAILS }},GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_LOCATION=global,EXPECTED_MAX_INSTANCES=$MAX_INSTANCES"
```

- [ ] **Step 2: Validate the workflow YAML is well-formed**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/backend-deploy.yml'))" && echo OK`
Expected: `OK`.

- [ ] **Step 3: Write the setup runbook**

Create `.github/workflows/README.md`:

```markdown
# Backend CI/CD

## backend-ci.yml
Runs on every push/PR touching `backend/**`: `uv sync`, `ruff check`, `pytest`.
No GCP access needed.

## backend-deploy.yml
Manual (`workflow_dispatch`) deploy to Cloud Run, wrapping the `gcloud run
deploy` command from `spec/backend-spec.md` §14. Uses Workload Identity
Federation — no long-lived GCP service account key is ever stored in GitHub.

### One-time GCP setup (you do this)

```bash
PROJECT_ID=max-personal-447802
PROJECT_NUMBER=343692970282
POOL_ID=github-pool
PROVIDER_ID=github-provider
SA_NAME=backend-deployer
REPO=Max-chen-1126/take-note-chrome-extension

# 1. Workload Identity Pool
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" --location="global" \
  --display-name="GitHub Actions pool"

# 2. OIDC provider trusting GitHub Actions, scoped by repository
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" --location="global" --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 3. Deploy service account
gcloud iam service-accounts create "$SA_NAME" \
  --project="$PROJECT_ID" --display-name="Backend CI/CD deployer"

# 4. Let the GitHub provider impersonate the deploy SA, restricted to this repo
gcloud iam service-accounts add-iam-policy-binding \
  "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$REPO"

# 5. Grant the deploy SA what it needs to build+deploy via `gcloud run deploy --source`
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# 6. Let the deploy SA act as the Cloud Run *runtime* service account
#    (replace <runtime-sa-email> with the SA already used in your existing
#    `gcloud run deploy --service-account=...` command)
gcloud iam service-accounts add-iam-policy-binding "<runtime-sa-email>" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Then add these **repo secrets** (Settings → Secrets and variables → Actions):
| Secret | Value |
|---|---|
| `GCP_WIF_PROVIDER` | `projects/343692970282/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOY_SA` | `backend-deployer@max-personal-447802.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SA` | the existing Cloud Run runtime service account (from your current manual deploy command) |
| `OAUTH_CLIENT_ID` | same value as your current `.env` / manual deploy flag |
| `ALLOWED_EMAILS` | same value as your current `.env` / manual deploy flag |

### Test
Actions tab → **backend-deploy** → **Run workflow**. Confirm it succeeds, then
`curl https://<service-url>/healthz` returns `{"status":"ok"}`.
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/backend-deploy.yml .github/workflows/README.md
git commit -m "ci(backend): add manual Cloud Run deploy workflow via Workload Identity Federation"
```

- [ ] **Step 5: Manual verification (you do this)**

Complete the one-time GCP setup in the runbook above, add the repo secrets, then trigger the workflow and confirm the deploy succeeds and `/healthz` responds. This step requires real GCP/GitHub credentials and IAM changes, so it is not something to automate — follow the runbook directly.

---

### Task 6: Monitoring & alerting (log-based metrics + uptime check)

**Files:**
- Create: `infra/monitoring/setup.sh`
- Create: `infra/monitoring/README.md`

**Interfaces:** consumes the log field names from Task 3 (`message`, `status_code` on `app.request`/`app.auth`/`app.notes` loggers) — this task must run after Task 3 is deployed, otherwise the metrics will have no matching log entries yet.

- [ ] **Step 1: Write the log-based metrics script**

Create `infra/monitoring/setup.sh`:

```bash
#!/usr/bin/env bash
# One-time setup for take-note-backend log-based metrics + uptime check.
# Mirrors infra/budget-kill-switch/'s style: plain gcloud commands, run by hand.
# Depends on the structured logging added in
# docs/superpowers/plans/2026-07-02-backend-observability-stability-security.md
# Task 3 (fields: message, status_code, on loggers app.request/app.auth/app.notes).
set -euo pipefail

PROJECT_ID="max-personal-447802"
SERVICE_NAME="take-note-backend"

gcloud logging metrics create backend-error-rate \
  --project="$PROJECT_ID" \
  --description="request_failed / pipeline_error events from take-note-backend" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" (jsonPayload.message="request_failed" OR jsonPayload.message="pipeline_error")'

gcloud logging metrics create backend-auth-denied \
  --project="$PROJECT_ID" \
  --description="401/403 auth_denied events from take-note-backend" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" jsonPayload.message="auth_denied"'

gcloud logging metrics create backend-rate-limited \
  --project="$PROJECT_ID" \
  --description="429 responses from take-note-backend" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" jsonPayload.status_code=429'

echo "Log-based metrics created. Next: create the uptime check and alerting"
echo "policies — see infra/monitoring/README.md (gcloud monitoring CLI syntax"
echo "changes over time, so confirm exact flags with --help before running,"
echo "per this repo's own re-verification convention in spec/backend-spec.md)."
```

- [ ] **Step 2: Write the runbook**

Create `infra/monitoring/README.md`:

```markdown
# Monitoring & Alerting

Log-based metrics + an uptime check for `take-note-backend`, built on the
structured JSON logs added in the backend observability plan. No new paid
tooling — everything here is Cloud Logging/Cloud Monitoring free tier.

## What `setup.sh` does
Creates three log-based metrics from the structured log fields (`message`,
`status_code`) emitted by `app.request`/`app.auth`/`app.notes`:
- `backend-error-rate` — request/pipeline failures
- `backend-auth-denied` — 401/403s (credential-stuffing / abuse signal)
- `backend-rate-limited` — 429s (early cost-runaway warning)

Run once: `bash infra/monitoring/setup.sh`

## Remaining manual steps (you do this)

1. **Notification channel**: Console → Monitoring → Alerting → Edit
   notification channels → add your email. Note the channel ID
   (`projects/max-personal-447802/notificationChannels/...`).

2. **Uptime check** on `/healthz`. Confirm exact flags first (gcloud's
   monitoring surface changes between versions — this repo's own convention,
   see `spec/backend-spec.md`'s "知識截止陷阱" note, is to re-verify CLI
   syntax against `--help`/official docs before running, not trust
   memorized flags):
   ```
   gcloud monitoring uptime create --help
   ```
   Then create a check against `https://<service-url>/healthz` (HTTPS, path
   `/healthz`, expect `200`).

3. **Alerting policies** binding each log-based metric above to the
   notification channel from step 1. Confirm exact flags first:
   ```
   gcloud alpha monitoring policies create --help
   ```
   Threshold suggestion: alert if `backend-error-rate` or
   `backend-auth-denied` exceed a few events in a 5-minute window; alert on
   any `backend-rate-limited` events (429s should be rare for a single-user
   service, so any sustained rate is worth a look).

## Test
```
gcloud logging metrics list --project=max-personal-447802
```
Expect the three metrics above listed. Trigger a real 401 (bad token) and a
429 (exceed 10/minute on `/notes/stream`) against the deployed service, then
check Cloud Logging shows matching entries and (once alerting policies exist)
that the alert fires.
```

- [ ] **Step 3: Make the script executable and validate syntax**

Run: `chmod +x infra/monitoring/setup.sh && bash -n infra/monitoring/setup.sh && echo OK`
Expected: `OK` (bash syntax check passes; this does not require GCP credentials).

- [ ] **Step 4: Commit**

```bash
git add infra/monitoring/setup.sh infra/monitoring/README.md
git commit -m "feat(infra): add log-based metrics + monitoring runbook for backend"
```

- [ ] **Step 5: Manual verification (you do this)**

Run `bash infra/monitoring/setup.sh` against the real project (requires `gcloud auth login` with permissions on `max-personal-447802`), then complete the uptime check + alerting policy steps in the README, then run the "Test" section above.

---

### Task 7: IAP migration spike

**Files:**
- Modify: `backend/app/auth/middleware.py` (only if spike succeeds)
- Modify: `backend/app/api/notes.py` (only if spike succeeds — swap the `Depends`)
- Modify: `spec/backend-spec.md` §8 (either outcome — record the finding)
- Test: `backend/tests/unit/test_auth.py` (only if spike succeeds)

**Interfaces:** if migrating, produces `app.auth.middleware.verify_request_iap(request: Request) -> str` as a drop-in replacement for `verify_request` in the `Depends(...)` on `POST /notes/stream`.

- [ ] **Step 1: Run the spike (you do this — requires real GCP/extension access)**

1. In the GCP Console for `max-personal-447802`, create a throwaway Cloud Run
   service (or a test revision) with IAP enabled (`--iap` flag / Console
   toggle).
2. Add the extension's existing custom OAuth client (the one used for
   `OAUTH_CLIENT_ID` today) to that service's IAP **programmatic access**
   allowlist (Console → Security → Identity-Aware Proxy → the service →
   Edit programmatic clients — or the equivalent `gcloud iap` command
   available in your installed gcloud version; confirm via
   `gcloud iap --help`).
3. From the extension (or a small standalone test using
   `chrome.identity.launchWebAuthFlow`), attempt to obtain an ID token for
   that OAuth client and `curl` the IAP-protected test service with
   `Authorization: Bearer <token>`.
4. Record the outcome: does IAP accept the token (200, and does the request
   carry `X-Goog-Authenticated-User-Email`), or does it reject it (redirect
   to a login page / 401/403 from IAP itself, indicating the Google-managed
   or custom client isn't usable programmatically)?

- [ ] **Step 2a: If the spike succeeds — write the failing test**

Add to `backend/tests/unit/test_auth.py`:

```python
def test_iap_email_extracted_and_allowlisted(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    req = _req({"X-Goog-Authenticated-User-Email": "accounts.google.com:ok@x.com"})
    assert mw.verify_request_iap(req) == "ok@x.com"


def test_iap_missing_header_is_401():
    with pytest.raises(HTTPException) as e:
        mw.verify_request_iap(_req({}))
    assert e.value.status_code == 401


def test_iap_email_not_allowlisted_is_403(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    req = _req({"X-Goog-Authenticated-User-Email": "accounts.google.com:bad@x.com"})
    with pytest.raises(HTTPException) as e:
        mw.verify_request_iap(req)
    assert e.value.status_code == 403
```

- [ ] **Step 2b: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_auth.py -v`
Expected: the three new tests FAIL with `AttributeError` (`verify_request_iap` doesn't exist yet).

- [ ] **Step 2c: Implement `verify_request_iap`**

Add to `backend/app/auth/middleware.py` (after the existing `verify_request` function):

```python
def verify_request_iap(request: Request) -> str:
    """IAP edge-auth path: Cloud Run's IAP already verified the caller's
    identity before the request reached this process and injects it in this
    header. This function only enforces the app's email allowlist on top."""
    settings = get_settings()
    header = request.headers.get("X-Goog-Authenticated-User-Email", "")
    if not header.startswith("accounts.google.com:"):
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=401, reason="missing_iap_header")
        raise HTTPException(status_code=401, detail="missing IAP identity")
    email = header.removeprefix("accounts.google.com:")
    if email not in settings.allowed_email_set:
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=403, reason="not_allowlisted", email=email)
        raise HTTPException(status_code=403, detail="forbidden")
    return email
```

- [ ] **Step 2d: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_auth.py -v`
Expected: PASS.

- [ ] **Step 2e: Swap the dependency in `backend/app/api/notes.py`**

Change the import line:
```python
from app.auth.middleware import verify_request_iap
```
And the route signature:
```python
async def notes_stream(request: Request, req: NoteRequest, _email: str = Depends(verify_request_iap)):
```

Run: `cd backend && uv run pytest -v`
Expected: PASS (all tests green — `test_notes.py` doesn't exercise `Depends`, so this is a safe swap; the auth behavior itself is covered by `test_auth.py`).

- [ ] **Step 2f: Update the spec and commit**

In `spec/backend-spec.md` §8, replace the "規劃：Cloud Run 內建 IAP" subsection's opening line to state the spike passed and this is now implemented, keeping the rest of the description (it already documents the header-reading behavior accurately).

```bash
git add backend/app/auth/middleware.py backend/app/api/notes.py backend/tests/unit/test_auth.py spec/backend-spec.md
git commit -m "feat(backend): migrate edge auth to Cloud Run IAP (spike passed)"
```

Then follow `.github/workflows/README.md` / Cloud Run Console to enable `--iap`
on the real `take-note-backend` service and remove the old app-layer
`OAUTH_CLIENT_ID` audience check dependency if no longer needed elsewhere.

- [ ] **Step 3b: If the spike fails — document and close**

In `spec/backend-spec.md` §8, replace the "規劃：Cloud Run 內建 IAP" subsection
with a short note: spike attempted on `<date>`, outcome (e.g. "Google-managed
OAuth client rejected programmatic `launchWebAuthFlow` token exchange against
IAP's allowlist" — fill in the actual observed reason), decision: stay on the
current app-layer `verify_request` auth, no code change.

```bash
git add spec/backend-spec.md
git commit -m "docs(spec): close out IAP migration spike (not viable), stay on app-layer auth"
```

---

## Verification (end-to-end, after all tasks)

- `cd backend && uv run pytest -v` — full suite green.
- `cd backend && uv run ruff check .` — clean.
- Push a branch touching `backend/**` → confirm `backend-ci` GitHub Action passes.
- Trigger `backend-deploy` manually → confirm Cloud Run deploy succeeds → `curl https://<service-url>/healthz` → `{"status":"ok"}`.
- Send a request that trips the 413 body-size limit and one that trips the 429 rate limiter against the deployed service → confirm both show up as structured log entries in Cloud Logging (`jsonPayload.message` = `request_failed` / `status_code` = `429`).
- `bash infra/monitoring/setup.sh` (against real project) → `gcloud logging metrics list` shows the three metrics; complete uptime check + alerting policy manual steps; confirm an alert fires on a real 401 spike.
- Temporarily set `EXPECTED_MAX_INSTANCES=2` in a local `.env` → `uv run python -c "from app.core.config import get_settings; get_settings()"` → confirm it raises `ValueError`; revert.
- `pytest tests/agents/test_pipeline.py -k hygiene` → confirms `[[VAR]]` resolution is live in the real pipeline path.
- IAP spike outcome documented in `spec/backend-spec.md` §8, either as "implemented" (with a real end-to-end curl test against the IAP-protected Cloud Run URL using a token obtained via the extension's real auth flow) or as "not viable, closed."
