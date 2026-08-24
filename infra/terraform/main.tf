locals {
  name            = "lesson-studio-${var.environment}"
  artifact_bucket = "${var.project_id}-${local.name}-artifacts"
  database_name   = "lesson_studio"
  database_user   = "lesson_studio_app"
  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "compute.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "cloudtasks.googleapis.com",
  ])
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "api" {
  account_id   = "ls-${var.environment}-api"
  display_name = "Lesson Studio ${var.environment} API"
}

resource "google_service_account" "dispatcher" {
  account_id   = "ls-${var.environment}-dispatch"
  display_name = "Lesson Studio ${var.environment} E2B dispatcher"
}

resource "google_service_account" "task_invoker" {
  account_id   = "ls-${var.environment}-tasks"
  display_name = "Lesson Studio ${var.environment} Cloud Tasks invoker"
}

resource "google_service_account" "release" {
  account_id   = "ls-${var.environment}-release"
  display_name = "Lesson Studio ${var.environment} Cloud Build release identity"
}

resource "google_compute_network" "private" {
  name                    = local.name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "serverless" {
  name                     = "${local.name}-serverless"
  region                   = var.region
  network                  = google_compute_network.private.id
  ip_cidr_range            = "10.42.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_services" {
  name          = "${local.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.private.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.private.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  depends_on              = [google_project_service.required]
}

resource "random_password" "database" {
  length  = 40
  special = false
}

resource "random_password" "job_callback" {
  length  = 48
  special = false
}

resource "random_password" "audit_hash" {
  length  = 48
  special = false
}

resource "google_sql_database_instance" "postgres" {
  name                = "${local.name}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier              = "db-custom-2-7680"
    availability_type = "REGIONAL"
    disk_type         = "PD_SSD"
    disk_size         = 50
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "04:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.private.id
      enable_private_path_for_google_cloud_services = true
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }

    maintenance_window {
      day          = 7
      hour         = 6
      update_track = "stable"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "app" {
  name     = local.database_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "app" {
  name     = local.database_user
  instance = google_sql_database_instance.postgres.name
  password = random_password.database.result
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${local.name}-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${local.database_user}:${urlencode(random_password.database.result)}@/${local.database_name}?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
}

resource "google_secret_manager_secret" "job_callback" {
  secret_id = "${local.name}-job-callback"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "job_callback" {
  secret      = google_secret_manager_secret.job_callback.id
  secret_data = random_password.job_callback.result
}

resource "google_secret_manager_secret" "audit_hash" {
  secret_id = "${local.name}-audit-hash"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "audit_hash" {
  secret      = google_secret_manager_secret.audit_hash.id
  secret_data = random_password.audit_hash.result
}

resource "google_storage_bucket" "artifacts" {
  name                        = local.artifact_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }

  lifecycle_rule {
    condition {
      age                = 30
      num_newer_versions = 1
    }
    action { type = "Delete" }
  }

  lifecycle_rule {
    condition {
      age            = 7
      matches_prefix = ["generation-jobs/"]
    }
    action { type = "AbortIncompleteMultipartUpload" }
  }
}

resource "google_cloud_tasks_queue" "generation" {
  name     = "${local.name}-generation"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = var.max_concurrent_sandboxes
    max_dispatches_per_second = max(1, floor(var.max_concurrent_sandboxes / 2))
  }

  retry_config {
    max_attempts       = 100
    max_retry_duration = "86400s"
    min_backoff        = "5s"
    max_backoff        = "900s"
    max_doublings      = 8
  }

  depends_on = [google_project_service.required]
}
