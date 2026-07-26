# Shared storage for every user-supplied image asset — org logos AND person
# profile photos both land here via backend/src/lib/storage.js's uploadAsset()
# (BRANDING_BUCKET_NAME wiring in cloudrun.tf; the name predates photos being
# added). Private bucket, no public-read grant (see iam.tf's api_signer) —
# the API signs a short-lived V4 URL per request instead
# (backend/src/lib/storage.js's resolveAssetUrl()), which works regardless of
# the deploying org's IAM policy. Object names are also UUID-suffixed
# (assetKey() in storage.js) as defense in depth. See
# DEPLOYMENT_ARCHITECTURE.md for the full design writeup.
#
# Versioning + the lifecycle rule below are a backup safeguard against
# accidental overwrite/delete (assetKey() always writes a new UUID-named
# object, so overwrites shouldn't normally happen, but deletes do on person
# removal) — not a substitute for the Cloud SQL backups that protect the
# actual data (URLs, metadata).
resource "google_storage_bucket" "branding" {
  name                        = "${var.app_name}-branding-${var.project_id}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 1
      with_state         = "ARCHIVED"
      age                = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

output "branding_bucket_name" {
  value = google_storage_bucket.branding.name
}
