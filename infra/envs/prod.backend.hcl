# Passed to `terraform init -backend-config=envs/prod.backend.hcl`.
# The bucket itself is created once by scripts/bootstrap-state-bucket.sh —
# Terraform can't create the bucket that holds its own state.
bucket = "oncall-pro-tfstate-prod"
prefix = "terraform/state"
