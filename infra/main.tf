terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.40"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Exposed for scripts/deploy.sh — app_name lives in a per-environment
# .tfvars file (envs/test.tfvars, envs/prod.tfvars), not an env var, so the
# actual deployed Cloud Run service names (${app_name}-api/-web) need to
# come from Terraform rather than being reconstructed independently.
output "app_name" {
  value = var.app_name
}

# APIs required across Cloud Run, Cloud SQL, Artifact Registry, Secret Manager.
resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "storage.googleapis.com",
    "monitoring.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}
