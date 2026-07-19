variable "project_id" {
  description = "GCP project ID to deploy into"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "GitHub repo in \"owner/name\" form — scopes which repo's Actions runs can assume the deployer identity via Workload Identity Federation"
  type        = string
}

variable "repo_name" {
  description = "Artifact Registry repository name for container images"
  type        = string
  default     = "devsecops-copilot"
}

variable "backend_service_name" {
  type    = string
  default = "devsecops-backend"
}

variable "frontend_service_name" {
  type    = string
  default = "devsecops-frontend"
}

variable "cors_origin" {
  description = "Value for the backend's CORS_ORIGIN env var. Set to \"*\" initially; tighten to the frontend's real Cloud Run URL once known."
  type        = string
  default     = "*"
}

variable "github_demo_repo" {
  description = "owner/repo of the DEDICATED (empty) repo the PR bot pushes fix branches to — NOT this app's own repo. Leave blank to run the PR bot in dry-run mode only."
  type        = string
  default     = ""
}

variable "jira_base_url" {
  description = "Jira Cloud site root, e.g. https://yourcompany.atlassian.net. Leave blank to use mock Jira data."
  type        = string
  default     = ""
}

variable "jira_email" {
  type    = string
  default = ""
}

variable "jira_project_key" {
  type    = string
  default = ""
}

variable "jira_issue_type" {
  type    = string
  default = "Task"
}

variable "groq_model" {
  type    = string
  default = "llama-3.3-70b-versatile"
}
