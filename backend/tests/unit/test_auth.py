import logging

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


def test_audience_is_oauth_client_id(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    monkeypatch.setenv("OAUTH_CLIENT_ID", "cid.apps.googleusercontent.com")
    cfg.get_settings.cache_clear()
    seen = {}

    def fake_verify(token, transport, audience=None):
        seen["audience"] = audience
        return {"email": "ok@x.com"}

    monkeypatch.setattr(mw.id_token, "verify_oauth2_token", fake_verify)
    assert mw.verify_request(_req({"Authorization": "Bearer t"})) == "ok@x.com"
    assert seen["audience"] == "cid.apps.googleusercontent.com"


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


def test_invalid_token_error_does_not_leak_raw_exception_text(monkeypatch, caplog):
    # 確保 ValueError 的原始例外文字（可能內嵌 token 片段，例如
    # "Wrong number of segments in token: <token>"）不會被寫進結構化 log。
    fake_token_fragment = "some.fake.jwt.fragment.that.looks.like.a.token"
    monkeypatch.setattr(
        mw.id_token, "verify_oauth2_token",
        lambda *a, **k: (_ for _ in ()).throw(
            ValueError(f"Wrong number of segments in token: {fake_token_fragment}")
        ),
    )
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        with pytest.raises(HTTPException):
            mw.verify_request(_req({"Authorization": "Bearer t"}))
    assert any(r.levelno == logging.WARNING for r in caplog.records)
    for record in caplog.records:
        assert fake_token_fragment not in record.getMessage()
