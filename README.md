# OnCall Pro

A from-scratch implementation of the on-call scheduling system described in
the *OnCall Pro Administrator Guide*, plus everything needed to deploy it to
Google Cloud Platform.

## What this is

- **`backend/`** — Node.js/Express REST API. JWT auth, org-hierarchy-scoped
  RBAC (Global Admin / Org Admin / Regular User), PostgreSQL via `pg`.
- **`frontend/`** — React + Vite + Tailwind single-page app.
- **`infra/`** — Terraform for Cloud SQL, Artifact Registry, Secret Manager,
  IAM, monitoring/alerting, and two Cloud Run services (`api`, `web`), with
  per-environment configs under `infra/envs/`.
- **`scripts/`** — deployment, migration, state-bucket-bootstrap, and
  admin-seeding scripts.
- **`cloudbuild.yaml`** — CI/CD for redeploys after the initial bootstrap.

## Scope — what's real vs. stubbed

Everything below was built and **smoke-tested end-to-end** against a live
Postgres instance in the process of building this (login → org hierarchy →
people → calendar → escalation assignment → conflict detection → shift swap
two-stage approval → audit log → reports):

- Auth (JWT), invite-and-activate user flow, password reset
- Org hierarchy (Master → Main → Sub → Provider) with Global-Admin-only
  mutation, Org-Admin subtree scoping, Regular-User read-only scoping
- People (on-call contacts) CRUD + bulk upload endpoint
- Calendars CRUD
- Assignments: multi-day creation, escalation vs. broadcast mode, conflict
  detection, 36-month replication, Copy Schedule, past-dates-are-read-only,
  date/time locked on edit
- Auto-Schedule round-robin generation with a preview step
- Shift swaps: full `pending_target → pending_admin → approved` workflow
- Contact change requests with admin approval
- Append-only audit log on every mutation, with search/filter
- Reports: dashboard summary, coverage %, workload distribution
- The signature UI element — an escalation-chain visualization with a live
  pulse indicator — plus a full dashboard/schedule/reports frontend

**Intentionally stubbed** (flagged in code, not silently faked):
- **Notifications** (SMS/Slack on assignment) — the schema and toggle
  fields exist (`notify_slack`, `notify_email`); no SMS/Slack provider is
  wired up. Add a queue (Cloud Tasks or Pub/Sub) + Twilio/Slack webhook
  calls in a background worker — don't call these providers synchronously
  from the request path. (Email notifications are *not* stubbed — see below.)
- **ICS calendar feed / export** — schema supports it (assignments are
  already date/time-normalized); the export endpoint itself isn't built.
- **Real-time sync** — the frontend polls on navigation, not via websockets.
  Cloud Run supports WebSockets with session affinity if you want to add it.

**Built and production-ready, not stubbed** (this section used to list these
as stubbed — they aren't):
- **Transactional email** (invites, password resets) — `backend/src/lib/email.js`
  sends for real over SMTP when configured, logging to console instead in
  local dev. See [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md) for
  the production wiring.
- **White-label branding upload + profile photos** — both upload to GCS via
  `backend/src/lib/storage.js`, falling back to local disk in dev. See
  [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md)'s storage design
  section.

None of this is hard to add — the schema and API shape anticipate all of
it — but building it out was out of scope for one pass. Treat this as a
deployable, working v1, not a system with hidden gaps papered over.

## Architecture

Full diagram, the requirement-to-implementation table, and the storage
security design are in [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md).
Short version:

```
Browser → Cloud Run: web (nginx) → Cloud Run: api (Node/Express) → Cloud SQL
                                          │              ↕ Secret Manager
                                          ↓
                            outbound SMTP + GCS (logos/photos)
```

## Environments

Three environments, one GCP project: **Dev** is local-only (below — no
cloud infra needed), **Test** and **Production** are separate Cloud
SQL/Cloud Run/secrets/bucket sets in the same project, distinguished by an
`app_name` prefix (`oncall-pro-test-*` / `oncall-pro-prod-*`) and their own
Terraform state (`infra/envs/test.tfvars` / `infra/envs/prod.tfvars`). See
[DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md) for the full
comparison table and [RUNBOOK.md](RUNBOOK.md) for day-2 operations
(deploys, rollback, secret rotation, backup/restore, incident response).
Setting this up from a brand-new GCP account? Start with
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) instead — it also covers
setting up Claude Code to manage deploys/updates going forward.

