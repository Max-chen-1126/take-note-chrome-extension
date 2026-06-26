"""Budget kill-switch Cloud Function (2nd gen, Pub/Sub-triggered).

Subscribed to the GCP Billing budget's Pub/Sub topic. When the month's cost
reaches the budget amount, it makes the Cloud Run service private by removing
the `allUsers` member from the `roles/run.invoker` binding — so all public
(extension) traffic gets 403 and billable work stops. Reversible: re-add the
binding when ready (`gcloud run services add-iam-policy-binding ...`).

Budget messages arrive periodically (not only on breach), so the action is
idempotent: if the service is already private, it does nothing.

Env vars: PROJECT_ID, REGION, SERVICE_NAME.
"""

import base64
import json
import logging
import os

import functions_framework
from google.cloud import run_v2

_PROJECT = os.environ["PROJECT_ID"]
_REGION = os.environ["REGION"]
_SERVICE = os.environ["SERVICE_NAME"]
_INVOKER_ROLE = "roles/run.invoker"
_PUBLIC_MEMBER = "allUsers"


@functions_framework.cloud_event
def kill_switch(cloud_event):
    payload = base64.b64decode(cloud_event.data["message"]["data"]).decode("utf-8")
    msg = json.loads(payload)
    cost = float(msg.get("costAmount", 0) or 0)
    budget = float(msg.get("budgetAmount", 0) or 0)
    logging.info("budget notification: cost=%s budget=%s", cost, budget)
    if budget > 0 and cost >= budget:
        _make_private()


def _make_private() -> None:
    client = run_v2.ServicesClient()
    resource = f"projects/{_PROJECT}/locations/{_REGION}/services/{_SERVICE}"
    policy = client.get_iam_policy(request={"resource": resource})
    changed = False
    for binding in list(policy.bindings):
        if binding.role == _INVOKER_ROLE and _PUBLIC_MEMBER in binding.members:
            binding.members.remove(_PUBLIC_MEMBER)
            if not binding.members:
                policy.bindings.remove(binding)
            changed = True
    if changed:
        client.set_iam_policy(request={"resource": resource, "policy": policy})
        logging.warning("KILL-SWITCH: removed allUsers invoker on %s (budget reached)", resource)
    else:
        logging.info("kill-switch: service already private; no action")
