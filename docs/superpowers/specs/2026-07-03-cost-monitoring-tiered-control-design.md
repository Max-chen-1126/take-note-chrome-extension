# Sub-project C: Cost Monitoring & Tiered Control — Design

## Context

Three-part staged upgrade to `take-note-chrome-extension`: Sub-project A (frontend design
system) shipped and merged to `main` via PR #6; Sub-project B (backend observability,
stability & security) shipped and merged via PR #5. This is Sub-project C: cost
observability and tiered spend control for the backend.

The backend already has exactly one cost guardrail: `infra/budget-kill-switch/main.py`, a
Pub/Sub-triggered Cloud Function that revokes public access on the Cloud Run service (removes
`allUsers` from `run.invoker`) when a GCP Billing Budget alert fires (around a $20/month
threshold configured in GCP Billing, outside this repo). It is binary — fully open to fully
403 — and has real lag, since GCP billing data isn't real-time. It gives no warning and no
graceful degradation before it fires. This sub-project adds a softer, app-level layer that
sits between normal operation and that hard kill-switch: tracking actual spend and degrading
gracefully as it climbs, instead of going from 100% healthy to 100% down with no warning.

This backend is single-developer, personal-use — one flat email allowlist
(`ALLOWED_EMAILS`) gates a single shared service. It is explicitly not multi-tenant, and this
design does not attempt to make it one.

Three rounds of clarifying questions to the user went unanswered during planning (they were
away from keyboard). This design proceeds on the best-supported reading of "cost monitoring
and tiered control," with every non-obvious judgment call called out explicitly below so it's
easy to override rather than silently assumed.

## Existing state (verified against source)

- **LLM call site (the only one):** `backend/app/api/notes.py::run_pipeline` drives a Google
  ADK `Runner` via `_drive_adk`, streaming over SSE (`RunConfig(streaming_mode=StreamingMode.SSE)`).
  Model selection: `backend/app/agents/models.py::build_model` — only `Provider.gemini` is
  implemented (`DEFAULT_MODELS = {Provider.gemini: "gemini-3.5-flash"}`). No token usage or
  cost is captured anywhere today; `run_pipeline` only logs `markdown_chars` and `elapsed_ms`.
- **Rate limiting:** `backend/app/core/limiter.py` — a `slowapi.Limiter` keyed by client IP,
  applied only to `POST /notes/stream` via a hardcoded `@limiter.limit("10/minute")`
  decorator. In-memory storage, explicitly guarded by a `pydantic` validator in
  `config.py::Settings._require_single_instance_for_in_memory_limiter` that raises if
  `expected_max_instances` is ever changed from `1` without first migrating off in-memory
  storage.
- **Usage/cost storage:** none. `backend/app/store/firestore.py` only caches read-mostly
  reference data (methodologies, prompt templates) via a shared `client_factory()`.
- **Auth:** `backend/app/auth/middleware.py::verify_request` validates a Google OAuth ID token
  against `settings.allowed_email_set`. The authenticated email is already threaded through
  `notes.py` as a dependency, but there is no per-user state or tiers beyond allowlist
  membership.
- **Config:** `backend/app/core/config.py::Settings` (pydantic-settings) — no budget/cost/
  pricing config exists at the app layer; the $20 threshold lives entirely in GCP Billing.
