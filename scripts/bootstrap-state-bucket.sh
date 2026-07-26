#!/usr/bin/env bash
# One-time, per-instance: creates the GCS bucket that holds Terraform's own
# remote state (infra/backend.tf). Run this once before the first
# `terraform init` for a given instance — a Terraform config can't create
# the bucket that holds its own state, so this is a plain gcloud script
# rather than part of infra/*.tf.
#
# "Instance" here means one deployed copy of the app: our own "test"/"prod"
# environments, or a separate tenant's own instance in their own GCP
# project (e.g. "acme-corp") — see RUNBOOK.md's "Onboarding a new tenant"
# section. The bucket name includes the GCP project ID, which is globally
# unique, so two different tenants picking the same instance name (e.g.
# both using "prod") can never collide with each other or with us.
#
# Usage:
#   export TF_VAR_project_id=my-gcp-project
#   ./scripts/bootstrap-state-bucket.sh test    # or: prod, or a tenant slug

set -euo pipefail

INSTANCE="${1:?Usage: bootstrap-state-bucket.sh <instance-name>}"
if [[ ! "$INSTANCE" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Instance name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens (e.g. test, prod, acme-corp). Got: $INSTANCE" >&2
  exit 1
fi

PROJECT_ID="${TF_VAR_project_id:?Set TF_VAR_project_id}"
REGION="${TF_VAR_region:-us-central1}"
BUCKET="${PROJECT_ID}-tfstate-${INSTANCE}"

echo "==> Creating gs://${BUCKET} in ${PROJECT_ID} (${REGION})"
gcloud storage buckets create "gs://${BUCKET}" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --uniform-bucket-level-access

echo "==> Enabling versioning (so a bad state push can be rolled back)"
gcloud storage buckets update "gs://${BUCKET}" --versioning

echo ""
echo "Done. Make sure infra/envs/${INSTANCE}.backend.hcl's bucket name matches"
echo "(bucket = \"${BUCKET}\"). Next: terraform init -backend-config=envs/${INSTANCE}.backend.hcl"
