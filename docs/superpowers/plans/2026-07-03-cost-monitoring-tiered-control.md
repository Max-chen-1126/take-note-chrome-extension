# Cost Monitoring & Tiered Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add app-level cost tracking and graceful two-tier spend-based degradation
(disable web search, then refuse new requests) to the backend, sitting between normal
operation and the existing binary GCP-Billing-triggered kill-switch.

**Architecture:** A new pricing module estimates USD cost from ADK-reported token counts; a
new Firestore-backed counter persists cumulative monthly spend (atomic `Increment` writes,
one document per `YYYY-MM`); a new budget module reads that counter and classifies the
current tier; `run_pipeline` in `notes.py` checks the tier before generating, degrades or
blocks accordingly, and records usage/cost after every run (including failed runs).

**Tech Stack:** Python 3.12, FastAPI, Google ADK (`google-adk~=2.3`), `google-cloud-firestore`,
`pydantic-settings`, `pytest` + `pytest-asyncio` (auto mode).

## Global Constraints

- No new external dependencies — everything is built on `google-cloud-firestore` (already a
  dependency) and stdlib (`enum`, `datetime`, `zoneinfo`).
- Single global (not per-user) budget counter — this backend is single-shared-service,
  gated by one flat email allowlist, not multi-tenant.
- No new HTTP endpoint for reading usage — the developer already has direct Firestore/GCP
  console access.
- Every new numeric/config value (thresholds, budget amount, rate limit) must live in
  `Settings`, never hardcoded in a route or module — mirrors this codebase's existing
  convention (`max_content_chars`, `expected_max_instances`, etc.) and closes the specific
  gap this plan's own spec identified (the rate limit was previously hardcoded).
- Any new `⚠️`-style comment flagging "needs verification against official docs/installed
  library at implementation time" must be preserved verbatim in code — this codebase has an
  established convention (see `models.py`'s `DEFAULT_MODELS` comment, `_drive_adk`'s
  docstring) of flagging exactly this kind of uncertainty rather than silently guessing.
- Firestore read failures in the pre-request budget check must fail open (treat as `NORMAL`,
  log a WARNING) — mirrors the existing precedent in `run_pipeline` for the prompt-template
  read. Firestore write failures recording usage must never surface as a client-facing error.
- All new `Settings` fields follow the existing validator rigor in `config.py`: fail loudly at
  startup on misconfiguration (see the two existing `model_validator`s), never silently
  produce nonsense behavior at request time.

---

### Task 1: Config additions — budget thresholds & configurable rate limit

**Files:**
- Modify: `backend/app/core/config.py`
- Test: `backend/tests/unit/test_config.py`

**Interfaces:**
- Produces: `Settings.rate_limit_per_minute: str`, `Settings.monthly_budget_usd: float`,
  `Settings.budget_degrade_threshold: float`, `Settings.budget_block_threshold: float`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_config.py`:
```python
def test_rate_limit_per_minute_default(monkeypatch):
    monkeypatch.delenv("RATE_LIMIT_PER_MINUTE", raising=False)
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().rate_limit_per_minute == "10/minute"


def test_monthly_budget_usd_default(monkeypatch):
    monkeypatch.delenv("MONTHLY_BUDGET_USD", raising=False)
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().monthly_budget_usd == 20.0


def test_budget_threshold_defaults(monkeypatch):
    monkeypatch.delenv("BUDGET_DEGRADE_THRESHOLD", raising=False)
    monkeypatch.delenv("BUDGET_BLOCK_THRESHOLD", raising=False)
    cfg.get_settings.cache_clear()
    settings = cfg.get_settings()
    assert settings.budget_degrade_threshold == 0.75
    assert settings.budget_block_threshold == 0.90


def test_budget_thresholds_out_of_order_raises(monkeypatch):
    monkeypatch.setenv("BUDGET_DEGRADE_THRESHOLD", "0.9")
    monkeypatch.setenv("BUDGET_BLOCK_THRESHOLD", "0.5")
    cfg.get_settings.cache_clear()
    with pytest.raises(ValueError):
        cfg.get_settings()
    monkeypatch.delenv("BUDGET_DEGRADE_THRESHOLD", raising=False)
    monkeypatch.delenv("BUDGET_BLOCK_THRESHOLD", raising=False)
    cfg.get_settings.cache_clear()


