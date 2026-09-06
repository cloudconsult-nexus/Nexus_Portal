#!/usr/bin/env bash
# Deploys OnCall Pro to Google Cloud Platform for a given environment.
# Dev has no cloud infra of its own — see README.md's "Local development"
# section — so this only ever takes "test" or "prod".
#
# Order of operations (and why):
#   1. terraform init + apply — creates/updates Cloud SQL, Artifact Registry,
#      Secret Manager, IAM, monitoring, and Cloud Run services (with a
#      placeholder image on first apply, since nothing's been pushed yet).
#   2. build + push API image — no build-time dependency on anything else.
#   3. deploy API to Cloud Run — now we have a real API URL.
#   4. build + push WEB image — Vite bakes VITE_API_URL in at build time, so
#      this step needs the API URL from step 3.
#   5. deploy WEB to Cloud Run.
#   6. run DB migrations       — via Cloud SQL Auth Proxy, against the instance.
#   7. seed the first Global Admin, if requested (printed at the end).
#
# Usage:
#   export TF_VAR_project_id=my-gcp-project
#   export TF_VAR_db_password=$(openssl rand -base64 24)
#   export TF_VAR_jwt_secret=$(openssl rand -base64 48)
#   export TF_VAR_alert_notification_email=you@example.com
#   # If this environment is served from a custom domain (a Cloud Run
#   # domain mapping, e.g. test.cloudconsult.technology) rather than its
#   # own *.run.app URL, set this too — see the CORS lock-down step below
#   # for why: root-caused live 2026-09-03, see RUNBOOK.md.
#   export PUBLIC_WEB_URL=https://test.cloudconsult.technology
#   ./scripts/deploy.sh test    # or: prod, or a tenant slug like acme-corp
#
# "Environment" here is really "instance name" — it selects which
# infra/envs/<name>.tfvars + infra/envs/<name>.backend.hcl pair to use.
# Our own two environments are "test"/"prod", but the same script deploys a
# separate tenant's own instance into their own GCP project just as well —
# see RUNBOOK.md's "Onboarding a new tenant" section.
#
# First time for a given instance, bootstrap its Terraform state bucket
# first (one-time, per instance):
#   ./scripts/bootstrap-state-bucket.sh test
#
# See RUNBOOK.md for the full sequence including CI/CD wiring.

set -euo pipefail

