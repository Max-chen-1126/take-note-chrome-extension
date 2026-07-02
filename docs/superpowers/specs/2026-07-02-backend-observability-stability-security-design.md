# Backend Observability, Stability & Security Foundation — Design

> Sub-project **B** of a three-part staged upgrade to `take-note-chrome-extension`:
> (A) frontend design-system/UI-UX rebuild, (B) this document, (C) cost observability &
> tiered control. B was designed first because its logging/monitoring foundation is a
> prerequisite for C's cost tracking.

## Context

Current backend (`backend/`): FastAPI on Cloud Run (asia-east1), Google ADK
`SequentialAgent` pipeline calling Gemini via Vertex AI, Firestore-backed methodology
config, single-user (email allowlist of one address). Recent commits already added
meaningful hardening: app-layer ID-token auth, `slowapi` IP rate limiting, oversized-body
rejection, hidden API docs in prod, and a Pub/Sub-triggered budget kill-switch Cloud
Function that revokes public IAM access if GCP billing exceeds threshold.

Exploration of `backend/app/` and `spec/backend-spec.md` surfaced concrete gaps this
sub-project closes:

- No structured logging or monitoring/alerting exists at all (`core/logging.py` is
  referenced in the spec's project structure but was never implemented).
- No CI/CD — deployment is a hand-typed `gcloud run deploy ...` command.
- `backend/app/core/limiter.py`'s rate limiter is in-memory and only correct because
  `max-instances=1`; nothing enforces that assumption, so a future instance-count bump
  would silently break the abuse guard.
- `backend/app/core/hygiene.py` (`[[VAR]]` placeholder resolver, prevents hardcoding
  identity/sensitive values into prompts) is fully written but never called from the
  request pipeline — explicit `TODO(Phase B)` in the file.
- The spec already plans a **Cloud Run built-in IAP** edge-auth migration
  (`spec/backend-spec.md` §8) to replace today's app-layer-only token verification, but
  flags that it needs a feasibility spike first (does
  `chrome.identity.launchWebAuthFlow` work against IAP's programmatic-access allowlist?).
  This has never been attempted.

**Naming note**: the existing spec already uses "Phase A/B/C" for a different axis
(provider rollout: Gemini-only → +OpenAI/Claude → ...). This design's "sub-project B" is
orthogonal to that — it does NOT add OpenAI/Claude support. Where this design's scope
happens to overlap an existing spec `TODO(Phase B)` (hygiene wiring, IAP), that's called
out explicitly below.

## Goals

1. Give the backend structured logs and basic alerting so future debugging, abuse
   detection, and (later) cost tracking have data to work from.
2. Make deploys repeatable and safe via CI (test/lint gate) instead of a manually-typed
   `gcloud` command.
3. Close the rate-limiter's silent-correctness gap with a cheap startup guard, not a
   distributed-store rewrite (over-engineering for a single-user personal project).
4. Wire up the already-written `hygiene.py` context resolver into the actual request
   pipeline.
5. Resolve the open IAP question via a time-boxed spike, then either migrate or
   explicitly close it out as "not viable, staying on app-layer auth."

## Explicit non-goals (deferred to other sub-projects / later work)

- `generate_config()` / Gemini thinking-budget wiring — stays unwired here. Enabling
  `effort=High` directly increases token spend, so it should be turned on together with
  sub-project C's cost tracking/alerting, not before.
- OpenAI/Claude provider support — unrelated feature expansion, not a stability/security
  concern.
- Any multi-tenant or per-user quota system — the product is still single-user
  (`ALLOWED_EMAILS` allowlist of one address); building quota infra now would be
  speculative.
- Frontend changes — sub-project A, separate spec.

## Design

### 1. Structured logging (`backend/app/core/logging.py`)
- Implement the module the spec already reserves a slot for. JSON-formatted log records
  to stdout (Cloud Run/Cloud Logging captures stdout automatically — no new
  infrastructure or cost).
- Fields: `request_id` (generate per request, propagate through the SSE pipeline),
  `route`, `step` (for pipeline steps: structure/draft/augment/verify/format),
  `latency_ms`, `status_code`/`error_code`, `caller_email` (from verified token, for
  abuse triage — never log the raw token itself).
- Explicitly redact: ID tokens, Firestore document contents beyond IDs, full request
  bodies. Log shape/size, not raw user content.
- Wire into: `backend/app/main.py` middleware (request start/end),
  `backend/app/api/notes.py` (per pipeline step), `backend/app/auth/middleware.py`
  (401/403 outcomes).

### 2. Monitoring & alerting (GCP-native, no new paid tooling)
- Uptime check on `GET /healthz`.
- Log-based metrics + alerting policies (via `gcloud logging metrics create` /
  `gcloud alpha monitoring policies create`, documented as a runbook script similar in
  style to `infra/budget-kill-switch/README.md` — no Terraform, consistent with the
  rest of this repo's manual-gcloud deployment style):
  - Error rate (5xx / `error` SSE events) above threshold.
  - 401/403 rate spike (credential-stuffing / abuse signal).
  - Rate-limit-exceeded (429) rate — early warning that ties into sub-project C's cost
    concerns.
- Output: an `infra/monitoring/` directory (mirrors the existing
  `infra/budget-kill-switch/` layout) with the setup script(s) and a short runbook doc,
  not a live dashboard build.

### 3. CI/CD (GitHub Actions)
- `.github/workflows/backend-ci.yml`: on push/PR touching `backend/**` — `uv sync`,
  lint (ruff), `pytest` (unit + bdd). Required check before merge.
- `.github/workflows/backend-deploy.yml`: `workflow_dispatch`-triggered (manual button,
  not automatic on merge) — wraps the exact `gcloud run deploy` invocation from
  `spec/backend-spec.md` §14, parameterized via repo secrets/vars instead of hand-typed
  flags. Manual trigger is intentional: keeps a human deploy decision in the loop for a
  low-traffic personal service, while removing the risk of a mistyped flag.

### 4. Rate limiter guard (`backend/app/core/limiter.py` / `backend/app/core/config.py`)
- Add an `expected_max_instances: int = 1` setting and a startup check (same pattern as
  the existing `_require_oauth_client_id_on_cloud_run` validator) that fails fast if a
  future deploy sets `--max-instances` above this without deliberately updating the
  setting. This makes the current in-memory-limiter assumption an explicit, enforced
  contract instead of a comment.
- No migration to Redis/Memorystore/Firestore-backed limiting — not justified for a
  single-user service; would be pure cost/complexity for no correctness gain today.

### 5. `hygiene.py` wiring
- Call `hygiene.resolve()` on each step's `instruction` string (and the global-style
  system prompt) immediately after the Firestore methodology/template load, before
  `SequentialAgent` assembly — matching the placement the module's own docstring already
  specifies (`backend/app/agents/pipeline.py` is the integration point).
- Add a unit test confirming `[[VAR]]` placeholders resolve via override → env → blank,
  and that unresolved identity/sensitive values never reach the LLM call.

### 6. IAP migration spike (`spec/backend-spec.md` §8 open question)
- Time-boxed spike: create a throwaway custom OAuth client, add it to a Cloud Run
  service's IAP `programmatic_clients` allowlist, and verify
  `chrome.identity.launchWebAuthFlow` can obtain an ID token IAP accepts end-to-end.
- **If it works**: migrate — enable `--iap` on the Cloud Run service, remove the
  app-layer `verify_request` token-signature/audience check, read
  `X-Goog-Authenticated-User-Email` instead, keep the existing email-allowlist check.
  Update `spec/backend-spec.md` §8 to move this from "planned" to "implemented."
- **If it doesn't work** (e.g. Google-managed client restrictions block programmatic
  access): document the finding in the spec, close the open question, and stay on the
  current app-layer auth — no code change needed in this branch.
- This task is last and gated on spike results precisely because it's the highest-risk,
  most reversible-cost item; everything else in this design ships regardless of its
  outcome.

## Verification

- `pytest` (unit + bdd) green locally and in the new CI workflow.
- Manual: trigger `backend-deploy.yml`, confirm deploy succeeds via `curl /healthz`.
- Manual: send a request that trips the body-size limit and one that trips the rate
  limiter; confirm both appear as structured log entries and trip their respective
  Cloud Monitoring alerting policies.
- Manual: temporarily set `--max-instances=2` in a test deploy and confirm the app
  fails to start with a clear error (guard works), then revert.
- Unit test: `hygiene.resolve()` called with a real methodology instruction containing
  `[[VAR]]` resolves correctly end-to-end through the pipeline assembly path.
- IAP spike: documented pass/fail outcome in `spec/backend-spec.md` §8, plus (if viable)
  an end-to-end curl test against the IAP-protected Cloud Run URL with a token obtained
  via the extension's real auth flow.
