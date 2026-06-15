# Observability

The app exposes Prometheus metrics at `GET /metrics`, **token-gated** via
`METRICS_TOKEN` and never published past Caddy (docs/02 §7). Metric names use the
neutral `servicehub_` prefix.

## Prometheus scrape

```yaml
scrape_configs:
  - job_name: service-hub
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: ${METRICS_TOKEN}
    static_configs:
      - targets: ['app:8080'] # the app inside the Compose network, not via Caddy
```

## Grafana dashboard

Import `service-hub-dashboard.json` (Dashboards → New → Import) and pick your
Prometheus data source when prompted. Panels: clicks per service (rate), clicks
per service+role (table), request p95 latency by route, active sessions, catalog
services by state, and active announcements by severity.
