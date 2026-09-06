variable "project_id" {
  description = "GCP project ID to deploy into"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run, Cloud SQL, and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "app_name" {
  description = "Short name used to prefix resources"
  type        = string
  default     = "oncall-pro"
}

variable "db_tier" {
  description = "Cloud SQL machine tier. db-f1-micro/db-g1-small are shared-core (cheap, dev/staging); use db-custom-N-M for production."
  type        = string
  default     = "db-g1-small"
}

variable "db_password" {
  description = "Password for the application's Postgres user. Pass via -var or TF_VAR_db_password; never commit this."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "Signing secret for session + invite JWTs. Generate with: openssl rand -base64 48"
  type        = string
  sensitive   = true
}

variable "cors_origin" {
  description = "Comma-separated allowed CORS origins for the API (set to the deployed web URL after first apply)"
  type        = string
  default     = "*"
}

variable "min_instances_api" {
  description = "Minimum Cloud Run instances for the API service (0 = scales to zero, adds cold-start latency)"
  type        = number
  default     = 0
}

variable "min_instances_web" {
  type    = number
  default = 0
}

variable "environment" {
  description = "Which environment this Terraform state represents — drives HA/retention defaults (see cloudsql.tf). Dev has no cloud infra of its own (local Postgres + npm run dev); this only applies to test/prod."
  type        = string
  default     = "test"
  validation {
    condition     = contains(["test", "prod"], var.environment)
    error_message = "environment must be \"test\" or \"prod\" (Dev runs locally, not on GCP — see README.md)."
  }
}

# ── Outbound email (invite/reset-password emails; see backend/src/lib/email.js) ──
# Leave smtp_host unset (empty string) to keep the console-log fallback —
# matches local dev's behavior, useful for a test environment that doesn't
# need to actually deliver mail.
variable "smtp_host" {
  type    = string
  default = ""
}
variable "smtp_port" {
  type    = number
  default = 587
}
variable "smtp_user" {
  type    = string
  default = ""
}
variable "smtp_from" {
  type    = string
  default = "no-reply@nexusportal.app"
}
variable "invite_expiry_days" {
  description = "How long an invite link stays valid before it's shown as expired on the Invitations tracking page."
  type        = number
  default     = 7
}
variable "smtp_password" {
  description = "SMTP auth password. Pass via -var or TF_VAR_smtp_password; never commit this. Leave unset to skip Secret Manager entry entirely and keep the app's console-log fallback."
  type        = string
  sensitive   = true
  default     = ""
}

# ncc_credentials_encryption_key/ncc_api_key were previously set by hand
# directly on the Cloud Run service (gcloud run services update
# --set-env-vars), outside Terraform entirely — invisible to this config,
# so a later `terraform apply` silently wiped both, since
# google_cloud_run_v2_service manages its whole `env` list, not just the
# entries it knows about. Root-caused live on `test` 2026-09-03 (a real
# "Internal server error" from services/ncc-client's decryptSecret failing
# on the missing key, RUNBOOK.md's Incident response section) — the same
# gap equally affects ncc_api_key (routes/onCall.js's inbound live-call-
# path auth, middleware/serviceAuth.js), just not yet observed failing.
# Both are now first-class Terraform variables so this can't recur; set
# once via TF_VAR_ncc_credentials_encryption_key/TF_VAR_ncc_api_key (the
# EXACT existing value, recovered from a still-live prior Cloud Run
# revision if unknown — generating a new one instead of the original
# ncc_credentials_encryption_key permanently breaks decryption of every
# already-stored NCC credential) on the next apply for any environment
# that has these configured, and every apply after keeps them.
variable "ncc_credentials_encryption_key" {
  description = "AES-256 key (base64, 32 raw bytes) for lib/secretsCrypto.js, encrypting stored per-Customer/TAS-wide NCC (Thrio) credentials. Pass via -var or TF_VAR_ncc_credentials_encryption_key; never commit this, and never regenerate it once real credentials have been encrypted with it — that permanently locks those out. Leave unset to skip Secret Manager entry entirely (NCC outbound features return 'not configured')."
  type        = string
  sensitive   = true
  default     = ""
}

variable "ncc_api_key" {
  description = "Shared secret NCC/Thrio sends as a service credential on the inbound on-call-lookup endpoint (routes/onCall.js, middleware/serviceAuth.js). Pass via -var or TF_VAR_ncc_api_key; never commit this. Leave unset to skip Secret Manager entry entirely — every service-authenticated request then fails closed with a 500, per serviceAuth.js's own comment, rather than silently accepting unauthenticated calls."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Optional integrations — both features already degrade gracefully in the
# app when unset (see routes/reportMappings.js, routes/customerMessages.js),
# so these have no non-empty defaults and are simply omitted from Cloud Run's
# env when left blank (see the dynamic "env" blocks in cloudrun.tf). ──
variable "report_sso_fallback_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "customer_messaging_url" {
  type    = string
  default = ""
}
variable "customer_messaging_sso_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "customer_messaging_token_param" {
  type    = string
  default = "token"
}

# ── Monitoring ──
variable "alert_notification_email" {
  description = "Where uptime-check and error-rate alerts are sent. Required — no sensible default for a production deployment."
  type        = string
}

# ── Backups (see cloudsql.tf) ──
variable "backup_retained_count" {
  description = "Number of automated Cloud SQL backups to retain."
  type        = number
  default     = 30
}
variable "transaction_log_retention_days" {
  description = "How many days of transaction logs to retain for point-in-time recovery. Must be <= backup_retained_count's implied window."
  type        = number
  default     = 7
}
