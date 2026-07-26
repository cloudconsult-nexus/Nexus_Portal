locals {
  # REGIONAL (multi-zone failover) only for prod — test stays ZONAL to keep
  # cost down, matching the test tfvars' smaller db_tier.
  cloudsql_availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"
}

resource "google_sql_database_instance" "main" {
  name             = "${var.app_name}-pg"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = local.cloudsql_availability_type
    disk_autoresize   = true
    disk_size         = 10

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.transaction_log_retention_days
      backup_retention_settings {
        retained_backups = var.backup_retained_count
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true # Cloud Run reaches this over the built-in Cloud SQL
      # unix-socket connection, not the public IP — see backend/src/db/pool.js.
      # Public IP is left enabled here only so `psql` can connect directly for
      # migrations/debugging; lock this down with authorized_networks or
      # switch to private-IP-only for stricter production environments.
    }
  }

  deletion_protection = true

  depends_on = [google_project_service.required]
}

resource "google_sql_database" "app" {
  name     = "oncallpro"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "oncallpro"
  instance = google_sql_database_instance.main.name
  password = var.db_password
}

output "cloudsql_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "cloudsql_public_ip" {
  value = google_sql_database_instance.main.public_ip_address
}
