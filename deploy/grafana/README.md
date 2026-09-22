# Observability

The app exposes Prometheus metrics at `GET /metrics`, **token-gated** via
`METRICS_TOKEN` and never published past Caddy (docs/02 §7). Metric names use the
neutral `wolke_` prefix.

## Prometheus scrape

```yaml
scrape_configs:
  - job_name: wolke
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: ${METRICS_TOKEN}
    static_configs:
      - targets: ['app:8080'] # the app inside the Compose network, not via Caddy
```

## Grafana dashboard

Import `wolke-dashboard.json` (Dashboards → New → Import) and pick your
Prometheus data source when prompted.

Two dashboard variables: the data source, and **Instance** — the scrape targets
to include, multi-select with an "All" that matches every instance.

### Why some panels sum and others max

The metrics split into two families, and the panels aggregate them differently
on purpose (each panel's description says which it is):

- **Per-instance counters** — `wolke_service_clicks_total` and the request
  histogram accumulate locally from the traffic each instance served, so the
  panels `sum` across the selection to get a fleet total.
- **Shared-state gauges** — `wolke_active_sessions`, `wolke_catalog_services`,
  `wolke_announcements_active` and `wolke_service_favorites` are read from the
  one Postgres on every instance's refresh, so *every instance reports the same
  number*. Those panels use `max`, which returns the true value for any
  selection; summing them would multiply it by the instance count.

Don't "fix" the inconsistency between two adjacent panels — it is the point.

### Panels

Clicks per service (rate), clicks per service+role (table), request p95 latency
by route, active sessions, catalog services by state, active announcements by
severity, favorites per service (top 10 — `wolke_service_favorites`), clicks per
service+target (table — launch link vs. documentation link), favorites per
service+role (table — the current-state gauge, so a user's pins move between
roles when their role changes), and clicks per service+role+target (table —
whether a role launches straight in or reads the docs first).
