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
variable "ncc_api_key" {
  description = "Static per-instance API key NCC (Nextiva Contact Center) authenticates the on-call lookup endpoint with (Phase 5.4, middleware/serviceAuth.js). Pass via -var or TF_VAR_ncc_api_key; never commit this. Leave unset to skip the Secret Manager entry entirely — the endpoint then fails closed with 500 rather than allowing unauthenticated access (see RUNBOOK.md's 2026-08-19 incident for what that looks like when it shadows sibling routes instead of just its own)."
  type        = string
  sensitive   = true
  default     = ""
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
