import os
import re

_PATTERN = re.compile(r"\[\[([A-Z0-9_]+)\]\]")

# Env-var names that _sub() must never resolve from os.environ, even though
# resolve()'s normal contract is "override → env → blank". Without this,
# methodology templates could pull secrets out of the full process
# environment and have them forwarded to Gemini as part of the prompt.
# Extend this set whenever a new secret is added to .env.example.
_SENSITIVE_ENV_KEYS = {
    "OAUTH_CLIENT_ID",
    "ALLOWED_EMAILS",
    # Reserved for Phase B (not yet used, but block proactively so this
    # doesn't need revisiting when multi-provider support ships):
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
}


def resolve(text: str, overrides: dict[str, str] | None = None) -> str:
    """解析 ``[[VAR]]`` 佔位符（override → env → 留白）。

    注意：env 來源是完整的 process environment（``os.environ``），但
    ``_SENSITIVE_ENV_KEYS`` 中列出的敏感變數（如 ``OAUTH_CLIENT_ID``、
    ``ALLOWED_EMAILS``）一律回傳空字串，不會被 template 讀取或送往
    Gemini。若未來 `.env.example` 新增其他敏感變數，須將其加入
    ``_SENSITIVE_ENV_KEYS``。
    """
    overrides = overrides or {}

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key in overrides:
            return overrides[key]
        if key in _SENSITIVE_ENV_KEYS:
            return ""
        return os.environ.get(key, "")

    return _PATTERN.sub(_sub, text)