## Local development

Prerequisites: Node 20+, a local Postgres 16.

```bash
# Database
createdb oncallpro
createuser oncallpro --password   # or use your own Postgres role

# Backend
cd backend
cp .env.example .env              # fill in DB_PASSWORD, generate JWT_SECRET
npm install
npm run migrate
node src/seedAdmin.js admin@example.com 'SomeStrongPassword123' 'Your Name'
npm run dev                       # http://localhost:8080

# Frontend (separate terminal)
cd frontend
echo "VITE_API_URL=http://localhost:8080" > .env.local
npm install
npm run dev                       # http://localhost:5173
```

## Deploying to GCP

### Prerequisites

1. A GCP project with billing enabled.
2. `gcloud` CLI, authenticated: `gcloud auth login && gcloud config set project YOUR_PROJECT_ID`
3. `docker`, running locally.
4. `terraform` ≥ 1.5 ([download](https://developer.hashicorp.com/terraform/install)).
5. For running migrations against the deployed DB: the
   [Cloud SQL Auth Proxy v2](https://cloud.google.com/sql/docs/postgres/sql-proxy#install) —
   ```bash
   curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2/cloud-sql-proxy.linux.amd64
   chmod +x cloud-sql-proxy && sudo mv cloud-sql-proxy /usr/local/bin/
   ```

### First-time deploy (per environment)

Condensed version below; [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) has the
full walkthrough starting from "I don't have a GCP project yet."

```bash
export TF_VAR_project_id=your-gcp-project-id
export TF_VAR_db_password=$(openssl rand -base64 24)
export TF_VAR_jwt_secret=$(openssl rand -base64 48)
export TF_VAR_alert_notification_email=you@example.com

./scripts/bootstrap-state-bucket.sh test   # one-time per environment
./scripts/deploy.sh test                   # or: prod
```

This runs, in order: `terraform init`/`apply` for the chosen environment
(provisions Cloud SQL, Artifact Registry, Secret Manager, IAM, monitoring,
and two Cloud Run services with a placeholder image) → builds and pushes the
API image → deploys the API → builds the web image with `VITE_API_URL`
pointed at the real API URL → deploys web → locks API CORS down to the real
web URL → runs migrations through the Cloud SQL Auth Proxy. Full sequence,
rollback, secret rotation, and backup/restore: [RUNBOOK.md](RUNBOOK.md).

**Save the `TF_VAR_db_password` / `TF_VAR_jwt_secret` / `TF_VAR_smtp_password`
values somewhere** — re-running `deploy.sh` with different values rotates
the live secret, and you'll need the originals for `scripts/migrate.sh` or
`scripts/seed-admin.sh` if run separately later.

### Create the first Global Admin

```bash
CLOUDSQL_CONN=$(cd infra && terraform output -raw cloudsql_connection_name)
./scripts/seed-admin.sh "$CLOUDSQL_CONN" admin@yourcompany.com 'SomeStrongPassword123' 'Your Name'
```

Then sign in at the web URL printed at the end of `deploy.sh`.

### Ongoing deploys (CI/CD)

After the first `deploy.sh` run for an environment, wire up
`cloudbuild.yaml` for push-to-deploy — see [RUNBOOK.md](RUNBOOK.md#ongoing-deploys)
for the trigger command. Or just re-run `deploy.sh <env>` manually — it's
idempotent.

### Cost, security, and operations

Cost breakdown, scaling knobs, secret rotation, and the full security
posture (Secret Manager scope, IAM grants, Cloud SQL network config, JWT/
bcrypt details) are in [RUNBOOK.md](RUNBOOK.md) and
[DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md) rather than
duplicated here, so there's one place to keep them current as the
Terraform evolves.
