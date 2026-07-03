import logging
from datetime import datetime
from enum import Enum
from zoneinfo import ZoneInfo

from app.core.logging import log_event
from app.store.firestore import get_usage

logger = logging.getLogger("app.budget")


class BudgetTier(str, Enum):
    NORMAL = "normal"
    DEGRADE_WEB_SEARCH = "degrade_web_search"
    BLOCK = "block"


def current_month_key(tz: str = "Asia/Taipei") -> str:
    return datetime.now(ZoneInfo(tz)).strftime("%Y-%m")


def check_budget_tier(settings) -> tuple[BudgetTier, bool]:
    """Returns (tier, usage_was_unavailable). Fails open (NORMAL) if the
    Firestore usage read fails, if no usage doc exists yet for this month, or
    if monthly_budget_usd is misconfigured as non-positive."""
    try:
        usage = get_usage(current_month_key())
    except Exception as exc:
        log_event(logger, logging.WARNING, "budget_check_unavailable", error_message=str(exc))
        return BudgetTier.NORMAL, True

    if usage is None:
        return BudgetTier.NORMAL, False

    budget_usd = settings.monthly_budget_usd
    if budget_usd <= 0:
        # Misconfigured budget — fail open rather than dividing by zero or
        # blocking every request due to a config typo.
        log_event(logger, logging.WARNING, "budget_check_unavailable",
                 error_message="monthly_budget_usd is not positive")
        return BudgetTier.NORMAL, True

    spend = usage.get("total_cost_usd", 0.0)
    ratio = spend / budget_usd
    if ratio >= settings.budget_block_threshold:
        return BudgetTier.BLOCK, False
    if ratio >= settings.budget_degrade_threshold:
        return BudgetTier.DEGRADE_WEB_SEARCH, False
    return BudgetTier.NORMAL, False
