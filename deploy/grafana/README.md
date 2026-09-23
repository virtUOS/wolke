# Observability

The app exposes Prometheus metrics at `GET /metrics`, **token-gated** via
`METRICS_TOKEN` and never published past Caddy (docs/02 §7). Metric names use the
neutral `wolke_` prefix.

## Prometheus scrape

```yaml
scrape_configs:
  - job_name: wolke
    metrics_path: /metrics
    honor_labels: true # see below — without it the app's `service` label is renamed
    authorization:
      type: Bearer
      credentials: ${METRICS_TOKEN}
    static_configs:
      - targets: ['app:8080'] # the app inside the Compose network, not via Caddy
```

### `honor_labels: true`, and why every panel depends on it

Several wolke metrics carry a `service` label — the catalog service the click or
the favorite belongs to. If your scrape config attaches a label *also* called
`service` (a common convention for "which application is this", and what
service-discovery in Kubernetes or a shared Prometheus often adds), Prometheus
resolves the collision by renaming the metric's own label to
**`exported_service`**.

The dashboard queries `service`, because that is what the application exports.
On a Prometheus that renames it, every service-labelled panel silently returns
no data — no error, just empty panels — and nothing in the dashboard hints at
why. `honor_labels: true` tells Prometheus to keep the application's labels when
they collide, which is what this dashboard assumes.

If you cannot set it (the job is shared, or the collision is deliberate), the
other way out is to rename the *target's* label instead — call it `job_service`
or similar — rather than editing 14 panels to say `exported_service`, which
would then break for everyone else.

## Grafana dashboard

Import `wolke-dashboard.json` (Dashboards → New → Import) and pick your
Prometheus data source when prompted.

**Format:** a `dashboard.grafana.app/v2` resource — what Grafana writes when you
edit a dashboard in the UI. Kept as v2 deliberately: recent Grafana converts a
classic dashboard to v2 internally anyway, and a hand-edited re-export comes back
as v2, so committing classic JSON would not survive the round trip.

The trade is a **minimum Grafana version**. Measured against this file by
importing it:

| Grafana | Result |
|---------|--------|
| 13.2.2 | Imports and renders all 14 panels natively. |
| 12.4.9 | Imports and renders all 14 panels, but banners "The Dynamic Dashboard feature is temporarily disabled" and opens it as a *classic* dashboard — saving from there can drop v2 features. |
| 12.0.0 | Import "succeeds" and produces an **empty dashboard**: no panels, no error, no warning. |

So: **Grafana 13 or newer**. 12.4.x works if you only read it. Below that the
failure is silent, which is the part worth knowing — an empty dashboard looks
like a broken data source, not like a file the server could not read.

### Before committing a re-exported dashboard

A UI export carries the exporting instance's identity in `metadata`. The
committed file must not: it ships to forks, and none of those values mean
anything anywhere else. The whole block is stripped down to one key.

Check, in the file you are about to commit:

1. **`metadata` contains exactly one key: `name: wolke`.** No `namespace`, `uid`,
   `resourceVersion`, `generation`, `creationTimestamp`, `labels` or
   `annotations` — the last of which holds `grafana.app/createdBy`,
   `grafana.app/updatedBy` and a `saved-from-ui` build string.
2. **`metadata` is present at all.** Established by trying it: with the key
   removed entirely, the import form silently does nothing — it never reaches the
   options step. `metadata: {}` is accepted, but Grafana then generates a random
   uid and the dashboard URL changes on every import, so `name: wolke` stays (it
   is what the classic file's `uid: wolke` used to do, and it is our slug, not
   the exporting instance's).
3. **`spec.title` is `wolke`**, not your institution's name (golden rule 8).
4. No `exported_service` anywhere — see the scrape section above.

There is no tooling for this; it is four `grep`s worth of checking, on a file
that changes a few times a year.

Three dashboard variables: the data source, **Instance** — the scrape targets to
include, multi-select with an "All" that matches every instance — and **Role**,
read from the metric with `label_values(wolke_service_favorites, role)`. Roles
are a deployment's OIDC claim mapping (docs/specs, issue #96), so no panel names
one: a deployment with `staff`/`student` and one with five roles both get panels
that work.

### Why some panels sum and others max

The metrics split into two families, and the panels aggregate them differently
on purpose. Each panel's description now *names its metric and its family first*,
so a description copied onto the wrong panel is visibly wrong rather than
quietly plausible — that copy is exactly how a `max` once ended up on a counter.

- **Per-instance counters** — `wolke_service_clicks_total`,
  `wolke_service_favorites_added_total`, `wolke_service_favorites_removed_total`
  and the request histogram accumulate locally from the traffic each instance
  served, so the panels `sum` across the selection to get a fleet total. A `max`
  here reports the busiest instance, not the total.
- **Shared-state gauges** — `wolke_active_sessions`, `wolke_catalog_services`,
  `wolke_announcements_active` and `wolke_service_favorites` are read from the
  one Postgres on every instance's refresh, so *every instance reports the same
  number*. Those panels use `max`, which returns the true value for any
  selection; summing them would multiply it by the instance count.

Don't "fix" the inconsistency between two adjacent panels — it is the point.

### The two favorites families

`wolke_service_favorites` (gauge) is **current state**: how many users have a
service starred right now, seeded role defaults included.

`wolke_service_favorites_added_total` / `_removed_total` (counters) are the
**movement**, and they count only what users did themselves: the role defaults
pre-filled at first login are never counted, because the increment sits in the
star toggle and not in the seed path. That placement is the whole definition —
the pair is the delta between what users chose and what the deployment
pre-configured, with nothing to subtract. Reading the two top-10 panels side by
side separates a service people try and drop again (high in both) from one they
try and keep (high in added only).

### Panels

Clicks per service in range (top 10), active sessions, catalog services by
state, active announcements by severity, total clicks, favorites per service and
role (top 10 — the current-state gauge, filtered by the Role variable), clicks
per service (rate), favorites added in range (top 10), favorites removed in range
(top 10), favorites per service+role (table — the gauge again, so a user's pins
move between roles when their role changes), clicks per service+target (table —
launch link vs. documentation link), clicks per service+role+target (table —
whether a role launches straight in or reads the docs first), clicks per
service+role (table), and request p95 latency by route.
