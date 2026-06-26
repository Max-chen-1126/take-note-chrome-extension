import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import health, methodologies, notes
from app.core.config import get_settings
from app.core.limiter import limiter

logging.basicConfig(level=logging.INFO)

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
            if int(content_length) > max_bytes:
                return JSONResponse(
                    status_code=413, content={"detail": "request body too large"}
                )
        except ValueError:
            pass
    return await call_next(request)


app.add_middleware(SlowAPIMiddleware)
app.include_router(health.router)
app.include_router(methodologies.router)
app.include_router(notes.router)
