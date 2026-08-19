resource "google_service_account" "api_runtime" {
  account_id   = "${var.app_name}-api-sa"
  display_name = "${var.app_name} API Cloud Run runtime"
}

# Lets the API connect to Cloud SQL over the built-in unix-socket integration.
resource "google_project_iam_member" "api_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api_runtime.email}"
}

# Scoped secret access — only the secrets this service actually needs, not
# project-wide Secret Manager access. The three below are conditional
# (secrets.tf's count guard) — no grant is created for one that doesn't exist.
resource "google_secret_manager_secret_iam_member" "api_db_password" {
  secret_id = google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_jwt_secret" {
  secret_id = google_secret_manager_secret.jwt_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_smtp_password" {
  count     = var.smtp_password != "" ? 1 : 0
  secret_id = google_secret_manager_secret.smtp_password[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_report_sso_fallback_secret" {
  count     = var.report_sso_fallback_secret != "" ? 1 : 0
  secret_id = google_secret_manager_secret.report_sso_fallback_secret[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_customer_messaging_sso_secret" {
  count     = var.customer_messaging_sso_secret != "" ? 1 : 0
  secret_id = google_secret_manager_secret.customer_messaging_sso_secret[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "api_ncc_api_key" {
  count     = var.ncc_api_key != "" ? 1 : 0
  secret_id = google_secret_manager_secret.ncc_api_key[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api_runtime.email}"
}

# Branding logo uploads — scoped to just the branding bucket, not project-wide
# storage access.
resource "google_storage_bucket_iam_member" "api_branding_write" {
  bucket = google_storage_bucket.branding.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api_runtime.email}"
}

# Uploaded logos/photos render in <img> tags for every portal user
# (including a customer's own end users under white-labeling, who are never
# authenticated against this app). A public-read bucket grant would be the
# simplest way to make that work, but orgs enforcing
# iam.allowedPolicyMemberDomains (Domain Restricted Sharing) reject any
# allUsers grant outright — unlike Cloud Run, GCS bucket ACLs have no
# invoker-check-style bypass. Instead, the API signs a short-lived V4 URL
# per request (backend/src/lib/storage.js's resolveAssetUrl()), which works
# regardless of org policy — this is deployment-target-independent, so it's
# the mechanism everywhere, not just under DRS. See
# DEPLOYMENT_ARCHITECTURE.md's storage design section.
#
# Signing needs the runtime SA to impersonate itself via IAM signBlob (no
# service-account key file — Cloud Run has none, and shouldn't).
resource "google_service_account_iam_member" "api_signer" {
  service_account_id = google_service_account.api_runtime.name
  role                = "roles/iam.serviceAccountTokenCreator"
  member              = "serviceAccount:${google_service_account.api_runtime.email}"
}

# The web service is static nginx — no special permissions needed, but it
# gets its own identity for least-privilege / auditability.
resource "google_service_account" "web_runtime" {
  account_id   = "${var.app_name}-web-sa"
  display_name = "${var.app_name} Web Cloud Run runtime"
}
