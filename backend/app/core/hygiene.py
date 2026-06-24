import os
import re

_PATTERN = re.compile(r"\[\[([A-Z0-9_]+)\]\]")


def resolve(text: str, overrides: dict[str, str] | None = None) -> str:
    overrides = overrides or {}

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key in overrides:
            return overrides[key]
        return os.environ.get(key, "")

    return _PATTERN.sub(_sub, text)
