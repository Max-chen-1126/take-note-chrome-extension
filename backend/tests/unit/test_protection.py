import app.core.config as cfg
import app.api.methodologies as methodologies
from app.main import app, docs_kwargs, limiter
from fastapi.testclient import TestClient


def test_docs_hidden_in_cloud_run():
    assert docs_kwargs(True) == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    assert docs_kwargs(False) == {}


def test_oversized_body_rejected_413(monkeypatch):
    monkeypatch.setenv("MAX_BODY_BYTES", "10")
    cfg.get_settings.cache_clear()
    client = TestClient(app)
    # Body of 50 bytes exceeds the 10-byte cap; the middleware rejects before routing.
    resp = client.post("/notes/stream", content=b"x" * 50)
    assert resp.status_code == 413
    cfg.get_settings.cache_clear()


def test_rate_limit_returns_429(monkeypatch):
    # /methodologies is public; mock the store so we exercise only the limiter.
    monkeypatch.setattr(methodologies, "list_methodologies", lambda: [])
    limiter.reset()
    client = TestClient(app)
    statuses = [client.get("/methodologies").status_code for _ in range(35)]
    assert 200 in statuses
    assert 429 in statuses  # default 30/minute per-IP cap kicks in
    limiter.reset()
