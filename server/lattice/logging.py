"""Logging: one JSON object per line, every line tagged with the request it served.

`request_id` is set by the middleware in `main.py` for the span of one request and read
here by a filter, so a log line from anywhere (our code, Cognee, litellm, uvicorn) can be
tied back to the response that carried the same `X-Request-Id`.
"""

import json
import logging
import logging.config
from contextvars import ContextVar
from datetime import UTC, datetime

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

# Loggers that arrive with their own handlers; each is reset to propagate into root's.
ROUTED_LOGGERS = ("uvicorn", "uvicorn.access", "uvicorn.error", "cognee", "litellm")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        if record.exc_info:
            line["exc"] = self.formatException(record.exc_info)
        elif record.exc_text:
            line["exc"] = record.exc_text
        return json.dumps(line, default=str)


def configure_logging(level: str) -> None:
    """Route root and the third-party loggers through one JSON handler on stderr.

    Safe to call repeatedly (every `create_app`): `dictConfig` replaces root's handlers and
    the routed loggers keep none of their own, so lines are never emitted twice.
    """
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"request_id": {"()": RequestIdFilter}},
            "formatters": {"json": {"()": JsonFormatter}},
            "handlers": {
                "stderr": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stderr",
                    "formatter": "json",
                    "filters": ["request_id"],
                }
            },
            "root": {"level": level.upper(), "handlers": ["stderr"]},
            "loggers": {
                name: {"handlers": [], "propagate": True, "level": "NOTSET"}
                for name in ROUTED_LOGGERS
            },
        }
    )