def test_budget_block_threshold_above_one_raises(monkeypatch):
    monkeypatch.setenv("BUDGET_BLOCK_THRESHOLD", "1.5")
    cfg.get_settings.cache_clear()
    with pytest.raises(ValueError):
        cfg.get_settings()
    monkeypatch.delenv("BUDGET_BLOCK_THRESHOLD", raising=False)
    cfg.get_settings.cache_clear()


def test_budget_degrade_threshold_zero_raises(monkeypatch):
    monkeypatch.setenv("BUDGET_DEGRADE_THRESHOLD", "0")
    cfg.get_settings.cache_clear()
    with pytest.raises(ValueError):
        cfg.get_settings()
    monkeypatch.delenv("BUDGET_DEGRADE_THRESHOLD", raising=False)
    cfg.get_settings.cache_clear()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_config.py -v`
Expected: the 5 new tests FAIL (`AttributeError` / no validation error raised) — the 5
pre-existing tests in this file still PASS.

- [ ] **Step 3: Add the new Settings fields and validator**

In `backend/app/core/config.py`, add these fields to the `Settings` class immediately after
the existing `expected_max_instances` line:
```python
    rate_limit_per_minute: str = "10/minute"  # was hardcoded on the route decorator
    monthly_budget_usd: float = 20.0   # NOT auto-synced with the real GCP Billing Budget
                                        # amount (infra/budget-kill-switch/) — keep in sync by hand
    budget_degrade_threshold: float = 0.75   # spend/budget ratio: force web_search off
    budget_block_threshold: float = 0.90     # spend/budget ratio: refuse new requests
```

Add this new validator immediately after the existing
`_require_single_instance_for_in_memory_limiter` validator (still inside the `Settings`
class, before `get_settings`):
```python
    @model_validator(mode="after")
    def _require_ordered_budget_thresholds(self) -> "Settings":
        # Soft app-level tiers must sit strictly below the hard 100% GCP kill-switch,
        # and strictly ordered, or the tier check in app/core/budget.py could silently
        # gate nonsense (e.g. degrade firing above block).
        if not (0 < self.budget_degrade_threshold < self.budget_block_threshold <= 1.0):
            raise ValueError(
                "budget_degrade_threshold must be > 0, < budget_block_threshold, and "
                "budget_block_threshold must be <= 1.0 "
                f"(got degrade={self.budget_degrade_threshold}, "
                f"block={self.budget_block_threshold})."
            )
        return self
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_config.py -v`
Expected: all 10 tests PASS (5 pre-existing + 5 new).

- [ ] **Step 5: Run the full suite**

Run: `cd backend && uv run pytest`
Expected: PASS, no regressions (66 pre-existing + 5 new = 71 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/config.py backend/tests/unit/test_config.py
git commit -m "feat(backend): add budget threshold and configurable rate-limit settings"
```

---

### Task 2: Pricing module

**Files:**
- Create: `backend/app/core/pricing.py`
- Test: `backend/tests/unit/test_pricing.py`

**Interfaces:**
- Produces: `estimate_cost_usd(model_id: str, prompt_tokens: int, output_tokens: int) -> float | None`
  (returns `None`, not `0.0`, when `model_id` has no known price).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_pricing.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/unit/test_pricing.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.pricing'`.

- [ ] **Step 3: Create `backend/app/core/pricing.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/unit/test_pricing.py -v`
Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && uv run pytest`
Expected: PASS, no regressions (71 + 5 = 76 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/pricing.py backend/tests/unit/test_pricing.py
git commit -m "feat(backend): add token-cost estimation module"
```

---

### Task 3: Firestore usage-counter store functions

**Files:**
- Modify: `backend/app/store/firestore.py`
- Test: `backend/tests/unit/test_store.py`

**Interfaces:**
- Produces: `get_usage(month_key: str) -> dict | None`,
  `record_usage(month_key: str, *, cost_usd: float, prompt_tokens: int, output_tokens: int,
  request_count_delta: int = 1) -> None`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_store.py` (the existing `_Doc`/`_Coll`/`_Client` classes
defined earlier in this file are reused as-is):
```python
def test_get_usage_missing_month_returns_none(monkeypatch):
    monkeypatch.setattr(store, "client_factory", lambda: _Client(_Doc(False, None)))
    assert store.get_usage("2099-01") is None


