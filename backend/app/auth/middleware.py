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
        logger.warning("ID token verification failed: %s", type(exc).__name__)
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=401, reason="invalid_token")
        raise HTTPException(status_code=401, detail="invalid token")
    email = claims.get("email")
    if not email or email not in settings.allowed_email_set:
        log_event(logger, logging.WARNING, "auth_denied",
                  status_code=403, reason="not_allowlisted", email=email or "")
        raise HTTPException(status_code=403, detail="forbidden")
    return email
