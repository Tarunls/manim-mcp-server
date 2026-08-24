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
