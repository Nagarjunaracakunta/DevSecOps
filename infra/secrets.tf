locals {
  # key -> Secret Manager secret ID. Only the ID lives in Terraform; actual
  # values are added out-of-band via `gcloud secrets versions add` so real
  # tokens never sit in Terraform state as anything but a placeholder.
  secret_ids = {
    github_token   = "github-token"
    jira_api_token = "jira-api-token"
    groq_api_key   = "groq-api-key"
  }
}

resource "google_secret_manager_secret" "this" {
  for_each  = local.secret_ids
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# A placeholder version so secret_key_ref { version = "latest" } has
# something to resolve to before you run `gcloud secrets versions add`.
# Secret versions are immutable in GCP, so this never gets overwritten —
# adding a real version via gcloud just makes that the new "latest".
resource "google_secret_manager_secret_version" "placeholder" {
  for_each    = local.secret_ids
  secret      = google_secret_manager_secret.this[each.key].id
  secret_data = "REPLACE_ME"
}

resource "google_service_account" "cloud_run_runtime" {
  account_id   = "devsecops-copilot-run"
  display_name = "DevSecOps Copilot Cloud Run runtime identity"
}

resource "google_secret_manager_secret_iam_member" "runtime_can_read" {
  for_each  = local.secret_ids
  secret_id = google_secret_manager_secret.this[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}
