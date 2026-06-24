from app.schemas.requests import Provider


class ProviderNotImplemented(Exception):
    pass


# ⚠️ 實作時對官方文件再三確認確切 model id
DEFAULT_MODELS: dict[Provider, str] = {
    Provider.gemini: "gemini-3.5-flash",
}


def build_model(provider: Provider, model_id: str | None) -> str:
    if provider is not Provider.gemini:
        raise ProviderNotImplemented(provider.value)
    return model_id or DEFAULT_MODELS[Provider.gemini]  # ADK 原生 Gemini，走 Vertex（env 決定）


def generate_config(provider: Provider) -> dict:
    """effort=High 對映。⚠️ 參數名實作時對 ADK/Gemini 文件確認。"""
    if provider is Provider.gemini:
        return {"thinking_config": {"thinking_budget": -1}}  # -1 = 動態最高
    return {}
