# Budget Kill-Switch

Automatic cost circuit-breaker for the `take-note-backend` Cloud Run service.

## How it works
GCP Billing budget → Pub/Sub topic `budget-alerts` → this Cloud Function. When the
month's cost reaches the budget amount, the function removes `allUsers` from the
service's `roles/run.invoker` binding → the service goes private → all public
(extension) traffic gets `403` and billable work stops. Reversible.

## Deployed resources (already set up)
- Pub/Sub topic: `budget-alerts`
- Cloud Function (2nd gen, asia-east1): `budget-kill-switch` (entry `kill_switch`,
  env `PROJECT_ID/REGION/SERVICE_NAME`)
- The function's runtime SA has `roles/run.admin` scoped to the `take-note-backend` service.

## One manual step (you do this)
Create the budget and point it at the topic:
1. Console → **Billing → Budgets & alerts → Create budget**.
2. Scope to project `max-personal-447802`; amount **$20/month**; thresholds e.g. 50% / 90% / 100%.
3. **Manage notifications → Connect a Pub/Sub topic** → select `budget-alerts`.

(The email alerts on 50/90% give you warning; the 100% message triggers the kill-switch.)

## Restore after a kill (when ready to serve again)
```
gcloud run services add-iam-policy-binding take-note-backend \
  --region=asia-east1 --project=max-personal-447802 \
  --member=allUsers --role=roles/run.invoker
```

## Test
```
gcloud pubsub topics publish budget-alerts --project=max-personal-447802 \
  --message='{"costAmount":20,"budgetAmount":20,"alertThresholdExceeded":1.0}'
# → within ~1–2 min the service /methodologies returns 403; then restore as above.
```
