resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.app_name}-db-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = var.db_password
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "${var.app_name}-jwt-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = var.jwt_secret
}

# ── Optional secrets — each only exists at all when its variable is set, so
# leaving smtp_password/report_sso_fallback_secret/customer_messaging_sso_secret
# unset doesn't create an empty Secret Manager entry. cloudrun.tf's
# dynamic "env" blocks and iam.tf's grants use the same count guard.
resource "google_secret_manager_secret" "smtp_password" {
  count     = var.smtp_password != "" ? 1 : 0
  secret_id = "${var.app_name}-smtp-password"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "smtp_password" {
  count       = var.smtp_password != "" ? 1 : 0
  secret      = google_secret_manager_secret.smtp_password[0].id
  secret_data = var.smtp_password
}

resource "google_secret_manager_secret" "report_sso_fallback_secret" {
  count     = var.report_sso_fallback_secret != "" ? 1 : 0
  secret_id = "${var.app_name}-report-sso-fallback-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "report_sso_fallback_secret" {
  count       = var.report_sso_fallback_secret != "" ? 1 : 0
  secret      = google_secret_manager_secret.report_sso_fallback_secret[0].id
  secret_data = var.report_sso_fallback_secret
}

resource "google_secret_manager_secret" "customer_messaging_sso_secret" {
  count     = var.customer_messaging_sso_secret != "" ? 1 : 0
  secret_id = "${var.app_name}-customer-messaging-sso-secret"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "customer_messaging_sso_secret" {
  count       = var.customer_messaging_sso_secret != "" ? 1 : 0
  secret      = google_secret_manager_secret.customer_messaging_sso_secret[0].id
  secret_data = var.customer_messaging_sso_secret
}

resource "google_secret_manager_secret" "ncc_credentials_encryption_key" {
  count     = var.ncc_credentials_encryption_key != "" ? 1 : 0
  secret_id = "${var.app_name}-ncc-credentials-encryption-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "ncc_credentials_encryption_key" {
  count       = var.ncc_credentials_encryption_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.ncc_credentials_encryption_key[0].id
  secret_data = var.ncc_credentials_encryption_key
}

resource "google_secret_manager_secret" "ncc_api_key" {
  count     = var.ncc_api_key != "" ? 1 : 0
  secret_id = "${var.app_name}-ncc-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "ncc_api_key" {
  count       = var.ncc_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.ncc_api_key[0].id
  secret_data = var.ncc_api_key
}
