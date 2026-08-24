locals {
  api_roles = toset([
    "roles/cloudsql.client",
    "roles/cloudtasks.enqueuer",
    "roles/firebaseauth.admin",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
  dispatcher_roles = toset([
    "roles/cloudsql.client",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
}

resource "google_service_account_iam_member" "api_task_identity" {
  service_account_id = google_service_account.task_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api" {
  for_each = local.api_roles
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "dispatcher" {
  for_each = local.dispatcher_roles
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_project_iam_member" "release" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/logging.logWriter",
    "roles/run.admin",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.release.email}"
}

resource "google_service_account_iam_member" "release_api_identity" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.release.email}"
}

resource "google_service_account_iam_member" "release_dispatcher_identity" {
  service_account_id = google_service_account.dispatcher.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.release.email}"
}

resource "google_storage_bucket_iam_member" "api_artifacts" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "dispatcher_artifacts" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_service_account_iam_member" "api_signer" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_service_account_iam_member" "dispatcher_signer" {
  service_account_id = google_service_account.dispatcher.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_secret_manager_secret_iam_member" "api_generated" {
  for_each = toset([
    google_secret_manager_secret.database_url.secret_id,
    google_secret_manager_secret.job_callback.secret_id,
    google_secret_manager_secret.audit_hash.secret_id,
  ])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "dispatcher_generated" {
  for_each = toset([
    google_secret_manager_secret.database_url.secret_id,
    google_secret_manager_secret.job_callback.secret_id,
  ])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_secret_manager_secret_iam_member" "api_existing" {
  for_each  = toset([var.secret_ids.identity_api_key, var.secret_ids.speechify_api_key, var.secret_ids.stripe_api_key, var.secret_ids.stripe_webhook, var.secret_ids.staff_emails])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "dispatcher_existing" {
  for_each  = toset([var.secret_ids.openai_api_key, var.secret_ids.e2b_api_key])
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dispatcher.email}"
}
