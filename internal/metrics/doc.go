// Package metrics holds the Prometheus collectors served at /metrics
// (scrape-protected, never public). Exported labels are aggregate only — never a
// user identifier (docs/02 §7). Populated in Phase 4.
package metrics