def test_get_usage_existing_month_returns_dict(monkeypatch):
    doc = _Doc(True, {"total_cost_usd": 3.2, "request_count": 5})
    monkeypatch.setattr(store, "client_factory", lambda: _Client(doc))
    result = store.get_usage("2026-07")
    assert result["total_cost_usd"] == 3.2
    assert result["request_count"] == 5


class _RecordDoc:
    def __init__(self):
        self.set_calls = []
    def set(self, data, merge=False):
        self.set_calls.append((data, merge))


class _RecordColl:
    def __init__(self, doc):
        self._doc = doc
    def document(self, _id):
        return self._doc


class _RecordClient:
    def __init__(self, doc):
        self._doc = doc
    def collection(self, name):
        assert name == "usage_counters"
        return _RecordColl(self._doc)


def test_record_usage_writes_increments_with_merge(monkeypatch):
    doc = _RecordDoc()
    monkeypatch.setattr(store, "client_factory", lambda: _RecordClient(doc))
    monkeypatch.setattr(store.firestore, "Increment", lambda v: ("INCR", v))
    monkeypatch.setattr(store.firestore, "SERVER_TIMESTAMP", "SENTINEL_TIMESTAMP")

    store.record_usage("2026-07", cost_usd=1.5, prompt_tokens=100, output_tokens=50)

    assert len(doc.set_calls) == 1
    data, merge = doc.set_calls[0]
    assert merge is True
    assert data["total_cost_usd"] == ("INCR", 1.5)
    assert data["total_prompt_tokens"] == ("INCR", 100)
    assert data["total_output_tokens"] == ("INCR", 50)
    assert data["request_count"] == ("INCR", 1)
    assert data["updated_at"] == "SENTINEL_TIMESTAMP"


def test_record_usage_default_request_count_delta_is_one(monkeypatch):
    doc = _RecordDoc()
    monkeypatch.setattr(store, "client_factory", lambda: _RecordClient(doc))
    monkeypatch.setattr(store.firestore, "Increment", lambda v: v)
    monkeypatch.setattr(store.firestore, "SERVER_TIMESTAMP", "SENTINEL_TIMESTAMP")

    store.record_usage("2026-07", cost_usd=0.1, prompt_tokens=1, output_tokens=1,
                       request_count_delta=3)

    data, _ = doc.set_calls[0]
    assert data["request_count"] == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_store.py -v`
Expected: the 4 new tests FAIL (`AttributeError: module 'app.store.firestore' has no
attribute 'get_usage'`) — pre-existing tests in this file still PASS.

- [ ] **Step 3: Add the two functions to `backend/app/store/firestore.py`**

Append at the end of the file:
```python


