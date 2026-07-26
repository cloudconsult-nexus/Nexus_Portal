---
description: Read-only status check across both deployed environments
---

Report the current deployed state of OnCall Pro — this is entirely
read-only; nothing here should prompt for destructive-action confirmation.

For each environment that's been deployed (`test`, `prod` — check which
actually exist rather than assuming both):
1. Current Cloud Run revision and when it was deployed:
   `gcloud run services describe oncall-pro-<env>-api --region us-central1 --format='value(status.latestReadyRevisionName,status.conditions)'`
   (and the same for `-web`).
2. `/_health` check against the API URL.
3. Any currently-firing alert policy (uptime or 5xx-rate — see
   `infra/monitoring.tf` for what's configured) via
   `gcloud alpha monitoring policies list` or the Cloud Console if the CLI
   surface is awkward — summarize, don't dump raw output.
4. Last 20 lines of API logs at ERROR severity:
   `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="oncall-pro-<env>-api" AND severity>=ERROR' --limit 20`

Summarize as a short table or bullet list per environment — healthy/
unhealthy, current revision, any active alerts, any recent errors worth
a human looking at. Don't take any action based on what you find; if
something looks wrong, tell the user and suggest the relevant RUNBOOK.md
section rather than acting on it yourself.
