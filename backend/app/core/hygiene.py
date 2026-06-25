import os
import re

_PATTERN = re.compile(r"\[\[([A-Z0-9_]+)\]\]")


def resolve(text: str, overrides: dict[str, str] | None = None) -> str:
    """解析 ``[[VAR]]`` 佔位符（override → env → 留白）。

    TODO(Phase B): 尚未接入請求流程——預計在載入 methodology/template 後、組裝
    pipeline 前以此解析 instruction 中的 ``[[VAR]]``。Phase A 先備而不接。
    """
    overrides = overrides or {}

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key in overrides:
            return overrides[key]
        return os.environ.get(key, "")

    return _PATTERN.sub(_sub, text)