def get_usage(month_key: str) -> dict | None:
    doc = client_factory().collection("usage_counters").document(month_key).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def record_usage(month_key: str, *, cost_usd: float, prompt_tokens: int, output_tokens: int,
                  request_count_delta: int = 1) -> None:
    # set(merge=True) with Increment (not update()) is deliberate: update() raises
    # NotFound against a missing document, while set(merge=True) initializes the
    # field from the increment delta if the doc doesn't exist yet — this IS the
    # "new month resets to zero" mechanism, no explicit zeroing code needed.
    client_factory().collection("usage_counters").document(month_key).set(
        {
            "total_cost_usd": firestore.Increment(cost_usd),
            "total_prompt_tokens": firestore.Increment(prompt_tokens),
            "total_output_tokens": firestore.Increment(output_tokens),
            "request_count": firestore.Increment(request_count_delta),
            "updated_at": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_store.py -v`
Expected: all tests PASS (pre-existing + 4 new).

- [ ] **Step 5: Run the full suite**

Run: `cd backend && uv run pytest`
Expected: PASS, no regressions (76 + 4 = 80 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/store/firestore.py backend/tests/unit/test_store.py
git commit -m "feat(backend): add Firestore-backed usage counter store functions"
```

---

### Task 4: Budget-tier module

**Files:**
- Create: `backend/app/core/budget.py`
- Test: `backend/tests/unit/test_budget.py`

**Interfaces:**
- Consumes: `get_usage(month_key: str) -> dict | None` (Task 3);
  `settings.monthly_budget_usd`, `settings.budget_degrade_threshold`,
  `settings.budget_block_threshold` (Task 1).
- Produces: `BudgetTier` enum (`NORMAL`, `DEGRADE_WEB_SEARCH`, `BLOCK`),
  `current_month_key(tz: str = "Asia/Taipei") -> str`,
  `check_budget_tier(settings) -> tuple[BudgetTier, bool]` (second element: `True` if the
  usage read was unavailable, i.e. fail-open occurred).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_budget.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/unit/test_budget.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.budget'`.

- [ ] **Step 3: Create `backend/app/core/budget.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/unit/test_budget.py -v`
Expected: all 9 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd backend && uv run pytest`
Expected: PASS, no regressions (80 + 9 = 89 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/budget.py backend/tests/unit/test_budget.py
git commit -m "feat(backend): add budget-tier classification module"
```

---

### Task 5: Wire budget gating and usage recording into the generation pipeline

**Files:**
- Modify: `backend/app/api/notes.py`
- Test: `backend/tests/api/test_notes.py`

**Interfaces:**
- Consumes: `BudgetTier`, `check_budget_tier` (Task 4); `estimate_cost_usd` (Task 2);
  `record_usage`, `current_month_key` (Tasks 3–4); `settings.rate_limit_per_minute` (Task 1).
- Produces: no new public interface — `run_pipeline`'s external behavior (SSE event shapes)
  gains one new error code (`budget_exceeded`) and extends the existing `pipeline_done` log
  event with `prompt_tokens`, `output_tokens`, `estimated_cost_usd`, `web_search_used` fields
  (additive, no existing field removed).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/api/test_notes.py`:
```python
def _all_steps_methodology():
    return {"categories": ["youtube"],
            "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                      for s in ["structure", "draft", "augment", "verify", "format"]}}


@pytest.mark.asyncio
async def test_block_tier_refuses_before_any_llm_call(monkeypatch):
    calls = {"n": 0}

    async def fake_drive_adk(*a, **k):
        calls["n"] += 1
        return
        yield  # pragma: no cover - unreachable, keeps this an async generator

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    monkeypatch.setattr(notes, "check_budget_tier",
                        lambda _settings: (notes.BudgetTier.BLOCK, False))
    body = "".join([c async for c in notes.run_pipeline(
        _req(), _all_steps_methodology(), notes.get_settings())])
    assert "budget_exceeded" in body
    assert "event: error" in body
    assert calls["n"] == 0  # zero tokens spent — never reached the LLM call


@pytest.mark.asyncio
async def test_degrade_tier_forces_web_search_off(monkeypatch):
    monkeypatch.setattr(notes, "check_budget_tier",
                        lambda _settings: (notes.BudgetTier.DEGRADE_WEB_SEARCH, False))
    captured = {}
    real_build = notes.build_pipeline

    def fake_build(methodology, mode, provider, model, web_search, system):
        captured["web_search"] = web_search
        return real_build(methodology, mode, provider, model, web_search, system)

    monkeypatch.setattr(notes, "build_pipeline", fake_build)

    async def fake_drive_adk(agent, initial_state):
        from types import SimpleNamespace as N
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True, usage_metadata=None)

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    req = NoteRequest(category="youtube", methodology_id="m1", mode="concise",
                       web_search=True, content={"text": "x" * 300})
    body = "".join([c async for c in notes.run_pipeline(
        req, _all_steps_methodology(), notes.get_settings())])
    assert "event: done" in body
    assert captured["web_search"] is False  # forced off despite req.web_search=True


@pytest.mark.asyncio
async def test_normal_tier_leaves_web_search_untouched(monkeypatch):
    monkeypatch.setattr(notes, "check_budget_tier",
                        lambda _settings: (notes.BudgetTier.NORMAL, False))
    captured = {}
    real_build = notes.build_pipeline

    def fake_build(methodology, mode, provider, model, web_search, system):
        captured["web_search"] = web_search
        return real_build(methodology, mode, provider, model, web_search, system)

    monkeypatch.setattr(notes, "build_pipeline", fake_build)

    async def fake_drive_adk(agent, initial_state):
        from types import SimpleNamespace as N
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True, usage_metadata=None)

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    req = NoteRequest(category="youtube", methodology_id="m1", mode="concise",
                       web_search=True, content={"text": "x" * 300})
    body = "".join([c async for c in notes.run_pipeline(
        req, _all_steps_methodology(), notes.get_settings())])
    assert "event: done" in body
    assert captured["web_search"] is True  # untouched under NORMAL tier


@pytest.mark.asyncio
async def test_pipeline_done_logs_usage_and_records_cost(monkeypatch, caplog):
    monkeypatch.setattr(notes, "check_budget_tier",
                        lambda _settings: (notes.BudgetTier.NORMAL, False))
    recorded = {}

    def fake_record_usage(month_key, *, cost_usd, prompt_tokens, output_tokens,
                          request_count_delta=1):
        recorded["month_key"] = month_key
        recorded["cost_usd"] = cost_usd
        recorded["prompt_tokens"] = prompt_tokens
        recorded["output_tokens"] = output_tokens

    monkeypatch.setattr(notes, "record_usage", fake_record_usage)
    monkeypatch.setattr(notes, "estimate_cost_usd", lambda model_id, p, o: 0.0042)

    from types import SimpleNamespace as N
    usage = N(prompt_token_count=120, candidates_token_count=340)

    async def fake_drive_adk(agent, initial_state):
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True, usage_metadata=usage)

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    with caplog.at_level(logging.INFO, logger="app.notes"):
        body = "".join([c async for c in notes.run_pipeline(
            _req(), _all_steps_methodology(), notes.get_settings())])
    assert "event: done" in body
    assert recorded["cost_usd"] == 0.0042
    assert recorded["prompt_tokens"] == 120
    assert recorded["output_tokens"] == 340
    done_records = [r for r in caplog.records
                    if getattr(r, "fields", None) and r.getMessage() == "pipeline_done"]
    assert len(done_records) == 1
    assert done_records[0].fields["prompt_tokens"] == 120
    assert done_records[0].fields["output_tokens"] == 340
    assert done_records[0].fields["estimated_cost_usd"] == 0.0042
    assert done_records[0].fields["web_search_used"] is False