- **Existing monitoring:** `infra/monitoring/setup.sh` creates 3 free-tier Cloud Logging
  log-based metrics (`backend-error-rate`, `backend-auth-denied`, `backend-rate-limited` — the
  last one's README already frames it as "an early cost-runaway warning"). Alerting policies
  are documented as a manual follow-up, not yet deployed.

## Goals

1. Estimate and log per-request token usage and USD cost for every generation request.
2. Persist a durable, atomically-incremented cumulative monthly spend counter.
3. Gate requests through two graceful degradation tiers below the existing hard kill-switch:
   disable the (costlier) web-search tool, then refuse new requests with a friendly error.
4. Close an existing gap while in this area: make the previously-hardcoded `10/minute` rate
   limit a proper config value.
5. Add monitoring visibility (a new log-based metric) for the new degrade/block/unavailable
   events, without duplicating the existing 3 metrics.

## Non-goals

- No multi-tenant/per-user tiering — one global counter, matching the single-shared-service
  reality of this backend.
- No new authenticated `GET /usage` (or similar) endpoint — the developer already has direct
  Firestore/GCP console access; a new endpoint is attack surface for a feature with one
  consumer who doesn't need it.
- No dynamic coupling between the rate limiter and budget tiers — they guard different
  failure modes (short-term burst vs. long-term cumulative spend) and coupling them adds a
  new "which control fired and why" axis without a clear benefit at this traffic scale.
- No grounding-specific cost surcharge constant — Vertex AI Search grounding (the
  `web_search` tool) is billed per-call, separately from tokens, so a token-only estimate will
  undercount grounded requests. Rather than stack one unverified guess (a surcharge constant)
  on top of another (the token pricing table itself), this is logged as a known, accepted
  blind spot via a `web_search_used` field, to be recalibrated later against real invoices.
- No local durable retry queue for failed Firestore spend-increment writes — solving for data
  durability under partial outages is disproportionate to a personal project's actual risk (a
  few dollars of undercounted spend during a rare blip), especially with the hard kill-switch
  remaining as the ultimate backstop regardless.

## Design

### 1. Token usage & cost estimation

