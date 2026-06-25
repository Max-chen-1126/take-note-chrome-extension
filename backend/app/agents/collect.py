from app.core.config import get_settings
from app.schemas.requests import Content

_OMITTED = "\n\n...[內容過長，中段已省略]...\n\n"


def build_source(content: Content) -> str:
    text = content.text.strip()
    cap = get_settings().max_content_chars
    if len(text) > cap:
        budget = max(0, cap - len(_OMITTED))
        head = int(budget * 0.7)
        tail = budget - head
        text = text[:head] + _OMITTED + (text[-tail:] if tail else "")
    parts = []
    if content.title:
        parts.append(f"# {content.title}")
    if content.url:
        parts.append(f"來源: {content.url}")
    parts.append(text)
    return "\n\n".join(parts)
