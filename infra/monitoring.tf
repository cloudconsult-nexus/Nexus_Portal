# Baseline uptime + error-rate alerting on top of Cloud Run's automatic
# Cloud Logging (every request/console.log/console.error already lands there
# with no config needed — this file only adds active alerting on top of it).
# See RUNBOOK.md's "Incident response" section for where these alerts show
# up and what to do about them.

resource "google_monitoring_notification_channel" "email" {
  display_name = "${var.app_name} alerts"
  type         = "email"
  labels = {
    email_address = var.alert_notification_email
  }
  depends_on = [google_project_service.required]
}

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "${var.app_name}-api /_health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/_health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
    }
  }

  # If api's URI ever changes (e.g. the Cloud Run service is deleted and
  # recreated), this resource needs replacing. The referencing alert policy
  # below must be repointed to the new uptime_check_id before the old one
  # is destroyed, or Google's API rejects the destroy ("please ensure all
  # associated Alert Policies are deleted") — create_before_destroy gets
  # the ordering right.
  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_uptime_check_config" "web_root" {
  display_name = "${var.app_name}-web /"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.web.uri, "https://")
    }
  }

  # See api_health's comment above — same create_before_destroy reasoning.
  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_monitoring_alert_policy" "api_uptime_failure" {
  display_name = "${var.app_name} API uptime check failing"
  combiner     = "OR"

  conditions {
    display_name = "health check failing"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api_health.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "web_uptime_failure" {
  display_name = "${var.app_name} web uptime check failing"
  combiner     = "OR"

  conditions {
    display_name = "web root check failing"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.web_root.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "api_error_rate" {
  display_name = "${var.app_name} API 5xx error rate"
  combiner     = "OR"

  conditions {
    display_name = "5xx responses > 5/min for 5min"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${google_cloud_run_v2_service.api.name}\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}
