# Monitoring & Alerting

Log-based metrics + an uptime check for `take-note-backend`, built on the
structured JSON logs added in the backend observability plan. No new paid
tooling — everything here is Cloud Logging/Cloud Monitoring free tier.

## What `setup.sh` does
Creates three log-based metrics from the structured log fields (`message`,
`status_code`) emitted by `app.request`/`app.auth`/`app.notes`:
- `backend-error-rate` — request/pipeline failures
- `backend-auth-denied` — 401/403s (credential-stuffing / abuse signal)
- `backend-rate-limited` — 429s (early cost-runaway warning)

Run once: `bash infra/monitoring/setup.sh`

## Remaining manual steps (you do this)

1. **Notification channel**: Console → Monitoring → Alerting → Edit
   notification channels → add your email. Note the channel ID
   (`projects/max-personal-447802/notificationChannels/...`).

2. **Uptime check** on `/healthz`. Confirm exact flags first (gcloud's
   monitoring surface changes between versions — this repo's own convention,
   see `spec/backend-spec.md`'s "知識截止陷阱" note, is to re-verify CLI
   syntax against `--help`/official docs before running, not trust
   memorized flags):
   ```
   gcloud monitoring uptime create --help
   ```
   Then create a check against `https://<service-url>/healthz` (HTTPS, path
   `/healthz`, expect `200`).

3. **Alerting policies** binding each log-based metric above to the
   notification channel from step 1. Confirm exact flags first:
   ```
   gcloud alpha monitoring policies create --help
   ```
   Threshold suggestion: alert if `backend-error-rate` or
   `backend-auth-denied` exceed a few events in a 5-minute window; alert on
   any `backend-rate-limited` events (429s should be rare for a single-user
   service, so any sustained rate is worth a look).

## Test
```
gcloud logging metrics list --project=max-personal-447802
```
Expect the three metrics above listed. Trigger a real 401 (bad token) and a
429 (exceed 10/minute on `/notes/stream`) against the deployed service, then
check Cloud Logging shows matching entries and (once alerting policies exist)
that the alert fires.
