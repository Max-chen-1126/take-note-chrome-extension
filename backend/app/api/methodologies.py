from fastapi import APIRouter, Request

from app.core.limiter import limiter
from app.store.firestore import list_methodologies

router = APIRouter()


# Public (no auth): the methodology list is just dropdown options (id / name /
# description / categories) — not user data. Keeping it unauthenticated lets the
# side panel populate the dropdown on open WITHOUT triggering the Google login
# popup; authentication happens only when the user presses 開始 (POST
# /notes/stream, which stays auth-gated). Per-IP rate limited + TTL-cached so a
# flood can't rack Firestore reads.
@router.get("/methodologies")
@limiter.limit("30/minute")
def methodologies(request: Request):
    return list_methodologies()
