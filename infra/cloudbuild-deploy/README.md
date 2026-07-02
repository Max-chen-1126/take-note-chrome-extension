# Backend Deploy (Cloud Build)

Manually-triggered Cloud Build deploy for `take-note-backend`, replacing the earlier
GitHub-Actions-plus-Workload-Identity-Federation design. Cloud Build runs natively inside
the GCP project, so this needs no OIDC federation and no GitHub repo secrets — only
GCP-side IAM grants and one Console step to connect the repo.

Build config: `backend/cloudbuild.yaml` (build image → push to Artifact Registry →
`gcloud run deploy --image=...`). Deliberately does NOT use `gcloud run deploy --source=`
from inside Cloud Build — that would trigger a second, nested Cloud Build, adding an
indirection layer for no benefit here.

## One-time GCP setup (you do this)

1. **Connect the GitHub repo to Cloud Build** (Console → Cloud Build → Repositories →
   Connect Repository → GitHub → authorize + select
   `Max-chen-1126/take-note-chrome-extension`). This is currently most reliably done via
   Console; if your `gcloud` version supports a non-interactive equivalent, confirm exact
   syntax with `gcloud builds repositories --help` first (per this repo's own convention
   of re-verifying CLI flags before running rather than trusting memorized syntax — see
   `spec/backend-spec.md`'s "知識截止陷阱" note).

2. **Create the Artifact Registry repo** (one-time):
   ```bash
   gcloud artifacts repositories create take-note-backend \
     --project=max-personal-447802 --location=asia-east1 --repository-format=docker
   ```

3. **Grant the Cloud Build service account what it needs.** Cloud Build's default runtime
   SA is `<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com` (find yours via
   `gcloud projects describe max-personal-447802 --format='value(projectNumber)'`):
   ```bash
   CB_SA="<PROJECT_NUMBER>@cloudbuild.gserviceaccount.com"
   gcloud projects add-iam-policy-binding max-personal-447802 \
     --member="serviceAccount:$CB_SA" --role="roles/run.admin"
   gcloud projects add-iam-policy-binding max-personal-447802 \
     --member="serviceAccount:$CB_SA" --role="roles/artifactregistry.writer"
   gcloud iam service-accounts add-iam-policy-binding "<runtime-sa-email>" \
     --project=max-personal-447802 \
     --member="serviceAccount:$CB_SA" --role="roles/iam.serviceAccountUser"
   ```
   (Replace `<runtime-sa-email>` with the existing Cloud Run runtime service account — the
   same one used in your current manual deploy command.)

4. **Create the manual trigger**, supplying the environment-specific substitutions here
   rather than committing them to the repo (confirm exact flags with
   `gcloud builds triggers create manual --help` first — Cloud Build's trigger-creation
   syntax has changed across gcloud versions):
   ```bash
   gcloud builds triggers create manual \
     --project=max-personal-447802 \
     --name=backend-deploy \
     --repo=https://github.com/Max-chen-1126/take-note-chrome-extension \
     --repo-type=GITHUB \
     --branch=main \
     --build-config=backend/cloudbuild.yaml \
     --substitutions=_RUNTIME_SA=<runtime-sa-email>,_OAUTH_CLIENT_ID=<oauth-client-id>,_ALLOWED_EMAILS=<allowed-emails>
   ```

## Test

```bash
gcloud builds triggers run backend-deploy --project=max-personal-447802 --branch=main
```
Then `curl https://<service-url>/healthz` → `{"status":"ok"}`.
