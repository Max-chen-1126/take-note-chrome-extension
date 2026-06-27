import pytest

import app.core.config as cfg


def test_allowed_email_set(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "a@x.com, b@y.com")
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().allowed_email_set == {"a@x.com", "b@y.com"}


def test_defaults(monkeypatch):
    monkeypatch.delenv("MAX_CONTENT_CHARS", raising=False)
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().max_content_chars == 600000


def test_cloud_run_without_oauth_client_id_raises(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "take-note")
    monkeypatch.delenv("OAUTH_CLIENT_ID", raising=False)
    cfg.get_settings.cache_clear()
    with pytest.raises(ValueError):
        cfg.get_settings()


def test_cloud_run_with_oauth_client_id_ok(monkeypatch):
    monkeypatch.setenv("K_SERVICE", "take-note")
    monkeypatch.setenv("OAUTH_CLIENT_ID", "123.apps.googleusercontent.com")
    cfg.get_settings.cache_clear()
    settings = cfg.get_settings()
    assert settings.oauth_client_id == "123.apps.googleusercontent.com"


def test_not_cloud_run_without_oauth_client_id_ok(monkeypatch):
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.delenv("OAUTH_CLIENT_ID", raising=False)
    cfg.get_settings.cache_clear()
    settings = cfg.get_settings()
    assert settings.oauth_client_id == ""
