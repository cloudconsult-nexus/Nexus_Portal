resource "google_artifact_registry_repository" "images" {
  repository_id = "${var.app_name}-images"
  location      = var.region
  format        = "DOCKER"
  description   = "Container images for ${var.app_name}"
  depends_on    = [google_project_service.required]
}

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
