locals {
  # Placeholder image used only on the very first `terraform apply`, before any
  # image has been pushed to Artifact Registry. scripts/deploy.sh pushes real
  # images and updates these services via `gcloud run deploy` afterward; the
  # lifecycle.ignore_changes blocks below stop subsequent `terraform apply`
  # runs from reverting that to the placeholder.
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "${var.app_name}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api_runtime.email
    scaling {
      min_instance_count = var.min_instances_api
      max_instance_count = 10
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = local.placeholder_image
      ports { container_port = 8080 }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "DB_USER"
        value = google_sql_user.app.name
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.app.name
      }
      env {
        name  = "INSTANCE_CONNECTION_NAME"
        value = google_sql_database_instance.main.connection_name
      }
      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }
      env {
        name  = "BRANDING_BUCKET_NAME"
        value = google_storage_bucket.branding.name
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }

      # Outbound email (see backend/src/lib/email.js) — plain values are safe
      # to always set, even blank: an empty SMTP_HOST keeps the app's
      # console-log fallback, identical to leaving it unset locally.
      env {
        name  = "SMTP_HOST"
        value = var.smtp_host
      }
      env {
        name  = "SMTP_PORT"
        value = tostring(var.smtp_port)
      }
      env {
        name  = "SMTP_USER"
        value = var.smtp_user
      }
      env {
        name  = "SMTP_FROM"
        value = var.smtp_from
      }
      env {
        name  = "INVITE_EXPIRY_DAYS"
        value = tostring(var.invite_expiry_days)
      }

      dynamic "env" {
        for_each = var.smtp_password != "" ? [1] : []
        content {
          name = "SMTP_PASS"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.smtp_password[0].secret_id
              version = "latest"
            }
          }
        }
      }

      # Optional integrations (routes/reportMappings.js, routes/customerMessages.js
      # both already handle these being entirely absent) — omitted from the
      # container spec rather than set blank, since the report SSO secret in
      # particular is a fallback only used when a report mapping doesn't set
      # its own.
      dynamic "env" {
        for_each = var.report_sso_fallback_secret != "" ? [1] : []
        content {
          name = "REPORT_SSO_FALLBACK_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.report_sso_fallback_secret[0].secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.customer_messaging_url != "" ? [1] : []
        content {
          name  = "CUSTOMER_MESSAGING_URL"
          value = var.customer_messaging_url
        }
      }
      dynamic "env" {
        for_each = var.customer_messaging_url != "" ? [1] : []
        content {
          name  = "CUSTOMER_MESSAGING_TOKEN_PARAM"
          value = var.customer_messaging_token_param
        }
      }
      dynamic "env" {
        for_each = var.customer_messaging_sso_secret != "" ? [1] : []
        content {
          name = "CUSTOMER_MESSAGING_SSO_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.customer_messaging_sso_secret[0].secret_id
              version = "latest"
            }
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/_health"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 6
        # Explicit, not left at Google's default (1s) — too tight for a cold
        # Node process that's also setting up the pg pool and Cloud SQL
        # socket mount before it can respond at all.
        timeout_seconds = 5
      }
    }
  }

  lifecycle {
    # image: set by deploy.sh's gcloud run deploy, not Terraform.
    # client/client_version: gcloud stamps these on every imperative
    # `gcloud run deploy` call; without ignoring them, the next
    # `terraform apply` sees them as drift and tries to "fix" it, which
    # requires waiting for the revision to become healthy — turning a
    # no-op metadata correction into a hard failure if the currently
    # live revision happens to be unhealthy for any other reason.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.required]
}

// Public access to both Cloud Run services is granted via `gcloud run
// services update --no-invoker-iam-check` in scripts/deploy.sh, not an
// `allUsers` IAM binding here. Orgs with the iam.allowedPolicyMemberDomains
// (Domain Restricted Sharing) constraint reject any allUsers grant outright;
// the invoker-check-disable flag achieves the same public access without
// needing an IAM binding at all, so it works whether or not that constraint
// is in effect. The provider attribute equivalent (invoker_iam_disabled)
// isn't available until google provider v6.10+ — this repo pins ~> 5.40 —
// so it's done as a gcloud step rather than a Terraform resource for now.

resource "google_cloud_run_v2_service" "web" {
  name     = "${var.app_name}-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web_runtime.email
    scaling {
      min_instance_count = var.min_instances_web
      max_instance_count = 10
    }
    containers {
      image = local.placeholder_image
      ports { container_port = 8080 }
      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        # Static nginx frontend does no work between requests — throttle CPU
        # to request-processing only. Also required by GCP: memory < 512Mi
        # isn't allowed when CPU is always-on (unthrottled).
        cpu_idle = true
      }
    }
  }

  lifecycle {
    # image: set by deploy.sh's gcloud run deploy, not Terraform.
    # client/client_version: gcloud stamps these on every imperative
    # `gcloud run deploy` call; without ignoring them, the next
    # `terraform apply` sees them as drift and tries to "fix" it, which
    # requires waiting for the revision to become healthy — turning a
    # no-op metadata correction into a hard failure if the currently
    # live revision happens to be unhealthy for any other reason.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.required]
}

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}
