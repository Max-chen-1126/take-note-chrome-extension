import logging

import pytest

import app.core.pricing as pricing


def test_known_model_computes_cost():
    # gemini-3.5-flash: 0.30 usd/1M input tokens, 2.50 usd/1M output tokens
    cost = pricing.estimate_cost_usd("gemini-3.5-flash", prompt_tokens=1_000_000,
                                      output_tokens=1_000_000)
    assert cost == pytest.approx(0.30 + 2.50)


def test_zero_tokens_is_zero_cost():
    assert pricing.estimate_cost_usd("gemini-3.5-flash", 0, 0) == 0.0


def test_partial_token_counts_scale_linearly():
    cost = pricing.estimate_cost_usd("gemini-3.5-flash", prompt_tokens=500_000,
                                      output_tokens=0)
    assert cost == pytest.approx(0.15)


def test_unknown_model_returns_none_not_zero():
    assert pricing.estimate_cost_usd("some-future-model", 100, 100) is None


def test_unknown_model_logs_warning_once(caplog):
    pricing._warned_models.clear()
    with caplog.at_level(logging.WARNING, logger="app.pricing"):
        pricing.estimate_cost_usd("mystery-model", 10, 10)
        pricing.estimate_cost_usd("mystery-model", 10, 10)
    warnings = [r for r in caplog.records if r.getMessage() == "pricing_unknown_model"]
    assert len(warnings) == 1
    assert warnings[0].fields["model_id"] == "mystery-model"
