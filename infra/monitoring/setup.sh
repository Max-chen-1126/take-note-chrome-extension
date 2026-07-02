#!/usr/bin/env bash
# One-time setup for take-note-backend log-based metrics + uptime check.
# Mirrors infra/budget-kill-switch/'s style: plain gcloud commands, run by hand.
# Depends on the structured logging added in
# docs/superpowers/plans/2026-07-02-backend-observability-stability-security.md
# Task 3 (fields: message, status_code, on loggers app.request/app.auth/app.notes).
set -euo pipefail

PROJECT_ID="max-personal-447802"
SERVICE_NAME="take-note-backend"

gcloud logging metrics create backend-error-rate \
  --project="$PROJECT_ID" \
  --description="request_failed / pipeline_error events from take-note-backend" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" (jsonPayload.message="request_failed" OR jsonPayload.message="pipeline_error")'

gcloud logging metrics create backend-auth-denied \
  --project="$PROJECT_ID" \
  --description="401/403 auth_denied events from take-note-backend" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" jsonPayload.message="auth_denied"'

gcloud logging metrics create backend-rate-limited \
  --project="$PROJECT_ID" \
  --description="429 responses from take-note-backend" \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="'"$SERVICE_NAME"'" jsonPayload.status_code=429'

echo "Log-based metrics created. Next: create the uptime check and alerting"
echo "policies — see infra/monitoring/README.md (gcloud monitoring CLI syntax"
echo "changes over time, so confirm exact flags with --help before running,"
echo "per this repo's own re-verification convention in spec/backend-spec.md)."
