"""Structured JSON logging.

Cloud Run captures container stdout into Cloud Logging automatically, so this
module only needs to emit one JSON object per line — no exporter/handler
config beyond stdout. Callers of `log_event` are responsible for redaction:
never pass raw ID tokens, full request bodies, or full generated Markdown
into `fields` — log shape/size (e.g. char counts), not raw user content.
"""

import contextvars
import json
import logging
import sys

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "request_id": request_id_var.get(),
        }
        payload.update(getattr(record, "fields", None) or {})
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Install the JSON formatter on the root logger. Call once at startup."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


def log_event(logger: logging.Logger, level: int, message: str, **fields) -> None:
    """Log one structured event with arbitrary `fields` attached."""
    logger.log(level, message, extra={"fields": fields})
