# Passed to `terraform init -backend-config=envs/prod.backend.hcl`.
# The bucket itself is created once by scripts/bootstrap-state-bucket.sh —
# Terraform can't create the bucket that holds its own state.
#
# Project-ID-qualified name (not just "oncall-pro-tfstate-prod") because GCS
# bucket names are globally unique across all of GCP, not just this project —
# the unqualified name was already taken. Confirmed against the actual
# bucket in oncall-pro-503319, 2026-09-03.
bucket = "oncall-pro-503319-tfstate-prod"
prefix = "terraform/state"
