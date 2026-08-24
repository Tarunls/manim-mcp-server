variable "project_id" {
  type        = string
  description = "GCP project that owns Lesson Studio."
  default     = "educationalvideo-506219"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "environment" {
  type    = string
  default = "staging"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "image" {
  type        = string
  description = "Immutable Artifact Registry image including a digest or commit tag."
}

variable "app_base_url" {
  type        = string
  description = "Public HTTPS origin. Leave empty for a domainless staging deployment on the canonical run.app URL."
  default     = ""
  validation {
    condition     = var.app_base_url == "" || startswith(var.app_base_url, "https://")
    error_message = "app_base_url must be empty or HTTPS."
  }
}

variable "app_domain" {
  type        = string
  description = "DNS hostname served by the external HTTPS load balancer."
  default     = ""
  validation {
    condition     = var.app_domain == "" || (!strcontains(var.app_domain, "://") && !strcontains(var.app_domain, "/"))
    error_message = "app_domain must be a hostname without a scheme or path."
  }
}

variable "enable_external_edge" {
  type        = bool
  default     = false
  description = "Create the global HTTPS load balancer, managed certificate, and Cloud Armor policy. Enable after DNS is available."
}

variable "e2b_template_version" {
  type        = string
  description = "Immutable E2B template tag built by npm run e2b:build-template."
}

variable "max_concurrent_sandboxes" {
  type    = number
  default = 20
}

variable "api_max_instances" {
  type    = number
  default = 50
}

variable "sql_tier" {
  type        = string
  default     = "db-f1-micro"
  description = "Cloud SQL machine tier. The shared-core default is for budget-limited staging only."
}

variable "sql_availability_type" {
  type    = string
  default = "ZONAL"
  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.sql_availability_type)
    error_message = "sql_availability_type must be ZONAL or REGIONAL."
  }
}

variable "sql_disk_size_gb" {
  type    = number
  default = 10
  validation {
    condition     = var.sql_disk_size_gb >= 10
    error_message = "Cloud SQL requires at least 10 GB of storage."
  }
}

variable "billing_account_id" {
  type        = string
  default     = "0181BB-902BC6-5D4673"
  description = "Billing account linked to the GCP project, used only for the project-scoped budget alert."
}

variable "monthly_budget_usd" {
  type        = number
  default     = 20
  description = "Alerting budget for this project. Google Cloud budgets notify but do not guarantee a hard spend cap."
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be positive."
  }
}

variable "secret_ids" {
  type = object({
    identity_api_key  = string
    openai_api_key    = string
    e2b_api_key       = string
    speechify_api_key = string
    stripe_api_key    = string
    stripe_webhook    = string
    staff_emails      = string
  })
  description = "Existing Secret Manager secret IDs. Terraform never reads their plaintext into configuration."
  default = {
    identity_api_key  = "identity_platform_api_key"
    openai_api_key    = "openai_api_key"
    e2b_api_key       = "e2b_api_key"
    speechify_api_key = "speechify_key"
    stripe_api_key    = "stripe_sandbox_api_key"
    stripe_webhook    = "stripe_webhook_secret"
    staff_emails      = "staff_emails"
  }
}
