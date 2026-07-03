import logging

from app.core.logging import log_event

logger = logging.getLogger("app.pricing")

# ⚠️ 實作時對 Vertex AI 官方定價頁面（非 AI Studio 定價，見 config.py 的
# google_genai_use_vertexai=True）再三確認確切單價與計費單位（per-1M tokens），
# 並更新下方查證日期——定價會隨時間調整。以下數字為 2026-07 查證時的估計值，
# 非保證現值；模型 id 需與 app/agents/models.py 的 DEFAULT_MODELS 對齊。
PRICING: dict[str, tuple[float, float]] = {
    # model_id: (usd_per_1M_input_tokens, usd_per_1M_output_tokens)
    "gemini-3.5-flash": (0.30, 2.50),
}

_warned_models: set[str] = set()


def estimate_cost_usd(model_id: str, prompt_tokens: int, output_tokens: int) -> float | None:
    """Estimate USD cost for one generation call. Returns None (not 0.0) when
    `model_id` has no known price, so callers can distinguish "genuinely free"
    from "unknown price, don't trust this number."."""
    prices = PRICING.get(model_id)
    if prices is None:
        if model_id not in _warned_models:
            _warned_models.add(model_id)
            log_event(logger, logging.WARNING, "pricing_unknown_model", model_id=model_id)
        return None
    input_price, output_price = prices
    return (prompt_tokens / 1_000_000) * input_price + (output_tokens / 1_000_000) * output_price
