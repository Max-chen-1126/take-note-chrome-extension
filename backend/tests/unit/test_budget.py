import logging
from types import SimpleNamespace

import app.core.budget as budget
from app.core.budget import BudgetTier


def _settings(monthly_budget_usd=20.0, degrade=0.75, block=0.90):
    return SimpleNamespace(
        monthly_budget_usd=monthly_budget_usd,
        budget_degrade_threshold=degrade,
        budget_block_threshold=block,
    )


def test_normal_tier_below_degrade_threshold(monkeypatch):
    monkeypatch.setattr(budget, "get_usage", lambda _key: {"total_cost_usd": 5.0})
    tier, unavailable = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.NORMAL
    assert unavailable is False


def test_degrade_tier_at_exact_threshold(monkeypatch):
    # 15.0 / 20.0 == 0.75 == budget_degrade_threshold; boundary is inclusive
    monkeypatch.setattr(budget, "get_usage", lambda _key: {"total_cost_usd": 15.0})
    tier, _ = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.DEGRADE_WEB_SEARCH


def test_degrade_tier_just_below_block_threshold(monkeypatch):
    monkeypatch.setattr(budget, "get_usage", lambda _key: {"total_cost_usd": 17.9})
    tier, _ = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.DEGRADE_WEB_SEARCH


def test_block_tier_at_exact_threshold(monkeypatch):
    # 18.0 / 20.0 == 0.90 == budget_block_threshold; boundary is inclusive
    monkeypatch.setattr(budget, "get_usage", lambda _key: {"total_cost_usd": 18.0})
    tier, _ = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.BLOCK


def test_block_tier_above_threshold(monkeypatch):
    monkeypatch.setattr(budget, "get_usage", lambda _key: {"total_cost_usd": 25.0})
    tier, _ = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.BLOCK


def test_no_usage_doc_yet_is_normal(monkeypatch):
    monkeypatch.setattr(budget, "get_usage", lambda _key: None)
    tier, unavailable = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.NORMAL
    assert unavailable is False


def test_firestore_read_failure_fails_open(monkeypatch, caplog):
    def _raise(_key):
        raise RuntimeError("firestore unreachable")
    monkeypatch.setattr(budget, "get_usage", _raise)
    with caplog.at_level(logging.WARNING, logger="app.budget"):
        tier, unavailable = budget.check_budget_tier(_settings())
    assert tier == BudgetTier.NORMAL
    assert unavailable is True
    warnings = [r for r in caplog.records if r.getMessage() == "budget_check_unavailable"]
    assert len(warnings) == 1


def test_non_positive_budget_fails_open(monkeypatch, caplog):
    monkeypatch.setattr(budget, "get_usage", lambda _key: {"total_cost_usd": 5.0})
    with caplog.at_level(logging.WARNING, logger="app.budget"):
        tier, unavailable = budget.check_budget_tier(_settings(monthly_budget_usd=0))
    assert tier == BudgetTier.NORMAL
    assert unavailable is True


def test_current_month_key_format():
    key = budget.current_month_key()
    assert len(key) == 7
    assert key[4] == "-"
