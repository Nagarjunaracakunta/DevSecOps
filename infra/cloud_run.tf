locals {
  # Cloud Run requires an image at service-creation time. CI (GitHub Actions)
  # updates the real image via `gcloud run deploy` after every push — the
  # lifecycle.ignore_changes below stops `terraform apply` from reverting
  # that back to this placeholder on a later infra change.
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
}

resource "google_cloud_run_v2_service" "backend" {
  name                = var.backend_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false # this is a hackathon demo — `terraform destroy` should actually tear it down

  template {
    service_account = google_service_account.cloud_run_runtime.email

    scaling {
      min_instance_count = 0 # scale to zero when idle — this is the cost lever
      max_instance_count = 2 # cap runaway scaling cost
    }

    containers {
      image = local.placeholder_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "CORS_ORIGIN"
        value = var.cors_origin
      }
      env {
        name  = "GITHUB_REPO"
        value = var.github_demo_repo
      }
      env {
        name  = "JIRA_BASE_URL"
        value = var.jira_base_url
      }
      env {
        name  = "JIRA_EMAIL"
        value = var.jira_email
      }
      env {
        name  = "JIRA_PROJECT_KEY"
        value = var.jira_project_key
      }
      env {
        name  = "JIRA_ISSUE_TYPE"
        value = var.jira_issue_type
      }
      env {
        name  = "GROQ_MODEL"
        value = var.groq_model
      }

      env {
        name = "GITHUB_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["github_token"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JIRA_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["jira_api_token"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "GROQ_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["groq_api_key"].secret_id
            version = "latest"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.placeholder,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.backend.location
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "frontend" {
  name                = var.frontend_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    # Without this, Cloud Run defaults to the project's default Compute
    # Engine SA, which the GitHub Actions deployer has no actAs permission
    # on (only granted for this custom runtime SA) — every `gcloud run
    # deploy` from CI would fail with PERMISSION_DENIED on actAs.
    service_account = google_service_account.cloud_run_runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = local.placeholder_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu = "1"
          # Cloud Run requires >=512Mi when CPU isn't explicitly throttled
          # to request-only (cpu_idle) — 256Mi was rejected at apply time.
          memory = "512Mi"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.frontend.location
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
