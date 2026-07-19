resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.repo_name
  format        = "DOCKER"
  description   = "Container images for DevSecOps Copilot"

  # Keep only the last few images per service — free tier storage is small
  # and every push otherwise accumulates forever.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  depends_on = [google_project_service.apis]
}
