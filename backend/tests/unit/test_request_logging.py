import logging

from fastapi.testclient import TestClient

from app.main import app


def test_request_logged_with_status_and_request_id(caplog):
    client = TestClient(app)
    with caplog.at_level(logging.INFO, logger="app.request"):
        resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.headers["X-Request-Id"]
    events = [
        r for r in caplog.records
        if getattr(r, "fields", None) and r.fields.get("path") == "/healthz"
    ]
    assert events and events[0].fields["status_code"] == 200
