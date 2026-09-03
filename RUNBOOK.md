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

**CI/CD**: wire up `cloudbuild.yaml` once per environment/instance —
connect the repo to Cloud Build first (console → Cloud Build → Triggers →
Connect Repository → GitHub App → select the repo; this one-time step needs
a human in a browser, it can't be scripted), then create the trigger. Newer
GCP projects reject an implicit/default service account on triggers, so
create a dedicated one first:

```bash
gcloud iam service-accounts create cloudbuild-deployer \
  --display-name="Cloud Build Deployer" --project=<project-id>

for role in roles/run.admin roles/iam.serviceAccountUser \
            roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding <project-id> \
    --member="serviceAccount:cloudbuild-deployer@<project-id>.iam.gserviceaccount.com" \
    --role="$role"
done

gcloud builds triggers create github \
  --name="<instance>-deploy" \
  --repo-name=<your-repo> --repo-owner=<your-org> --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --service-account="projects/<project-id>/serviceAccounts/cloudbuild-deployer@<project-id>.iam.gserviceaccount.com" \
  --substitutions="_APP_NAME=oncall-pro-<instance>,_API_URL=$(gcloud run services describe oncall-pro-<instance>-api --region us-central1 --format='value(status.url)')"
```

`cloudbuild.yaml` only builds/pushes/deploys — it doesn't run
`terraform apply`, so infra changes (new tfvars, new secrets, scaling
changes) still go through `deploy.sh` manually.

## Onboarding a new tenant (separate GCP account)

Each TAS Client Portal customer gets their own fully separate instance —
own GCP project, own Cloud SQL, own everything (see
`CLAUDE.md`'s Phase 5 target-spec section). The infra is already
project-agnostic (see `infra/variables.tf`'s `project_id`, which has no
default and is never hardcoded), so onboarding a new tenant is mostly the
same "First-time bootstrap" sequence above, run against their project
instead of ours, plus a couple of extra one-time steps:

**Prerequisites**: the tenant's GCP project exists, billing is enabled on
it, and whoever runs this has `roles/owner` (or equivalent) on it.

```bash
# 1. Copy the tenant templates and fill in the placeholders.
cp infra/envs/TEMPLATE.tfvars.tenant infra/envs/<tenant-slug>.tfvars
cp infra/envs/TEMPLATE.backend.hcl.tenant infra/envs/<tenant-slug>.backend.hcl
# Edit both: project_id, app_name, alert_notification_email, and the
# backend.hcl bucket name (must be "<tenant-project-id>-tfstate-<tenant-slug>").

# 2. Generate fresh secrets for THIS tenant — never reuse another
# tenant's or our own test/prod secrets.
export TF_VAR_project_id=<tenant-project-id>
export TF_VAR_db_password=$(openssl rand -base64 24)
export TF_VAR_jwt_secret=$(openssl rand -base64 48)
export TF_VAR_alert_notification_email=<tenant-ops-address>

# 3. Bootstrap state + provision + deploy + migrate (schema only — no seed
# data beyond what seedAdmin.js creates next).
./scripts/bootstrap-state-bucket.sh <tenant-slug>
./scripts/deploy.sh <tenant-slug>

# 4. Create the tenant's first Global Admin.
CLOUDSQL_CONN=$(cd infra && terraform output -raw cloudsql_connection_name)
./scripts/seed-admin.sh "$CLOUDSQL_CONN" admin@<tenant-domain> 'SomeStrongPassword123' 'Tenant Admin Name'
```

Then repeat the **CI/CD** wiring above (connect-repo console step + dedicated
`cloudbuild-deployer` service account + trigger), run against the tenant's
own project, pointed at the same shared GitHub repo — each GCP project has
its own independent Cloud Build↔GitHub connection even though the
underlying GitHub App installation is shared across all of them.

**Out of scope here**: the in-app first-run configuration wizard
(logo/branding, domain, NCC token/domain pairing — see `CLAUDE.md`'s Phase
5 target spec) is a separate, not-yet-built app feature (Phase 5.5). This
section only covers infra provisioning — after it, the tenant's Global
Admin still needs to configure branding by hand via the TAS Settings page
until that wizard exists.

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

## Outbound email (Google Workspace)

Invite and password-reset emails go through Nodemailer's generic SMTP
transport (`backend/src/lib/email.js`) — there's no GCP-native "send email"
resource, just Terraform-managed env vars (`infra/variables.tf`) and a
Secret Manager entry (`infra/secrets.tf`, created only when `smtp_password`
is non-empty) feeding Cloud Run. `test` is currently configured to send
through a dedicated **Google Workspace mailbox**,
`no-reply@cloudconsult.technology`, via Gmail's SMTP endpoint — chosen over
a third-party ESP (SendGrid/Mailgun) since cloudconsult.technology already
has an active Workspace subscription, which sidesteps any separate
domain-authentication (SPF/DKIM CNAME) setup entirely.

- `infra/envs/test.tfvars`: `smtp_host = "smtp.gmail.com"`, `smtp_port =
  587`, `smtp_user = "no-reply@cloudconsult.technology"`, `smtp_from =
  "no-reply@cloudconsult.technology"`.
- `smtp_password` is an **App Password** generated from that mailbox's own
  Google Account (myaccount.google.com/apppasswords — requires 2-Step
  Verification enabled on the account first), supplied only via
  `TF_VAR_smtp_password` at apply time — never committed to any `.tfvars`
  file.
- Sending limit is Gmail's standard ~2,000 recipients/day per account —
  fine for transactional invite/reset volume. If that's ever outgrown, the
  next step up is Workspace's SMTP relay service (Admin console → Apps →
  Google Workspace → Gmail → Routing), which raises the cap to ~10,000/day
  but authenticates by allow-listed source IP rather than username/
  password — that needs a static outbound IP for Cloud Run (Serverless VPC
  Access + Cloud NAT), which isn't set up today.
- The "From" display name and email subject/body copy are white-label-aware
  (`backend/src/lib/branding.js`'s `getProductName()`) — they read
  `tas_settings.name_override` (falling back to `tas_settings.name`, then
  the literal "Nexus Portal") so a rebranded deployment's outbound mail
  says e.g. "Pioneer TAS Nexus Portal" without any code change.

To onboard a new tenant or rotate the app password, set
`TF_VAR_smtp_password` and apply — see "Onboarding a new tenant" and
"Secret rotation" below. `prod.tfvars` doesn't have SMTP configured yet;
copy the same `smtp_host`/`smtp_port`/`smtp_user`/`smtp_from` lines from
`test.tfvars` (with its own sending mailbox, if different) when ready.

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
- **"Failed to fetch" in the browser on every API call** (login,
  forgot-password, anything — not one specific route): before suspecting the
  app, check `CORS_ORIGIN` on that environment's `-api` service —
  `gcloud run services describe oncall-pro-<env>-api --project <project-id>
  --region us-central1 --format=yaml | grep -A2 CORS_ORIGIN`. `cors()`
  (`backend/src/app.js`) does an exact string match against the request's
  `Origin` header, so this has to be the domain the browser is actually
  loading the web app from — e.g. `https://test.cloudconsult.technology` —
  not the `-web` service's own `*.run.app` URL. A mismatch here (confirmed
  live 2026-09-03 on `test`) makes the browser block every request before
  it ever reaches the API, which surfaces client-side as a generic "Failed
  to fetch" with no CORS-specific wording and no failed request even
  visible in some cases — indistinguishable at a glance from the API being
  down, so it's easy to spend time chasing a crash that isn't there. Find
  what domain the environment is actually served from with `gcloud run
  domain-mappings list --region us-central1 --project <project-id>` (or
  check `infra/` for a `google_cloud_run_domain_mapping` resource) before
  setting `CORS_ORIGIN`, rather than assuming the `-web` service's own URL
  is it. One-off fix: `gcloud run services update oncall-pro-<env>-api
  --project <project-id> --region us-central1 --update-env-vars
  "CORS_ORIGIN=https://<actual-domain>" --no-invoker-iam-check --quiet`.
  **This is a real bug in the deploy pipeline itself, not just a one-time
  misconfiguration** — both `scripts/deploy.sh` and `cloudbuild.yaml` had
  (as of 2026-09-03) a "lock CORS down" step that always set `CORS_ORIGIN`
  to the `-web` service's own URL, unconditionally, on every deploy — so a
  redeploy of an environment on a custom domain silently reintroduces this
  exact failure. Fixed the same day: both now respect an optional
  override (`PUBLIC_WEB_URL` env var for `deploy.sh`, `_PUBLIC_WEB_URL`
  substitution for `cloudbuild.yaml`) that takes precedence over the
  `-web` URL when set — set it once per environment with a custom domain
  (`export PUBLIC_WEB_URL=https://test.cloudconsult.technology` before
  running `deploy.sh test`, or the equivalent trigger substitution for
  Cloud Build) and every future deploy keeps CORS correct automatically.
- **Email not sending**: check `SMTP_HOST` is actually set for this
  environment (`infra/envs/prod.tfvars` doesn't have it yet — see "Outbound
  email (SendGrid)" below) — if unset, invites/resets are silently only
  logged to Cloud Logging, never delivered. Search logs for
  `[email:dev] would send to` to confirm this is what's happening. If
  `SMTP_HOST` is set but mail still isn't arriving, check SendGrid's
  Activity feed for bounces/blocks (often an unauthenticated sending
  domain) before assuming it's an app bug.

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
