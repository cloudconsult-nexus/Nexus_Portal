# Deployment Guide

A start-from-zero walkthrough: what GCP products this needs and how to get
them, standing up the first environment, and setting up Claude Code so
deploys and updates stay manageable going forward. If you already have the
GCP side provisioned, skip to [Part 3](#part-3-code-migration-first-deployment).

For **what's deployed and why**, see [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md).
For **day-2 operations** (rollback, secret rotation, restore, incident
response) once you're up and running, see [RUNBOOK.md](RUNBOOK.md). This
guide is the on-ramp to both.

---

## Part 1: GCP product identification

Every GCP product this application uses, and why. Terraform enables all of
these automatically on first `apply` (`infra/main.tf`'s
`google_project_service.required`) — nothing to manually turn on beforehand,
but it's worth knowing what you're about to acquire and why each one is here:

| Product | API | Used for |
|---|---|---|
| Cloud Run | `run.googleapis.com` | Hosts both the `api` (Node/Express) and `web` (static React) services |
| Cloud SQL | `sqladmin.googleapis.com` | Managed Postgres 16 — the application database |
| Artifact Registry | `artifactregistry.googleapis.com` | Stores the Docker images `deploy.sh` builds and pushes |
| Secret Manager | `secretmanager.googleapis.com` | DB password, JWT signing secret, SMTP password, optional integration secrets |
| Cloud Storage (GCS) | `storage.googleapis.com` | Org logo/profile photo uploads, plus the Terraform state bucket |
| Cloud Monitoring | `monitoring.googleapis.com` | Uptime checks + alert policies (`infra/monitoring.tf`) |
| IAM | `iam.googleapis.com` | Per-service scoped service accounts, least-privilege grants |
| Cloud Build | `cloudbuild.googleapis.com` | Optional — CI/CD push-to-deploy via `cloudbuild.yaml` |
| Compute Engine API | `compute.googleapis.com` | Declared dependency of Cloud SQL/networking; not used directly |

Nothing else — no Kubernetes, no VPC, no load balancer of your own (Cloud
Run provides that), no Pub/Sub or Cloud Tasks (only needed if you later wire
up the stubbed SMS/Slack notifications — see the README's "Intentionally
stubbed" section).

## Part 2: GCP acquisition & configuration

Skip whichever steps you've already done.

### 2.1 Google Cloud account & billing

1. If you don't have one, create a Google Cloud account at
   [cloud.google.com](https://cloud.google.com) — this uses any Google
   account and requires a billing method (credit card) even though new
   accounts get free trial credit.
2. Create a **billing account** if this is your first GCP project:
   console → Billing → Add billing account.

### 2.2 Create the project

```bash
gcloud projects create YOUR_PROJECT_ID --name="OnCall Pro"
gcloud billing projects link YOUR_PROJECT_ID --billing-account=YOUR_BILLING_ACCOUNT_ID
```

Find your billing account ID with `gcloud billing accounts list` if you
don't have it handy. One project can hold both the `test` and `prod`
environments (see [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md#environments)
for why) — you don't need three projects for three environments.

### 2.3 Install local tooling

| Tool | Check | Install |
|---|---|---|
| `gcloud` CLI | `gcloud version` | [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install) |
| `terraform` ≥ 1.5 | `terraform version` | [developer.hashicorp.com/terraform/install](https://developer.hashicorp.com/terraform/install) (or `brew install hashicorp/tap/terraform` on macOS) |
| `docker` | `docker info` | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| Cloud SQL Auth Proxy v2 | `cloud-sql-proxy --version` | see README's "Prerequisites" — one `curl`+`chmod`+`mv` |

### 2.4 Authenticate

```bash
gcloud auth login
gcloud auth application-default login   # lets Terraform's google provider authenticate
gcloud config set project YOUR_PROJECT_ID
```

### 2.5 Confirm your account has sufficient IAM permissions

Terraform creates Cloud SQL instances, Cloud Run services, service
accounts, IAM bindings, secrets, and a monitoring config — this needs
broad permissions on the project. Simplest path: your account has the
**Owner** role (default for whoever creates the project). For a more
locked-down setup, the acting principal needs at minimum: `roles/run.admin`,
`roles/cloudsql.admin`, `roles/secretmanager.admin`, `roles/iam.serviceAccountAdmin`,
`roles/resourcemanager.projectIamAdmin`, `roles/artifactregistry.admin`,
`roles/storage.admin`, `roles/monitoring.admin`, `roles/serviceusage.serviceUsageAdmin`.

### 2.6 Optional: budget alert

Not managed by this repo's Terraform (it's account-level, not
project-scoped infrastructure) — set one up once, by hand:
console → Billing → Budgets & alerts → Create budget. See
[RUNBOOK.md](RUNBOOK.md#scaling--cost-knobs) for expected cost ranges to
set a sensible threshold.

---

## Part 3: Code migration (first deployment)

"Code migration" here means getting this repository's code running as the
two Cloud Run services, against a real Cloud SQL database — not a database
schema migration (that's `scripts/migrate.sh`, one step below).

### 3.1 Get the code

```bash
git clone <this-repo-url>
cd oncall-pro-repo
```

(If you're reading this from an existing checkout, you're already here.)

### 3.2 Set required secrets/config for this environment

```bash
export TF_VAR_project_id=YOUR_PROJECT_ID
export TF_VAR_db_password=$(openssl rand -base64 24)
export TF_VAR_jwt_secret=$(openssl rand -base64 48)
export TF_VAR_alert_notification_email=you@example.com

# Required in prod for invitations to actually deliver email — optional in test:
# export TF_VAR_smtp_password=...
```

**Write these down somewhere durable before continuing** — see
[RUNBOOK.md](RUNBOOK.md#secret-rotation) for why losing them is painful,
not catastrophic.

Review (and override if needed) the rest of the environment's config in
[`infra/envs/test.tfvars`](infra/envs/test.tfvars) or
[`infra/envs/prod.tfvars`](infra/envs/prod.tfvars) — `db_tier`,
`min_instances_api`, `smtp_host`/`smtp_user`/`smtp_from`, etc.

### 3.3 Bootstrap this environment's Terraform state bucket (one-time)

```bash
./scripts/bootstrap-state-bucket.sh test    # or: prod
```

### 3.4 Deploy

```bash
./scripts/deploy.sh test                    # or: prod
```

This single command: provisions everything in
[DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md)'s diagram via
Terraform → builds and pushes both Docker images → deploys both Cloud Run
services → locks API CORS to the real web URL → runs
[`scripts/migrate.sh`](scripts/migrate.sh) (the actual *database schema*
migrations, `backend/migrations/*.sql`) against the fresh instance.

Expect this to take several minutes on first run (Cloud SQL instance
creation alone is ~5-10 minutes). It prints the web and API URLs at the end.

### 3.5 Verify

```bash
curl https://<api-url>/_health     # expect {"status":"ok"}
```

Open the web URL printed at the end of `deploy.sh` — you should see the
sign-in page.

### 3.6 Create the first Global Admin

```bash
CLOUDSQL_CONN=$(cd infra && terraform output -raw cloudsql_connection_name)
./scripts/seed-admin.sh "$CLOUDSQL_CONN" admin@yourcompany.com 'SomeStrongPassword123' 'Your Name'
```

Sign in with those credentials at the web URL. **You're deployed.**

### 3.7 Optional: a custom domain

Cloud Run's default `*.run.app` URL works out of the box (what `deploy.sh`
uses throughout). To put this behind your own domain instead:

```bash
gcloud run domain-mappings create --service oncall-pro-prod-web --domain app.yourcompany.com --region us-central1
```

Then update DNS per the command's output, and update `CORS_ORIGIN` (API)
to the new domain via `terraform apply` (or `gcloud run services update
--update-env-vars`, matching how `deploy.sh` already does this for the
`.run.app` URL).

### 3.8 Repeat for the other environment

Run through 3.2–3.6 again with `test`/`prod` swapped. Each environment has
its own state bucket, `.tfvars` file, and set of secrets — nothing from one
environment leaks into the other.

---

## Part 4: Claude Code setup — managing deploy & updates going forward

This repo already has a [CLAUDE.md](CLAUDE.md) that Claude Code reads
automatically at the start of every session in this directory — it already
knows the stack, the domain model, and working conventions. What this
section adds is the operational half: how to have Claude Code actually run
deploys and updates for you, safely.

### 4.1 What Claude Code can already do here, unprompted

Point Claude Code at this repo and ask it to, e.g., "deploy the latest
main to test" or "add a new environment variable for X and wire it through
Terraform" — it can read this guide, `DEPLOYMENT_ARCHITECTURE.md`,
`RUNBOOK.md`, and the actual `infra/`/`scripts/` code to do this correctly,
the same way this guide itself was produced. You don't need to paste this
guide into the conversation — it's already in the repo.

### 4.2 Permission model — what to pre-approve vs. keep gated

Claude Code asks for your approval before running any tool call not
already allowed by your permission settings (`.claude/settings.local.json`,
local to this checkout — not committed to the main branch history by
default). For this repo, a sensible split:

- **Safe to pre-allow** (read-only, no cost, no state change):
  `gcloud config *`, `gcloud auth *`, `terraform plan`, `terraform output`,
  `terraform validate`, `gcloud run services describe *`,
  `gcloud run revisions list *`, `gcloud logging read *`,
  `gcloud sql backups list *`.
- **Keep gated — confirm each time** (the whole point of the safety model
  Claude Code operates under): `terraform apply`, `gcloud run deploy`,
  anything that rotates a secret (`TF_VAR_db_password`/`TF_VAR_jwt_secret`/
  `TF_VAR_smtp_password` changes), `gcloud sql backups restore`,
  `gcloud run services update-traffic`, and `./scripts/deploy.sh` itself.
  These affect a live, possibly-production system — you want to see and
  approve the exact command before it runs, every time, not just once.

Don't disable this gating to make deploys "faster" — the few seconds of
reviewing a confirmation prompt is the entire safety margin between "Claude
Code deployed what I asked for" and "Claude Code deployed something I
didn't notice was wrong."

### 4.3 Custom slash commands

Two are set up in [`.claude/commands/`](.claude/commands/) for the most
common requests:

- **`/deploy test`** or **`/deploy prod`** — runs the full deploy sequence
  (§3.4 above) for the named environment, after confirming the required
  `TF_VAR_*` variables are set.
- **`/deploy-status`** — read-only: current Cloud Run revisions, recent
  error-rate/uptime alert state, and the last few deploy-relevant log
  lines for both environments. Safe to run anytime.

### 4.4 Example requests for ongoing work

Plain-language requests that map onto this guide/`RUNBOOK.md` procedures —
Claude Code will look up the specifics rather than needing them spelled out:

- "Deploy the current main branch to test."
- "What's the current Cloud Run revision in prod, and when was it deployed?"
- "Rotate the JWT secret in prod." (will walk through
  [RUNBOOK.md](RUNBOOK.md#secret-rotation), confirm with you before
  applying — this invalidates every live session)
- "Add a `TWILIO_*` set of env vars for the stubbed SMS notifications,
  wired through Secret Manager like SMTP is."
- "Something's alerting — what's wrong?" (will check Cloud Logging/Cloud
  Monitoring per [RUNBOOK.md](RUNBOOK.md#incident-response))
- "Roll back prod to the previous revision."

### 4.5 Keeping this guide and CLAUDE.md current

If you change the deployment shape (new GCP product, new environment, new
secret), update [DEPLOYMENT_ARCHITECTURE.md](DEPLOYMENT_ARCHITECTURE.md)'s
requirement table and this guide's Part 1/3 in the same change — Claude
Code (and the next person) will read whatever's committed, not what used
to be true. This is the same discipline this guide's own "GCP acquisition"
section depends on: accurate docs are what make "ask Claude Code to handle
it" actually reliable going forward.
