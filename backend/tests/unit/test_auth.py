import pytest
from fastapi import HTTPException
from starlette.requests import Request
import app.auth.middleware as mw
import app.core.config as cfg


def _req(headers: dict) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw})


def test_missing_token():
    with pytest.raises(HTTPException) as e:
        mw.verify_request(_req({}))
    assert e.value.status_code == 401


def test_email_not_allowlisted(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    monkeypatch.setattr(mw.id_token, "verify_oauth2_token",
                        lambda *a, **k: {"email": "bad@x.com"})
    with pytest.raises(HTTPException) as e:
        mw.verify_request(_req({"Authorization": "Bearer t"}))
    assert e.value.status_code == 403


def test_ok(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    monkeypatch.setattr(mw.id_token, "verify_oauth2_token",
                        lambda *a, **k: {"email": "ok@x.com"})
    assert mw.verify_request(_req({"Authorization": "Bearer t"})) == "ok@x.com"
