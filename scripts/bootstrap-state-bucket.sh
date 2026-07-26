#!/usr/bin/env bash
# One-time, per-environment: creates the GCS bucket that holds Terraform's
# own remote state (infra/backend.tf). Run this once before the first
# `terraform init` for a given environment — a Terraform config can't create
# the bucket that holds its own state, so this is a plain gcloud script
# rather than part of infra/*.tf.
#
# Usage:
#   export TF_VAR_project_id=my-gcp-project
#   ./scripts/bootstrap-state-bucket.sh test    # or: prod

set -euo pipefail

ENVIRONMENT="${1:?Usage: bootstrap-state-bucket.sh <test|prod>}"
if [[ "$ENVIRONMENT" != "test" && "$ENVIRONMENT" != "prod" ]]; then
  echo "Environment must be \"test\" or \"prod\". Got: $ENVIRONMENT" >&2
  exit 1
fi

PROJECT_ID="${TF_VAR_project_id:?Set TF_VAR_project_id}"
REGION="${TF_VAR_region:-us-central1}"
BUCKET="oncall-pro-tfstate-${ENVIRONMENT}"

echo "==> Creating gs://${BUCKET} in ${PROJECT_ID} (${REGION})"
gcloud storage buckets create "gs://${BUCKET}" \
  --project "$PROJECT_ID" \
  --location "$REGION" \
  --uniform-bucket-level-access

echo "==> Enabling versioning (so a bad state push can be rolled back)"
gcloud storage buckets update "gs://${BUCKET}" --versioning

echo ""
echo "Done. This matches infra/envs/${ENVIRONMENT}.backend.hcl's bucket name —"
echo "no changes needed there. Next: terraform init -backend-config=envs/${ENVIRONMENT}.backend.hcl"
