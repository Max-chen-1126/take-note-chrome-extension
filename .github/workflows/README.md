# Backend CI/CD

## backend-ci.yml
Runs on every push/PR touching `backend/**`: `uv sync`, `ruff check`, `pytest`.
No GCP access needed.

## backend-deploy.yml
Manual (`workflow_dispatch`) deploy to Cloud Run, wrapping the `gcloud run
deploy` command from `spec/backend-spec.md` §14. Uses Workload Identity
Federation — no long-lived GCP service account key is ever stored in GitHub.

### One-time GCP setup (you do this)

```bash
PROJECT_ID=max-personal-447802
PROJECT_NUMBER=343692970282
POOL_ID=github-pool
PROVIDER_ID=github-provider
SA_NAME=backend-deployer
REPO=Max-chen-1126/take-note-chrome-extension

# 1. Workload Identity Pool
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" --location="global" \
  --display-name="GitHub Actions pool"

# 2. OIDC provider trusting GitHub Actions, scoped by repository
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" --location="global" --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 3. Deploy service account
gcloud iam service-accounts create "$SA_NAME" \
  --project="$PROJECT_ID" --display-name="Backend CI/CD deployer"

# 4. Let the GitHub provider impersonate the deploy SA, restricted to this repo
gcloud iam service-accounts add-iam-policy-binding \
  "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$REPO"

# 5. Grant the deploy SA what it needs to build+deploy via `gcloud run deploy --source`
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# 6. Let the deploy SA act as the Cloud Run *runtime* service account
#    (replace <runtime-sa-email> with the SA already used in your existing
#    `gcloud run deploy --service-account=...` command)
gcloud iam service-accounts add-iam-policy-binding "<runtime-sa-email>" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Then add these **repo secrets** (Settings → Secrets and variables → Actions):
| Secret | Value |
|---|---|
| `GCP_WIF_PROVIDER` | `projects/343692970282/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `GCP_DEPLOY_SA` | `backend-deployer@max-personal-447802.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SA` | the existing Cloud Run runtime service account (from your current manual deploy command) |
| `OAUTH_CLIENT_ID` | same value as your current `.env` / manual deploy flag |
| `ALLOWED_EMAILS` | same value as your current `.env` / manual deploy flag |

### Test
Actions tab → **backend-deploy** → **Run workflow**. Confirm it succeeds, then
`curl https://<service-url>/healthz` returns `{"status":"ok"}`.