@pytest.mark.asyncio
async def test_record_usage_failure_does_not_surface_as_client_error(monkeypatch, caplog):
    monkeypatch.setattr(notes, "check_budget_tier",
                        lambda _settings: (notes.BudgetTier.NORMAL, False))

    def fake_record_usage(*a, **k):
        raise RuntimeError("firestore write failed")

    monkeypatch.setattr(notes, "record_usage", fake_record_usage)

    from types import SimpleNamespace as N

    async def fake_drive_adk(agent, initial_state):
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True, usage_metadata=None)

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    with caplog.at_level(logging.ERROR, logger="app.notes"):
        body = "".join([c async for c in notes.run_pipeline(
            _req(), _all_steps_methodology(), notes.get_settings())])
    assert "event: done" in body  # client still gets a successful response
    assert "provider_error" not in body
    failed_records = [r for r in caplog.records
                      if getattr(r, "fields", None) and r.getMessage() == "budget_increment_failed"]
    assert len(failed_records) == 1


@pytest.mark.asyncio
async def test_usage_recorded_on_mid_stream_exception(monkeypatch):
    monkeypatch.setattr(notes, "check_budget_tier",
                        lambda _settings: (notes.BudgetTier.NORMAL, False))
    recorded = {"called": False}

    def fake_record_usage(month_key, *, cost_usd, prompt_tokens, output_tokens,
                          request_count_delta=1):
        recorded["called"] = True

    monkeypatch.setattr(notes, "record_usage", fake_record_usage)

    async def fake_events():
        from types import SimpleNamespace as N
        yield N(author="step_structure", partial=False, content=N(parts=[N(text="ok")]),
                grounding_metadata=None, is_final_response=lambda: False, usage_metadata=None)
        raise RuntimeError("boom mid-stream")
        yield  # pragma: no cover - unreachable, keeps this an async generator

    monkeypatch.setattr(notes, "_drive_adk", lambda *a, **k: fake_events())
    body = "".join([c async for c in notes.run_pipeline(
        _req(), _all_steps_methodology(), notes.get_settings())])
    assert "event: error" in body
    assert recorded["called"] is True  # partial runs still spent real tokens
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_notes.py -v`
Expected: the 6 new tests FAIL (`AttributeError: module 'app.api.notes' has no attribute
'check_budget_tier'` / `'BudgetTier'` / `'record_usage'` / `'estimate_cost_usd'`) —
pre-existing tests in this file still PASS.

- [ ] **Step 3: Replace `backend/app/api/notes.py`'s contents**

```python
import time
from collections.abc import AsyncIterator
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.collect import build_source
from app.agents.models import ProviderNotImplemented, build_model
from app.agents.pipeline import build_pipeline
from app.auth.middleware import verify_request
from app.core.budget import BudgetTier, check_budget_tier, current_month_key
from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.pricing import estimate_cost_usd
from app.schemas.events import sse
from app.schemas.requests import NoteRequest
from app.store.firestore import get_methodology, get_prompt_template, record_usage

