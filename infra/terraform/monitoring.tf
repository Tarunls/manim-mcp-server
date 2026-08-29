variable "notification_channel_ids" {
  type        = list(string)
  default     = []
  description = "Existing Monitoring notification channel resource IDs."
}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Email address that receives Monitoring alerts. Empty disables the managed email channel."
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "${local.name} alerts (email)"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.required]
}

locals {
  notification_channels = concat(
    var.notification_channel_ids,
    google_monitoring_notification_channel.email[*].id,
  )
}

resource "google_logging_metric" "generation_failures" {
  name   = "${local.name}/generation_failures"
  filter = "resource.type=\"cloud_run_revision\" AND (resource.labels.service_name=\"${google_cloud_run_v2_service.api.name}\" OR resource.labels.service_name=\"${google_cloud_run_v2_service.dispatcher.name}\") AND severity>=ERROR AND (textPayload:\"generation\" OR jsonPayload.message:\"generation\" OR textPayload:\"E2B\" OR jsonPayload.message:\"E2B\")"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "api_5xx" {
  display_name          = "${local.name}: elevated API 5xx rate"
  combiner              = "OR"
  notification_channels = local.notification_channels

  conditions {
    display_name = "More than one 5xx response per second"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${google_cloud_run_v2_service.api.name}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "generation_failures" {
  display_name          = "${local.name}: generation failures"
  combiner              = "OR"
  notification_channels = local.notification_channels

  conditions {
    display_name = "Five generation failures in five minutes"
    condition_threshold {
      filter          = "metric.type = \"logging.googleapis.com/user/${google_logging_metric.generation_failures.name}\" AND resource.type = \"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 4
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "database_cpu" {
  display_name          = "${local.name}: Cloud SQL CPU saturation"
  combiner              = "OR"
  notification_channels = local.notification_channels

  conditions {
    display_name = "Database CPU above 80% for 15 minutes"
    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:${google_sql_database_instance.postgres.name}\" AND metric.type = \"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "900s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
}
