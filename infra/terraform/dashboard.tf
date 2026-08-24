locals {
  dashboard_widgets = [
    {
      title    = "Cloud Run request rate"
      metric   = "run.googleapis.com/request_count"
      filter   = "resource.type = \"cloud_run_revision\" AND (resource.labels.service_name = \"${google_cloud_run_v2_service.api.name}\" OR resource.labels.service_name = \"${google_cloud_run_v2_service.dispatcher.name}\")"
      aligner  = "ALIGN_RATE"
      reducer  = "REDUCE_SUM"
      group_by = ["resource.labels.service_name"]
      unit     = "requests/s"
    },
    {
      title    = "API 5xx rate"
      metric   = "run.googleapis.com/request_count"
      filter   = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${google_cloud_run_v2_service.api.name}\" AND metric.labels.response_code_class = \"5xx\""
      aligner  = "ALIGN_RATE"
      reducer  = "REDUCE_SUM"
      group_by = []
      unit     = "errors/s"
    },
    {
      title    = "API p95 request latency"
      metric   = "run.googleapis.com/request_latencies"
      filter   = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${google_cloud_run_v2_service.api.name}\""
      aligner  = "ALIGN_PERCENTILE_95"
      reducer  = "REDUCE_PERCENTILE_95"
      group_by = []
      unit     = "ms"
    },
    {
      title    = "Cloud Run instances"
      metric   = "run.googleapis.com/container/instance_count"
      filter   = "resource.type = \"cloud_run_revision\" AND (resource.labels.service_name = \"${google_cloud_run_v2_service.api.name}\" OR resource.labels.service_name = \"${google_cloud_run_v2_service.dispatcher.name}\")"
      aligner  = "ALIGN_MEAN"
      reducer  = "REDUCE_SUM"
      group_by = ["resource.labels.service_name"]
      unit     = "instances"
    },
    {
      title    = "Cloud SQL CPU utilization"
      metric   = "cloudsql.googleapis.com/database/cpu/utilization"
      filter   = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:${google_sql_database_instance.postgres.name}\""
      aligner  = "ALIGN_MEAN"
      reducer  = "REDUCE_MEAN"
      group_by = []
      unit     = "ratio"
    },
    {
      title    = "Cloud SQL connections"
      metric   = "cloudsql.googleapis.com/database/postgresql/num_backends"
      filter   = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:${google_sql_database_instance.postgres.name}\""
      aligner  = "ALIGN_MEAN"
      reducer  = "REDUCE_SUM"
      group_by = []
      unit     = "connections"
    },
    {
      title    = "Cloud SQL disk utilization"
      metric   = "cloudsql.googleapis.com/database/disk/utilization"
      filter   = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:${google_sql_database_instance.postgres.name}\""
      aligner  = "ALIGN_MEAN"
      reducer  = "REDUCE_MEAN"
      group_by = []
      unit     = "ratio"
    },
    {
      title    = "Generation queue depth"
      metric   = "cloudtasks.googleapis.com/queue/depth"
      filter   = "resource.type = \"cloud_tasks_queue\" AND resource.labels.queue_id = \"${google_cloud_tasks_queue.generation.name}\""
      aligner  = "ALIGN_MAX"
      reducer  = "REDUCE_SUM"
      group_by = []
      unit     = "tasks"
    },
    {
      title    = "Generation task attempts"
      metric   = "cloudtasks.googleapis.com/queue/task_attempt_count"
      filter   = "resource.type = \"cloud_tasks_queue\" AND resource.labels.queue_id = \"${google_cloud_tasks_queue.generation.name}\""
      aligner  = "ALIGN_RATE"
      reducer  = "REDUCE_SUM"
      group_by = ["metric.labels.response_code"]
      unit     = "attempts/s"
    },
    {
      title    = "Generation failures"
      metric   = "logging.googleapis.com/user/${google_logging_metric.generation_failures.name}"
      filter   = "resource.type = \"cloud_run_revision\""
      aligner  = "ALIGN_RATE"
      reducer  = "REDUCE_SUM"
      group_by = []
      unit     = "failures/s"
    },
    {
      title    = "Cloud Run to Cloud SQL refusals"
      metric   = "run.googleapis.com/infrastructure/cloudsql/connection_refused_count"
      filter   = "resource.type = \"cloud_run_revision\" AND (resource.labels.service_name = \"${google_cloud_run_v2_service.api.name}\" OR resource.labels.service_name = \"${google_cloud_run_v2_service.dispatcher.name}\")"
      aligner  = "ALIGN_RATE"
      reducer  = "REDUCE_SUM"
      group_by = ["resource.labels.service_name"]
      unit     = "refusals/s"
    },
  ]
}

resource "google_monitoring_dashboard" "operations" {
  dashboard_json = jsonencode({
    displayName = "${local.name}: operations"
    gridLayout = {
      columns = 2
      widgets = [
        for widget in local.dashboard_widgets : {
          title = widget.title
          xyChart = {
            chartOptions = {
              mode = "COLOR"
            }
            dataSets = [{
              plotType   = "LINE"
              targetAxis = "Y1"
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "metric.type = \"${widget.metric}\" AND ${widget.filter}"
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = widget.aligner
                    crossSeriesReducer = widget.reducer
                    groupByFields      = widget.group_by
                  }
                }
              }
            }]
            yAxis = {
              label = widget.unit
              scale = "LINEAR"
            }
          }
        }
      ]
    }
  })

  # Cloud Monitoring writes server-managed name/etag fields into dashboard_json
  # and normalizes some empty arrays. Ignoring that normalized response prevents
  # a perpetual in-place update after a successful create.
  lifecycle {
    ignore_changes = [dashboard_json]
  }
}