import logging

from app.core.logging import log_event

logger = logging.getLogger("app.notes")

_FALLBACK_SYSTEM = "你是專業的學習筆記整理者，輸出繁體中文 Markdown。"
_BUDGET_EXCEEDED_MESSAGE = "本月預算已用盡，暫時無法產生新筆記，請稍後再試。"

router = APIRouter()
_APP_NAME = "take-note"
_USER = "owner"


async def _drive_adk(agent, initial_state: dict) -> AsyncIterator:
    """跑 ADK Runner，yield 原始 event。⚠️ event 屬性名（author/partial/
    content.parts/grounding_metadata/is_final_response/usage_metadata）依 ADK 文件確認，
    尤其 usage_metadata 是否為每步驟累計值或逐則差值——見 cost-monitoring spec 的
    Token 用量估算章節，實作時務必對照真實 ADK 事件驗證，不可假設。"""
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name=_APP_NAME, user_id=_USER, state=initial_state)
    runner = Runner(app_name=_APP_NAME, agent=agent, session_service=session_service)
    msg = types.Content(role="user", parts=[types.Part(text="開始整理筆記")])
    run_config = RunConfig(streaming_mode=StreamingMode.SSE)
    async for event in runner.run_async(
        user_id=_USER, session_id=session.id, new_message=msg, run_config=run_config):
        yield event


def _accumulate_usage(last_usage_by_step: dict, author: str, event) -> None:
    # Overwrites (not adds) per author/step, assuming usage_metadata is a
    # cumulative-per-turn value (⚠️ unverified, see _drive_adk's docstring).
    usage = getattr(event, "usage_metadata", None)
    if usage is not None and author:
        last_usage_by_step[author] = usage


def _sum_token_usage(last_usage_by_step: dict) -> tuple[int, int]:
    prompt_tokens = 0
    output_tokens = 0
    for usage in last_usage_by_step.values():
        prompt_tokens += getattr(usage, "prompt_token_count", None) or 0
        output_tokens += getattr(usage, "candidates_token_count", None) or 0
    return prompt_tokens, output_tokens


def _record_usage_safely(model_id: str, prompt_tokens: int, output_tokens: int) -> float | None:
    cost_usd = estimate_cost_usd(model_id, prompt_tokens, output_tokens)
    try:
        record_usage(current_month_key(), cost_usd=cost_usd or 0.0,
                    prompt_tokens=prompt_tokens, output_tokens=output_tokens)
    except Exception as exc:
        # The generation already happened and was already streamed to the
        # client — a bookkeeping write failure must never surface as a client
        # error. Logged individually every time, so a sustained outage is a
        # sustained stream of these, not one silently forgotten failure.
        log_event(logger, logging.ERROR, "budget_increment_failed",
                 error_message=str(exc), cost_usd=cost_usd,
                 prompt_tokens=prompt_tokens, output_tokens=output_tokens)
    return cost_usd


