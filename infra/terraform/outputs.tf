output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "dispatcher_url" {
  value = google_cloud_run_v2_service.dispatcher.uri
}

output "artifact_bucket" {
  value = google_storage_bucket.artifacts.name
}

output "migration_job" {
  value = google_cloud_run_v2_job.migrate.name
}

output "load_balancer_ip" {
  value       = google_compute_global_address.app.address
  description = "Create the app_domain A record at this address before waiting for the managed certificate."
}

output "release_service_account" {
  value       = google_service_account.release.email
  description = "Use this identity for Cloud Build application and deployment configs."
}
