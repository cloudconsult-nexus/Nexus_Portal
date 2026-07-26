# Remote state in a versioned GCS bucket instead of the local filesystem —
# gives locking (safe for more than one person/CI running terraform) and
# survives a wiped laptop. Partial config: the bucket (one per environment)
# is supplied at `terraform init` time via -backend-config, since a
# Terraform config can't create the bucket that holds its own state.
#
# One-time setup, before the first `terraform init` for a given environment:
#   ./scripts/bootstrap-state-bucket.sh <environment>
#
# Then:
#   terraform init -backend-config=envs/<environment>.backend.hcl
#
# See RUNBOOK.md's "First-time bootstrap" section for the full sequence.
terraform {
  backend "gcs" {}
}