async def run_pipeline(req: NoteRequest, methodology, settings) -> AsyncIterator[str]:
    start = time.monotonic()
    if methodology is None:
        log_event(logger, logging.WARNING, "pipeline_error", code="methodology_not_found")
        yield sse("error", {"code": "methodology_not_found", "message": req.methodology_id})
        return

    tier, usage_unavailable = check_budget_tier(settings)
    if usage_unavailable:
        log_event(logger, logging.WARNING, "budget_check_unavailable")
    if tier == BudgetTier.BLOCK:
        log_event(logger, logging.WARNING, "pipeline_blocked", reason="budget_block")
        yield sse("error", {"code": "budget_exceeded", "message": _BUDGET_EXCEEDED_MESSAGE})
        return

    effective_web_search = req.web_search
    if tier == BudgetTier.DEGRADE_WEB_SEARCH:
        effective_web_search = False
        log_event(logger, logging.INFO, "pipeline_degraded", reason="budget_degrade")

    try:
        tmpl = get_prompt_template("global-style")
        system = (tmpl or {}).get("system") or _FALLBACK_SYSTEM
    except Exception:
        # Firestore transient/permission failure → degrade gracefully to the
        # built-in system prompt rather than failing the whole request.
        system = _FALLBACK_SYSTEM
    try:
        agent = build_pipeline(methodology, req.mode.value, req.provider,
                               req.model, effective_web_search, system)
    except ProviderNotImplemented as exc:
        log_event(logger, logging.WARNING, "pipeline_error", code="provider_not_implemented")
        yield sse("error", {"code": "provider_not_implemented", "message": str(exc)})
        return
    model_id = build_model(req.provider, req.model)
    initial_state = {
        "source": build_source(req.content),
        "direction": req.direction,
        "extra": req.extra_requirements or "",
        "date": datetime.now(ZoneInfo("Asia/Taipei")).date().isoformat(),
    }

    final_markdown = ""
    last_author = None
    last_usage_by_step: dict = {}
    try:
        async for event in _drive_adk(agent, initial_state):
            author = getattr(event, "author", "")
            _accumulate_usage(last_usage_by_step, author, event)
            if author != last_author and author.startswith("step_"):
                if last_author:
                    step_name = last_author.removeprefix("step_")
                    log_event(logger, logging.INFO, "pipeline_step", step=step_name, status="done")
                    yield sse("step", {"step": step_name,
                                       "status": "done", "summary": None})
                step_name = author.removeprefix("step_")
                log_event(logger, logging.INFO, "pipeline_step", step=step_name, status="start")
                yield sse("step", {"step": step_name, "status": "start"})
                last_author = author
            gm = getattr(event, "grounding_metadata", None)
            if gm:
                items = _citations_from(gm)
                if items:
                    yield sse("citations", {"items": items})
            if author == "step_format":
                text = ""
                content = getattr(event, "content", None)
                parts = getattr(content, "parts", None)
                if parts:
                    text = "".join(getattr(p, "text", None) or "" for p in parts)
                if getattr(event, "partial", False) and text:
                    yield sse("delta", {"text": text})
                elif event.is_final_response() and text:
                    final_markdown = text
        if last_author:
            step_name = last_author.removeprefix("step_")
            log_event(logger, logging.INFO, "pipeline_step", step=step_name, status="done")
            yield sse("step", {"step": step_name, "status": "done", "summary": None})
        prompt_tokens, output_tokens = _sum_token_usage(last_usage_by_step)
        cost_usd = _record_usage_safely(model_id, prompt_tokens, output_tokens)
        log_event(logger, logging.INFO, "pipeline_done", markdown_chars=len(final_markdown),
                 elapsed_ms=round((time.monotonic() - start) * 1000, 1),
                 prompt_tokens=prompt_tokens, output_tokens=output_tokens,
                 estimated_cost_usd=cost_usd, web_search_used=effective_web_search)
        yield sse("done", {"markdown": final_markdown})
    except Exception as exc:  # provider/runtime 錯誤 → error 事件，保留已串內容
        prompt_tokens, output_tokens = _sum_token_usage(last_usage_by_step)
        _record_usage_safely(model_id, prompt_tokens, output_tokens)
        log_event(logger, logging.ERROR, "pipeline_error", code="provider_error",
                 error_message=str(exc))
        yield sse("error", {"code": "provider_error", "message": str(exc)})


