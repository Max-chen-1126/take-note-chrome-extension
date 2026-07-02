import os
import re

_PATTERN = re.compile(r"\[\[([A-Z0-9_]+)\]\]")


def resolve(text: str, overrides: dict[str, str] | None = None) -> str:
    """解析 ``[[VAR]]`` 佔位符（override → env → 留白）。

    注意：env 來源是完整的 process environment（``os.environ``），會包含
    ``OAUTH_CLIENT_ID``、``ALLOWED_EMAILS`` 等敏感值。目前僅限 app owner
    撰寫 methodology template，故非即時風險；若未來開放更多人可自訂
    template，須重新評估此處的 env 洩漏風險。
    """
    overrides = overrides or {}

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key in overrides:
            return overrides[key]
        return os.environ.get(key, "")

    return _PATTERN.sub(_sub, text)
