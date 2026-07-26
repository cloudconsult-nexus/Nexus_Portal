# Operations Runbook

Day-2 operations for OnCall Pro on GCP. Setting up a new environment from
scratch? See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) instead — this
covers what to do *after* you're already deployed. For what's deployed and
why, see [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md). All
commands below assume `gcloud` is authenticated and pointed at the right
project (`gcloud config set project YOUR_PROJECT_ID`).

## First-time bootstrap (per environment)

Once per environment (`test` or `prod`), before anything else:

```bash
export TF_VAR_project_id=your-gcp-project-id
export TF_VAR_db_password=$(openssl rand -base64 24)
export TF_VAR_jwt_secret=$(openssl rand -base64 48)
export TF_VAR_alert_notification_email=you@example.com

# 1. Create the bucket that holds this environment's Terraform state.
./scripts/bootstrap-state-bucket.sh test        # or: prod

# 2. Provision infra + deploy both services + run migrations.
./scripts/deploy.sh test                        # or: prod
```

**Save `TF_VAR_db_password` / `TF_VAR_jwt_secret` / `TF_VAR_smtp_password`
(if set) somewhere durable** — re-running `deploy.sh` with different values
rotates the live secret, and you'll need the originals for
`scripts/migrate.sh` or `scripts/seed-admin.sh` if run separately later.

Then create the first Global Admin:

```bash
CLOUDSQL_CONN=$(cd infra && terraform output -raw cloudsql_connection_name)
./scripts/seed-admin.sh "$CLOUDSQL_CONN" admin@yourcompany.com 'SomeStrongPassword123' 'Your Name'
```

## Ongoing deploys

**Manual**: re-run `./scripts/deploy.sh <test|prod>` — it's idempotent
(Terraform only changes what drifted; Cloud Run deploys a new revision each
time regardless).

**CI/CD**: wire up `cloudbuild.yaml` once per environment:

```bash
gcloud builds triggers create github \
  --repo-name=<your-repo> --repo-owner=<you> --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --substitutions=_API_URL=$(gcloud run services describe oncall-pro-prod-api --region us-central1 --format='value(status.url)')
```

`cloudbuild.yaml` only builds/pushes/deploys — it doesn't run
`terraform apply`, so infra changes (new tfvars, new secrets, scaling
changes) still go through `deploy.sh` manually.

## Rollback

Cloud Run keeps prior revisions. To roll back without rebuilding:

```bash
gcloud run revisions list --service oncall-pro-prod-api --region us-central1
gcloud run services update-traffic oncall-pro-prod-api --region us-central1 \
  --to-revisions=<PRIOR_REVISION>=100
```

Same pattern for `-web`. This doesn't undo a database migration — see
"Database restore" below if a bad deploy also shipped a destructive
migration.

## Secret rotation

```bash
# Rotate the DB password (also updates the live Postgres user):
export TF_VAR_db_password=$(openssl rand -base64 24)
cd infra && terraform apply -var-file=envs/prod.tfvars

# Rotate JWT_SECRET — invalidates every existing session/invite/reset token
# immediately (all are signed with it). Only do this when that's intended.
export TF_VAR_jwt_secret=$(openssl rand -base64 48)
cd infra && terraform apply -var-file=envs/prod.tfvars

# Rotate SMTP password similarly via TF_VAR_smtp_password.
```

Terraform only rotates the Secret Manager value + the Cloud SQL user
password; Cloud Run picks up the new secret version on next deploy/revision
(re-run `deploy.sh` or `gcloud run services update` to force a new revision
if you need it to take effect immediately).

## Database backup & restore

Automated backups + point-in-time recovery are always on
(`infra/cloudsql.tf`) — retention is 7 backups in test, 30 in prod.

```bash
# List available backups:
gcloud sql backups list --instance=oncall-pro-prod-pg

# Restore to a NEW instance (never restore in-place onto the live instance —
# that's destructive and can't be undone):
gcloud sql backups restore <BACKUP_ID> \
  --restore-instance=oncall-pro-prod-pg \
  --backup-instance=oncall-pro-prod-pg

# Point-in-time recovery (any second within the retention window, not just a backup boundary):
gcloud sql instances clone oncall-pro-prod-pg oncall-pro-prod-pg-restored \
  --point-in-time='2026-07-20T04:00:00Z'
```

After a restore-to-new-instance, point the app at it deliberately (update
`INSTANCE_CONNECTION_NAME`/`DB_NAME` via Terraform) rather than renaming
instances — renaming Cloud SQL instances isn't supported in place.

GCS bucket contents (logos/photos) have versioning enabled
(`infra/storage.tf`) — a deleted or overwritten object's prior version is
recoverable for 30 days:

```bash
gsutil ls -a gs://oncall-pro-prod-branding-<project-id>/<path>
gsutil cp gs://oncall-pro-prod-branding-<project-id>/<path>#<generation> gs://oncall-pro-prod-branding-<project-id>/<path>
```

## Incident response

- **Alerts** land at `TF_VAR_alert_notification_email` — uptime-check
  failure (API or web unreachable) and API 5xx rate (`infra/monitoring.tf`).
- **Logs**: Cloud Logging, filtered by service —
  `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="oncall-pro-prod-api"' --limit 100`.
  Application errors are `console.error` calls (visible as `ERROR` severity);
  request logs come from `morgan`.
- **Health check**: `curl https://<api-url>/_health` should return
  `{"status":"ok"}`. Deliberately not `/healthz` — that exact literal path is
  intercepted by Google's edge infrastructure before ever reaching any Cloud
  Run backend, globally, regardless of project/service (confirmed
  empirically during initial deployment troubleshooting: identical requests
  to `/HEALTHZ`, `/healthz2`, or any other path reached the app fine; only
  exact-lowercase `/healthz` never did, on multiple fresh services across
  multiple hostnames). A startup probe failure means the container isn't
  reaching this within 30s (6 × 5s, `infra/cloudrun.tf`) — check logs for a
  crash on boot (usually a bad `DB_PASSWORD`/`JWT_SECRET` or an unreachable
  Cloud SQL instance).
- **Email not sending**: check `SMTP_HOST` is actually set for this
  environment (`infra/envs/prod.tfvars`) — if unset, invites/resets are
  silently only logged to Cloud Logging, never delivered. Search logs for
  `[email:dev] would send to` to confirm this is what's happening.

## Scaling & cost knobs

| Knob | Where | Effect |
|---|---|---|
| `min_instances_api` / `_web` | `envs/<env>.tfvars` | 0 = scales to zero (cold starts); 1+ = always-warm |
| `db_tier` | `envs/<env>.tfvars` | Cloud SQL machine size — dominant cost driver |
| `backup_retained_count` | `envs/<env>.tfvars` | More retained backups = more storage cost, longer recovery window |
| Cloud Run `max_instance_count` | `infra/cloudrun.tf` (currently 10) | Caps runaway scale-out cost under a traffic spike/bug |

Rough monthly floor per cloud environment at low traffic, `us-central1`:
Cloud SQL `db-f1-micro` (test) ≈ $10–15, `db-custom-2-7680` (prod) ≈
$100–130; Cloud Run ≈ a few dollars each when scaled to zero, more with
`min_instances ≥ 1`; Artifact Registry + monitoring ≈ $1–2. Two environments
(test + prod) together: roughly **$120–160/month** at low traffic.