def _citations_from(gm) -> list[dict]:
    items = []
    for chunk in getattr(gm, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        if web:
            items.append({"title": getattr(web, "title", ""), "url": getattr(web, "uri", "")})
    return items


@router.post("/notes/stream")
@limiter.limit(get_settings().rate_limit_per_minute)
async def notes_stream(request: Request, req: NoteRequest, _email: str = Depends(verify_request)):
    settings = get_settings()
    if len(req.content.text.strip()) < settings.min_content_chars:
        raise HTTPException(status_code=422, detail="content too short")
    methodology = get_methodology(req.methodology_id)
    if methodology is not None and req.category.value not in (methodology.get("categories") or []):
        raise HTTPException(status_code=422, detail="category not allowed for methodology")
    return StreamingResponse(run_pipeline(req, methodology, settings),
                             media_type="text/event-stream")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/test_notes.py -v`
Expected: all tests PASS (pre-existing + 6 new).

- [ ] **Step 5: Run the full suite and lint**

Run: `cd backend && uv run pytest && uv run ruff check .`
Expected: PASS, no regressions (89 + 6 = 95 passed), ruff clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/notes.py backend/tests/api/test_notes.py
git commit -m "feat(backend): gate generation requests through budget tiers, record usage/cost"
```

---

### Task 6: Monitoring — budget-tier log-based metric

**Files:**
- Modify: `infra/monitoring/setup.sh`
- Modify: `infra/monitoring/README.md`

**Interfaces:** None — infra-only, no code interfaces.

- [ ] **Step 1: Add the new log-based metric to `setup.sh`**

In `infra/monitoring/setup.sh`, add immediately after the existing
`create_metric_if_missing backend-rate-limited ...` block (before the final `echo` lines):
```bash

create_metric_if_missing backend-budget-degraded \
  --description="Soft budget-tier events (pipeline_degraded/pipeline_blocked/budget_check_unavailable) from take-note-backend, below the hard \$20 kill-switch" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" (jsonPayload.message="pipeline_degraded" OR jsonPayload.message="pipeline_blocked" OR jsonPayload.message="budget_check_unavailable")'
```

- [ ] **Step 2: Update `README.md`**

In `infra/monitoring/README.md`, update the "What `setup.sh` does" bullet list to add a
fourth entry immediately after `backend-rate-limited`:
```markdown
- `backend-budget-degraded` — soft-tier events: web-search auto-disabled, requests
  refused for budget, or the budget check itself was unavailable (below the hard $20
  kill-switch in `infra/budget-kill-switch/`)
```

Add a new subsection at the end of the file (after the existing "Test" section):
```markdown

## Budget thresholds are separate from the GCP Billing Budget

`MONTHLY_BUDGET_USD`, `BUDGET_DEGRADE_THRESHOLD`, and `BUDGET_BLOCK_THRESHOLD` (backend app
config, see `backend/app/core/config.py`) are **not automatically synced** with the actual
GCP Billing Budget amount that triggers `infra/budget-kill-switch/`. If you ever change the
real GCP budget, update `MONTHLY_BUDGET_USD` to match by hand, or the two systems will
silently drift apart (the soft app-level tiers would fire at the wrong fraction of the real
hard cutoff).
```

- [ ] **Step 3: Verify the script is syntactically valid and idempotent**

Run: `bash -n infra/monitoring/setup.sh`
Expected: no output (syntax OK). Do not actually run the script against real GCP from this
worktree — it requires `gcloud` credentials and modifies real cloud resources; verifying
syntax only is the safe, appropriate check here. Real execution is the user's manual step
(as already documented in this file for the pre-existing metrics), ideally alongside
confirming the `usage_counters` Firestore collection with real data (Task 5 deployed).

- [ ] **Step 4: Commit**

```bash
git add infra/monitoring/setup.sh infra/monitoring/README.md
git commit -m "docs(infra): add budget-tier log-based metric and manual-sync note"
```

## Verification

- `cd backend && uv run pytest` after every task — 66 baseline tests, growing to 95 by the
  end (5 + 5 + 4 + 9 + 6 new tests across Tasks 1–5). Zero regressions expected throughout;
  every new test targets new behavior, no existing test is modified except by pure addition.
- `cd backend && uv run ruff check .` — clean throughout.
- Not verifiable in this environment, flagged for the user's manual confirmation after a real
  deploy (per the design spec's Verification section):
  - The exact shape/semantics of ADK's `usage_metadata` on real `google-adk~=2.3` — whether
    it's present on every event, and whether it's cumulative-per-turn or a delta. Confirm with
    a small scratch script hitting a real (or realistically mocked) ADK `Runner` before
    trusting any cost number in production.
  - Current Vertex AI Gemini pricing accuracy for whatever model id is actually deployed —
    the `PRICING` table in `pricing.py` is a placeholder needing reconciliation against the
    official pricing page, flagged inline with a `⚠️` comment.
  - How closely the `Asia/Taipei`-keyed monthly bucket (`usage_counters/YYYY-MM`) tracks the
    real GCP Billing account's invoice cycle — compare against the first couple of real
    invoices after shipping; this also calibrates how material the web-search/grounding
    token-cost blind spot actually is (Vertex AI Search grounding is billed per-call,
    separately from tokens — not modeled by `estimate_cost_usd`).
  - A real deploy + real spend to confirm the `BLOCK`/`DEGRADE_WEB_SEARCH` tiers actually
    fire at the right dollar amounts and that the friendly `budget_exceeded` error reaches
    the Chrome extension's UI sensibly (the extension side isn't touched by this plan — it
    already has a generic `ErrorState` component from Sub-project A that renders `{code,
    message}` pairs, so `budget_exceeded` should render through the existing path without
    extension changes, but this is worth a manual confirmation, not an assumption).
