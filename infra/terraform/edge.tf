resource "google_compute_region_network_endpoint_group" "api" {
  count                 = var.enable_external_edge ? 1 : 0
  name                  = "${local.name}-api"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.api.name
  }
}

resource "google_compute_security_policy" "edge" {
  count       = var.enable_external_edge ? 1 : 0
  name        = "${local.name}-edge"
  description = "Rate limiting for authentication and generation entry points."

  rule {
    priority = 1000
    action   = "rate_based_ban"
    match {
      expr {
        expression = "request.path.startsWith('/api/auth/') || request.path.matches('/api/projects/[^/]+/messages') || request.path.matches('/api/projects/[^/]+/reviews')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 120
        interval_sec = 60
      }
      ban_duration_sec = 600
      ban_threshold {
        count        = 300
        interval_sec = 300
      }
    }
    description = "Bound abuse of expensive public mutations by source IP."
  }

  rule {
    priority = 2147483647
    action   = "allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Allow traffic not matched by a stricter rule."
  }
}

resource "google_compute_backend_service" "api" {
  count                 = var.enable_external_edge ? 1 : 0
  name                  = "${local.name}-api"
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # The studio holds an SSE stream open; the 30s default chops it every half
  # minute and the browser reconnects in a loop. Match Cloud Run's own limit.
  timeout_sec           = 3600
  security_policy       = google_compute_security_policy.edge[0].id
  backend {
    group = google_compute_region_network_endpoint_group.api[0].id
  }
  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_url_map" "https" {
  count           = var.enable_external_edge ? 1 : 0
  name            = "${local.name}-https"
  default_service = google_compute_backend_service.api[0].id
}

resource "google_compute_managed_ssl_certificate" "app" {
  count = var.enable_external_edge ? 1 : 0
  name  = "${local.name}-certificate"
  managed {
    domains = [var.app_domain]
  }
  lifecycle {
    precondition {
      condition     = var.app_base_url == "https://${var.app_domain}"
      error_message = "app_base_url must be the HTTPS origin for app_domain."
    }
  }
}

resource "google_compute_ssl_policy" "modern" {
  count           = var.enable_external_edge ? 1 : 0
  name            = "${local.name}-modern-tls"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_target_https_proxy" "app" {
  count            = var.enable_external_edge ? 1 : 0
  name             = "${local.name}-https"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
  ssl_policy       = google_compute_ssl_policy.modern[0].id
}

resource "google_compute_global_address" "app" {
  count = var.enable_external_edge ? 1 : 0
  name  = "${local.name}-edge"
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.enable_external_edge ? 1 : 0
  name                  = "${local.name}-https"
  target                = google_compute_target_https_proxy.app[0].id
  ip_address            = google_compute_global_address.app[0].address
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

resource "google_compute_url_map" "http_redirect" {
  count = var.enable_external_edge ? 1 : 0
  name  = "${local.name}-http-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count   = var.enable_external_edge ? 1 : 0
  name    = "${local.name}-http-redirect"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = var.enable_external_edge ? 1 : 0
  name                  = "${local.name}-http"
  target                = google_compute_target_http_proxy.redirect[0].id
  ip_address            = google_compute_global_address.app[0].address
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
