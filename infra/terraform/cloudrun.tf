locals {
  direct_api_url         = "https://${local.name}-api-${data.google_project.current.number}.${var.region}.run.app"
  effective_app_base_url = var.app_base_url != "" ? var.app_base_url : local.direct_api_url
  dispatcher_url         = "https://${local.name}-dispatcher-${data.google_project.current.number}.${var.region}.run.app/api/internal/generation/dispatch"
  billing_mode           = var.environment == "production" ? "live" : "test"
  common_env = {
    NODE_ENV                            = "production"
    EXECUTION_MODE                      = "e2b"
    APP_BASE_URL                        = local.effective_app_base_url
    JOB_CALLBACK_BASE_URL               = local.effective_app_base_url
    GCP_PROJECT                         = var.project_id
    GCP_REGION                          = var.region
    GENERATION_QUEUE                    = "${local.name}-generation"
    GENERATION_DISPATCH_URL             = local.dispatcher_url
    GENERATION_DISPATCH_SERVICE_ACCOUNT = google_service_account.task_invoker.email
    STUDIO_ARTIFACT_BUCKET              = google_storage_bucket.artifacts.name
    E2B_MAX_CONCURRENT_SANDBOXES        = tostring(var.max_concurrent_sandboxes)
    E2B_TEMPLATE                        = "lesson-studio-renderer"
    E2B_TEMPLATE_VERSION                = var.e2b_template_version
    # A complete video commonly needs more than twelve agent turns for planning,
    # authoring, rendering, inspection, and repair. Keep the ceiling finite for
    # cost containment while allowing a normal generation to finish.
    CODEX_MAX_API_CALLS_PER_JOB               = "64"
    CODEX_MAX_ESTIMATED_COST_MICROUSD_PER_JOB = "2000000"
    CODEX_MAX_OUTPUT_TOKENS_PER_CALL          = "12000"
    CODEX_UPSTREAM_TIMEOUT_MS                 = "2700000"
    E2B_SANDBOX_TIMEOUT_MS                    = "1800000"
    E2B_DISPATCH_LEASE_MS                     = "300000"
    E2B_MAX_DISPATCH_ATTEMPTS                 = "5"
    GENERATION_RECONCILE_INTERVAL_MS          = "60000"
    REQUIRE_DATABASE                          = "true"
    DATABASE_SSL                              = "disable"
    DATABASE_POOL_MAX                         = var.environment == "staging" ? "5" : "10"
  }
  dispatcher_env = merge(local.common_env, {
    SERVICE_ROLE = "dispatcher"
  })
  api_env = merge(local.common_env, {
    SERVICE_ROLE                 = "api"
    IDENTITY_PLATFORM_PROJECT_ID = var.project_id
    AUTH_CHECK_REVOKED           = "true"
    BILLING_MODE_REQUIRED        = local.billing_mode
    ALLOW_TEST_CHECKOUT          = var.environment == "staging" ? "true" : "false"
  })
  dispatcher_secret_env = {
    DATABASE_URL        = google_secret_manager_secret.database_url.secret_id
    JOB_CALLBACK_SECRET = google_secret_manager_secret.job_callback.secret_id
    E2B_API_KEY         = var.secret_ids.e2b_api_key
  }
  api_secret_env = {
    DATABASE_URL              = google_secret_manager_secret.database_url.secret_id
    JOB_CALLBACK_SECRET       = google_secret_manager_secret.job_callback.secret_id
    AUDIT_HASH_SECRET         = google_secret_manager_secret.audit_hash.secret_id
    IDENTITY_PLATFORM_API_KEY = var.secret_ids.identity_api_key
    OPENAI_API_KEY            = var.secret_ids.openai_api_key
    SPEECHIFY_API_KEY         = var.secret_ids.speechify_api_key
    STRIPE_SECRET_KEY         = var.secret_ids.stripe_api_key
    STRIPE_WEBHOOK_SECRET     = var.secret_ids.stripe_webhook
    STAFF_EMAILS              = var.secret_ids.staff_emails
  }
}

resource "google_cloud_run_v2_service" "dispatcher" {
  name                = "${local.name}-dispatcher"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = var.environment == "production"
  template {
    service_account                  = google_service_account.dispatcher.email
    timeout                          = "180s"
    max_instance_request_concurrency = 10
    scaling {
      min_instance_count = 0
      max_instance_count = max(2, var.max_concurrent_sandboxes)
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.private.name
        subnetwork = google_compute_subnetwork.serverless.name
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 5
        period_seconds        = 5
        failure_threshold     = 12
        http_get {
          path = "/api/health/ready"
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      dynamic "env" {
        for_each = local.dispatcher_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.dispatcher_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.dispatcher_generated,
    google_secret_manager_secret_iam_member.dispatcher_existing,
  ]
  lifecycle {
    ignore_changes = [
      client,
      client_version,
      scaling,
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "task_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.dispatcher.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.task_invoker.email}"
}

resource "google_cloud_run_v2_service" "api" {
  name                = "${local.name}-api"
  location            = var.region
  ingress             = var.enable_external_edge ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.environment == "production"
  template {
    service_account                  = google_service_account.api.email
    timeout                          = "3600s"
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = var.environment == "production" ? 1 : 0
      max_instance_count = var.api_max_instances
    }
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.private.name
        subnetwork = google_compute_subnetwork.serverless.name
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = var.environment == "staging" ? "1" : "2"
          memory = var.environment == "staging" ? "1Gi" : "2Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 5
        period_seconds        = 5
        failure_threshold     = 12
        http_get {
          path = "/api/health/ready"
        }
      }
      liveness_probe {
        timeout_seconds   = 5
        period_seconds    = 30
        failure_threshold = 3
        http_get {
          path = "/api/health"
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.api_generated,
    google_secret_manager_secret_iam_member.api_existing,
  ]
  lifecycle {
    ignore_changes = [
      client,
      client_version,
      scaling,
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_api" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "migrate" {
  name                = "${local.name}-migrate"
  location            = var.region
  deletion_protection = var.environment == "production"
  template {
    template {
      service_account = google_service_account.api.email
      timeout         = "600s"
      max_retries     = 1
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.private.name
          subnetwork = google_compute_subnetwork.serverless.name
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }
      containers {
        image   = var.image
        command = ["npm"]
        args    = ["run", "db:migrate"]
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "DATABASE_SSL"
          value = "disable"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }
}
