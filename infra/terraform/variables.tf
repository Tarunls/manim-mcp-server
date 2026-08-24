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
  description = "Public HTTPS origin. Use the final custom domain in production."
  validation {
    condition     = startswith(var.app_base_url, "https://")
    error_message = "app_base_url must be HTTPS."
  }
}

variable "app_domain" {
  type        = string
  description = "DNS hostname served by the external HTTPS load balancer."
  validation {
    condition     = !strcontains(var.app_domain, "://") && !strcontains(var.app_domain, "/")
    error_message = "app_domain must be a hostname without a scheme or path."
  }
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
    stripe_api_key    = "stripe_test_api_key"
    stripe_webhook    = "stripe_webhook_secret"
    staff_emails      = "staff_emails"
  }
}
