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
