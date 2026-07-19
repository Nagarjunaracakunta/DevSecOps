output "backend_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "frontend_url" {
  value = google_cloud_run_v2_service.frontend.uri
}

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "workload_identity_provider" {
  description = "Full resource name — set as the workload_identity_provider input in the GitHub Actions workflow"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account_email" {
  description = "Set as the service_account input in the GitHub Actions workflow"
  value       = google_service_account.github_actions.email
}

output "cloud_run_runtime_service_account_email" {
  value = google_service_account.cloud_run_runtime.email
}
