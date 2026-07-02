import json
import logging

from app.core.logging import _JsonFormatter, log_event, request_id_var


def test_json_formatter_includes_request_id_and_fields():
    token = request_id_var.set("req-123")
    try:
        logger = logging.getLogger("test.logging")
        record = logger.makeRecord(
            "test.logging", logging.INFO, __file__, 0, "hello", (), None,
        )
        record.fields = {"status_code": 200}
        line = _JsonFormatter().format(record)
    finally:
        request_id_var.reset(token)
    data = json.loads(line)
    assert data["message"] == "hello"
    assert data["request_id"] == "req-123"
    assert data["status_code"] == 200
    assert data["severity"] == "INFO"


def test_log_event_attaches_fields_to_record(caplog):
    logger = logging.getLogger("test.logging.event")
    with caplog.at_level(logging.INFO, logger="test.logging.event"):
        log_event(logger, logging.INFO, "auth_denied", status_code=401)
    assert any(getattr(r, "fields", None) == {"status_code": 401} for r in caplog.records)