New `backend/app/core/pricing.py`:
- `PRICING: dict[str, tuple[float, float]]` — model id → `(usd_per_1M_input_tokens,
  usd_per_1M_output_tokens)`, sourced from **Vertex AI** Gemini pricing (not AI Studio
  pricing — `config.py`'s `google_genai_use_vertexai: bool = True` means Vertex pricing
  applies, and the two can differ). Carries a `⚠️` comment in this codebase's existing style
  (see `models.py`'s `DEFAULT_MODELS` comment) flagging that the exact per-unit price and
  billing granularity must be reconciled against the official Vertex AI pricing page — and
  against whatever real model id is actually deployed — before the numbers are trusted, not
  filled in confidently now.
- `estimate_cost_usd(model_id: str, prompt_tokens: int, output_tokens: int) -> float | None`
  — returns `None` (not `0.0`) for an unpriced model, so callers can distinguish "genuinely
  free/zero" from "unknown price, don't trust this number." Logs a one-time-per-process
  WARNING (`pricing_unknown_model`) on the unpriced case.

**What is verified vs. unverified about ADK's usage metadata:** ADK events are expected to
expose a `usage_metadata` attribute (parallel to `google-genai`'s `GenerateContentResponse
.usage_metadata`, with `prompt_token_count`/`candidates_token_count`/`total_token_count`) —
this is grounded in public ADK discussions/samples, not confirmed against the actually
installed `google-adk~=2.3` source (unavailable in the exploration environment used to write
this design). Two specific things need confirmation before implementation trusts any number,
following this codebase's own convention of `⚠️`-flagging doc-verification needs (see
`_drive_adk`'s existing docstring, which already flags uncertainty about event attribute
names like `author`/`partial`/`content.parts`):
1. Whether `usage_metadata` is present on every streamed event or only specific ones.
2. Whether the value, when present on a partial/streamed chunk, is **cumulative for that
   turn** or a **delta** — getting this wrong either double-counts or under-counts silently,
   with nothing that crashes to alert you.

There is also a known upstream issue (`google/adk-python#2065`) describing `usage_metadata`
reliability problems specifically under `LiteLLM` + tool use + `StreamingMode.SSE` — directly
relevant since this pipeline uses SSE streaming and optionally attaches a `google_search` tool
during the `verify` step. Treat token/cost numbers on `web_search=True` requests as
lower-confidence than on plain requests.

**Accumulation strategy** (to be verified against real ADK behavior, not assumed correct):
`run_pipeline` maintains a `last_usage_by_step: dict[str, usage_metadata]`, overwriting the
entry for the current `author`/step on every event that carries usage metadata (assuming
cumulative-per-turn semantics per point 2 above), then sums across the dict's values at the
end — one entry per pipeline step (structure/draft/augment/verify/format), since each is a
separate `LlmAgent` sub-agent call with its own token cost. This avoids double-counting SSE
partials of the same step while still counting every step's separate call.

### 2. Firestore-backed cumulative spend counter

New functions in `backend/app/store/firestore.py` (same module, following its existing
`client_factory()`-reuse pattern, no changes to existing functions):
- `get_usage(month_key: str) -> dict | None` — reads
  `collection("usage_counters").document(month_key)`. Returns `None` on read failure or
  missing doc (a missing doc legitimately means "new month, zero spend so far" — the caller
  distinguishes this from a failure).
- `record_usage(month_key: str, *, cost_usd: float, prompt_tokens: int, output_tokens: int,
  request_count_delta: int = 1) -> None` — writes via
  `document(month_key).set({"total_cost_usd": Increment(cost_usd), ...,
  "updated_at": SERVER_TIMESTAMP}, merge=True)`. Using `set(merge=True)` with `Increment`
  (not `update()`) is deliberate: `update()` raises `NotFound` against a missing document,
  while `set(merge=True)` initializes the field from the increment delta if the document
  doesn't exist yet. **This is the entire "reset for a new month" mechanism** — no explicit
  zeroing code is needed, since a new calendar month simply targets a new, not-yet-existing
  document ID. `Increment` is a Firestore server-side field transform, atomic per field
  regardless of concurrent writers — no read-modify-write transaction is needed, since the
  budget-tier check and the increment are two intentionally separate, non-atomic steps (see
  Failure modes below for what that implies).

**Schema:** new collection `usage_counters`, one document per calendar month, ID format
`YYYY-MM` in `Asia/Taipei` (matching this codebase's existing date-stamping convention in
`notes.py`'s `initial_state["date"]` — chosen for consistency, not because it's guaranteed to
align with GCP's own billing-cycle timezone, which is an accepted, inherent skew only
checkable by comparing against real invoices):
```
usage_counters/2026-07
{
  total_cost_usd: float,
  total_prompt_tokens: int,
  total_output_tokens: int,
  request_count: int,
  updated_at: server timestamp
}
```
No per-model breakdown field for now — only `Provider.gemini` is implemented, so a breakdown
map is speculative structure with no second model to justify it yet; Firestore is schemaless,
so this is a trivial, non-breaking addition later. Old month documents are left in place
indefinitely (negligible storage at this scale); this doubles as a free lightweight monthly
history log, not something to build tooling around now.

### 3. Tiered degradation

New `backend/app/core/budget.py`:
- `class BudgetTier(str, Enum): NORMAL, DEGRADE_WEB_SEARCH, BLOCK` — two active tiers, not
  three. A separate silent `WARN` tier was considered and dropped: it would produce no
  user-visible or system behavior change, and the new cost-based log-based metric (below)
  already gives a continuous early signal via Cloud Monitoring without needing a distinct
  threshold/branch in request-handling code.
- `current_month_key(tz: str = "Asia/Taipei") -> str` — returns `"YYYY-MM"`.
- `check_budget_tier(settings) -> tuple[BudgetTier, bool]` — the second element flags whether
  the usage read was unavailable (used for fail-open logging, see Failure modes). Reads
  `get_usage(current_month_key())`; on read failure, returns `(BudgetTier.NORMAL, True)`
  (fail open). Otherwise computes `spend / settings.monthly_budget_usd` and compares against
  `settings.budget_degrade_threshold` / `budget_block_threshold`.

| Tier | Threshold (config field, default) | Action |
|---|---|---|
| NORMAL | < 75% | Normal service. |
| DEGRADE_WEB_SEARCH | ≥ `budget_degrade_threshold` (0.75) | Force `web_search=False`; generation proceeds otherwise. |
| BLOCK | ≥ `budget_block_threshold` (0.90) | Refuse before any LLM call; friendly SSE `error` event, code `budget_exceeded`. |
| *(existing, outside this repo)* | 100% via GCP Billing → Pub/Sub | Hard kill-switch: service goes fully 403. |

The 90% app-level `BLOCK` sitting below the 100% infra kill-switch (which itself has real
billing-data lag) gives a friendly-error buffer zone before the harsher, manually-reversed
403.

Wiring in `backend/app/api/notes.py::run_pipeline`: `check_budget_tier(settings)` runs before
`build_pipeline`.
- `BLOCK` → `yield sse("error", {"code": "budget_exceeded", "message": <friendly text>})`,
  `return` — **before** `build_pipeline`/`_drive_adk` are invoked, so a blocked request
  provably spends zero tokens.
- `DEGRADE_WEB_SEARCH` → force an effective `web_search=False` into pipeline construction
  (without mutating `req` itself, so `req` still reflects true client intent for logging);
  log `pipeline_degraded` with `reason="budget_degrade"`.
- Regardless of tier, if the usage read was unavailable, log a separate
  `budget_check_unavailable` WARNING (feeds the new log-based metric) — this is how a
  Firestore outage silently blinding the budget gate becomes visible instead of invisible.

After the pipeline completes (both the success path, alongside the existing `pipeline_done`
log, and the exception path, since partial runs still spent real tokens): compute summed
`prompt_tokens`/`output_tokens` and `estimate_cost_usd(...)`, add these plus
`web_search_used=req.web_search` as new fields on the existing `pipeline_done` log call
(extending it, not duplicating it), then call `record_usage(...)` wrapped in its own
`try/except` (a write failure must never turn an already-streamed response into a client
error — see Failure modes).

### 4. Config additions

New `Settings` fields in `backend/app/core/config.py`:
- `rate_limit_per_minute: str = "10/minute"` — closes the existing hardcoded-value gap;
  `@limiter.limit("10/minute")` in `notes.py` becomes
  `@limiter.limit(get_settings().rate_limit_per_minute)`.
- `monthly_budget_usd: float = 20.0` — **not automatically synced** to the real GCP Billing
  Budget amount, which lives entirely outside this repo. This must be documented as a manual
  parity requirement: changing the real $20 GCP budget without also updating this value lets
  the two systems drift apart silently.
- `budget_degrade_threshold: float = 0.75`
- `budget_block_threshold: float = 0.90`
- New `model_validator(mode="after")` `_require_ordered_budget_thresholds` — raises unless
  `0 < degrade < block <= 1.0`, matching the exact rigor of the two existing validators in
  this file (fail loudly at startup on misconfiguration, never silently produce nonsense
  gating at request time).

### 5. Monitoring

`infra/monitoring/setup.sh` + `README.md`:
- Add one new log-based metric for `pipeline_degraded` / `budget_check_unavailable` events
  (block events can either route through the existing error-shaped logging or get their own
  filter — either is fine, just be consistent with the existing 3 metrics' style).
- README gets a short note: app-level budget thresholds are independent of the GCP Billing
  Budget amount and must be kept in sync by hand.
- Do not repurpose the existing `backend-rate-limited` metric (already framed as an "early
  cost-runaway warning") — add the new cost-based signal alongside it as defense-in-depth (two
  independent signals: request-volume-based and dollar-based), not instead of it.
- A Cloud Monitoring counter-type metric summing `estimated_cost_usd` from `pipeline_done`
  events is a reasonable nice-to-have cross-check against the Firestore total, but cannot
  replace it: metric ingestion has multi-minute lag, the same lag problem that makes the
  existing infra kill-switch feel coarse — this is exactly why the Firestore counter, read
  synchronously in the request path, is structurally necessary for `DEGRADE`/`BLOCK` to work
  at all.

## Failure-mode handling

Two independent failure points, each with a deliberate, distinct answer:

**(a) Firestore unreachable during the pre-request budget check.** Fail open — treat as
`BudgetTier.NORMAL`, allow the request through, log a distinct `budget_check_unavailable`
WARNING. This exactly mirrors existing precedent in the same function: `run_pipeline` already
catches Firestore failures on the prompt-template read and degrades to `_FALLBACK_SYSTEM`
rather than failing the request. A monitoring/gating subsystem being flaky must never be able
to take the whole service down; the existing hard kill-switch remains the true backstop
regardless of whether this soft layer is temporarily blind. The loud WARNING log is what
prevents "fail open" from silently becoming "fail open forever, unnoticed."

**(b) Firestore unreachable during the post-request increment (write).** The generation
already happened and was already streamed to the client — a bookkeeping failure here must
never surface as a client-facing error. Log `budget_increment_failed` with the request's own
computed cost (visible in raw logs even though it misses the cumulative counter), and accept
the resulting undercount as a known, bounded trade-off. A durable local retry queue would
solve a data-durability problem disproportionate to a personal project's actual risk (a few
dollars of undercounted spend during a rare blip), with the hard kill-switch remaining as
backstop regardless.

Neither failure mode can accidentally block all traffic on a Firestore hiccup (prevented by
fail-open + loud log) nor silently bypass cost tracking forever (prevented by every increment
failure being logged individually, every time, rather than a one-time silent skip — a
sustained outage produces a sustained stream of `budget_increment_failed` logs, not one
forgotten failure).

## File structure

```
backend/app/
  core/
    pricing.py                <- NEW: pricing table + estimate_cost_usd
    budget.py                 <- NEW: BudgetTier enum + check_budget_tier
    config.py                 <- MODIFIED: rate_limit_per_minute, monthly_budget_usd,
                                  budget_degrade_threshold, budget_block_threshold,
                                  new ordering validator
  store/
    firestore.py               <- MODIFIED: get_usage, record_usage
  api/
    notes.py                   <- MODIFIED: budget-tier gating + usage accumulation/logging
                                   + rate-limit decorator now reads from Settings
backend/tests/
  unit/
    test_pricing.py             <- NEW
    test_budget.py               <- NEW
    test_store.py                <- MODIFIED: get_usage/record_usage tests
    test_config.py               <- MODIFIED: threshold-ordering validator tests
  api/
    test_notes.py                 <- MODIFIED: tier-gating + usage-accumulation tests
infra/monitoring/
  setup.sh                        <- MODIFIED: new log-based metric
  README.md                        <- MODIFIED: sync-by-hand note
```

## Verification

- `cd backend && uv run pytest` after each change — existing suite plus new unit tests:
  `pricing.estimate_cost_usd` (known model → correct math; unknown model → `None`; zero
  tokens → `0.0`); `budget.check_budget_tier` (boundary values just below/at/above each
  threshold, plus the fail-open path); `store.get_usage`/`record_usage` (mirroring the
  existing fake `_Client`/`_Coll`/`_Doc` monkeypatch pattern in `test_store.py`, asserting
  `Increment`/`set(merge=True)` called with correct deltas, and the Firestore-unreachable
  path for both read and write); the new config validator (mirroring existing validator
  tests); and two route-level tests — a `BLOCK`-tier request must yield `budget_exceeded` and
  must **never invoke `_drive_adk`** (asserting zero calls, proving zero tokens spent), and a
  `DEGRADE`-tier request with `req.web_search=True` must still result in an effective
  `web_search=False` reaching pipeline construction.
- Not unit-testable, flagged for manual verification after a real deploy: the exact
  shape/semantics of ADK's `usage_metadata` (cumulative vs. delta, which events carry it) —
  needs a manual scratch script against the real installed `google-adk` before trusting any
  number in production; current Vertex pricing accuracy (pricing pages drift, recommend an
  "as-of" verification date comment and periodic manual re-check); how closely the
  `Asia/Taipei`-keyed monthly bucket tracks the real GCP Billing account's cycle boundary
  (compare `usage_counters/{month}.total_cost_usd` against the first couple of real invoices
  after shipping, which also calibrates how material the web-search/grounding blind spot
  actually is).
