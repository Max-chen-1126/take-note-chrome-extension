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


def test_invalid_token_maps_to_401(monkeypatch):
    monkeypatch.setattr(
        mw.id_token, "verify_oauth2_token",
        lambda *a, **k: (_ for _ in ()).throw(ValueError("Token expired")),
    )
    with pytest.raises(HTTPException) as e:
        mw.verify_request(_req({"Authorization": "Bearer t"}))
    assert e.value.status_code == 401


def test_non_value_error_propagates(monkeypatch):
    # 非 ValueError（例如網路/憑證取得失敗）不應被誤判為「無效 token」並
    # 回 401；應該往外傳，讓它變成 500，而不是冒充成 401。
    monkeypatch.setattr(
        mw.id_token, "verify_oauth2_token",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("network error")),
    )
    with pytest.raises(RuntimeError):
        mw.verify_request(_req({"Authorization": "Bearer t"}))
