# Backend CI

## backend-ci.yml
Runs on every push/PR touching `backend/**`: `uv sync`, `ruff check`, `pytest`.
No GCP access needed.

Deploys are handled separately via a manual Cloud Build trigger, not GitHub
Actions — see `infra/cloudbuild-deploy/README.md`.