ENVIRONMENT="${1:?Usage: deploy.sh <instance-name>}"
if [[ ! "$ENVIRONMENT" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Instance name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (e.g. test, prod, acme-corp). Got: $ENVIRONMENT" >&2
  exit 1
fi
if [[ ! -f "$(dirname "${BASH_SOURCE[0]}")/../infra/envs/${ENVIRONMENT}.tfvars" ]]; then
  echo "No infra/envs/${ENVIRONMENT}.tfvars found. Create one (see infra/envs/TEMPLATE.tfvars.tenant for a new tenant) before deploying. Got: $ENVIRONMENT" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="${TF_VAR_project_id:?Set TF_VAR_project_id}"
REGION="${TF_VAR_region:-us-central1}"

echo "==> [$ENVIRONMENT] Enabling required APIs and provisioning infrastructure with Terraform"
cd "$ROOT_DIR/infra"
terraform init -input=false -backend-config="envs/${ENVIRONMENT}.backend.hcl"
terraform apply -auto-approve -input=false -var-file="envs/${ENVIRONMENT}.tfvars"

APP_NAME=$(terraform output -raw app_name)
AR_REPO=$(terraform output -raw artifact_registry_repo)
CLOUDSQL_CONN=$(terraform output -raw cloudsql_connection_name)

echo "==> Configuring Docker auth for Artifact Registry"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Backend ──────────────────────────────────────────────────────────────
echo "==> Building API image"
cd "$ROOT_DIR/backend"
API_IMAGE="${AR_REPO}/api:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
# --platform linux/amd64: Cloud Run only runs amd64, but this repo is
# developed on Apple Silicon Macs where a plain build defaults to arm64.
# --builder multiarch: explicit, not left to ambient "current builder"
# selection — the basic "docker" driver builder has repeatedly produced
# broken/hanging or single-arch-mislabeled multi-platform image indexes;
# the docker-container-backed "multiarch" builder (see README's
# Prerequisites) is the one that reliably works. Create it once with:
#   docker buildx create --name multiarch --driver docker-container --use
docker buildx build --platform linux/amd64 --builder multiarch --load -t "$API_IMAGE" .
docker push "$API_IMAGE"

echo "==> Deploying API to Cloud Run"
gcloud run deploy "${APP_NAME}-api" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$API_IMAGE" \
  --quiet

API_URL=$(gcloud run services describe "${APP_NAME}-api" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
echo "    API deployed at $API_URL"

# Public access without an `allUsers` IAM binding — required verbatim under
# orgs with the iam.allowedPolicyMemberDomains (Domain Restricted Sharing)
# constraint, and harmless otherwise. See infra/cloudrun.tf for why this
# isn't a Terraform resource.
gcloud run services update "${APP_NAME}-api" \
  --project "$PROJECT_ID" --region "$REGION" \
  --no-invoker-iam-check --quiet

# ── Frontend ─────────────────────────────────────────────────────────────
echo "==> Building web image (VITE_API_URL=$API_URL)"
cd "$ROOT_DIR/frontend"
WEB_IMAGE="${AR_REPO}/web:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
docker buildx build --platform linux/amd64 --builder multiarch --load -t "$WEB_IMAGE" --build-arg "VITE_API_URL=$API_URL" .
docker push "$WEB_IMAGE"

echo "==> Deploying web to Cloud Run"
gcloud run deploy "${APP_NAME}-web" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$WEB_IMAGE" \
  --quiet

WEB_URL=$(gcloud run services describe "${APP_NAME}-web" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
echo "    Web deployed at $WEB_URL"

gcloud run services update "${APP_NAME}-web" \
  --project "$PROJECT_ID" --region "$REGION" \
  --no-invoker-iam-check --quiet

# ── Lock CORS down to the real web URL now that we know it ────────────────
# Invite/reset-password emails link to this same URL (lib/invitations.js
# reuses CORS_ORIGIN rather than a second "public web URL" env var), so this
# step is also what makes the invitation workflow point somewhere real.
#
# CORS_ORIGIN has to be the domain the browser actually loads the web app
# from — cors() (backend/src/app.js) does an exact string match against
# the Origin header. For an environment served from a custom domain (a
# Cloud Run domain mapping) rather than its own *.run.app URL, that's NOT
# $WEB_URL — root-caused live on `test` 2026-09-03 (RUNBOOK.md's Incident
# response section), where this line had silently locked CORS to the
# run.app URL while the app was actually served from
# test.cloudconsult.technology, breaking every API call with a generic
# "Failed to fetch". PUBLIC_WEB_URL is the opt-in override for that case;
# it defaults to $WEB_URL so environments with no custom domain mapping
# keep today's behavior unchanged.
PUBLIC_URL="${PUBLIC_WEB_URL:-$WEB_URL}"
#
# --no-invoker-iam-check is re-specified here (not just relied on from the
# earlier update above) because it does not reliably persist across a
# subsequent `gcloud run services update` call that doesn't repeat it —
# every update to this service must restate it, or the resulting revision
# silently reverts to requiring auth (manifests as a 404, not 403, for
# unauthenticated requests — Cloud Run doesn't reveal that the service
# exists to unauthorized callers).
echo "==> Restricting API CORS to $PUBLIC_URL"
gcloud run services update "${APP_NAME}-api" \
  --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "CORS_ORIGIN=$PUBLIC_URL" \
  --no-invoker-iam-check --quiet

# ── Migrations ──────────────────────────────────────────────────────────
echo "==> Running database migrations via Cloud SQL Auth Proxy"
"$ROOT_DIR/scripts/migrate.sh" "$CLOUDSQL_CONN"

echo ""
echo "Deployment complete ($ENVIRONMENT)."
echo "  Web:  $WEB_URL"
echo "  API:  $API_URL"
echo ""
echo "No Global Admin exists yet. Create one with:"
echo "  ./scripts/seed-admin.sh $CLOUDSQL_CONN <email> <password> <name>"
