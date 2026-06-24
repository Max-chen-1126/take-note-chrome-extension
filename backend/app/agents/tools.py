from app.schemas.requests import Provider


def web_search_tools(provider: Provider, enabled: bool) -> list:
    if not enabled:
        return []
    if provider is Provider.gemini:
        from google.adk.tools import google_search
        return [google_search]
    return []  # 非 Gemini 的 web search：Phase B
