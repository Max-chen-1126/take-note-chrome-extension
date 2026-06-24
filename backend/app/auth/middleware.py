from fastapi import HTTPException, Request
from google.auth.transport import requests as ga_requests
from google.oauth2 import id_token

from app.core.config import get_settings

_transport = ga_requests.Request()


def verify_request(request: Request) -> str:
    settings = get_settings()
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = auth.split(" ", 1)[1]
    try:
        claims = id_token.verify_oauth2_token(
            token, _transport, audience=settings.cloud_run_service_url or None
        )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")
    email = claims.get("email")
    if not email or email not in settings.allowed_email_set:
        raise HTTPException(status_code=403, detail="forbidden")
    return email
