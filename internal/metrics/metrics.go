// Package metrics holds the Prometheus collectors and the scrape endpoint
// (docs/02 §7). The metric prefix is the neutral product name (wolke_), not
// an institution name, per the white-label rule (CLAUDE.md rule 8). Exported
// labels are aggregate only — never a user identifier.
package metrics

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strconv"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/virtuos/wolke/internal/store"
)

// Metrics owns a private registry and the app's collectors.
type Metrics struct {
	reg *prometheus.Registry

	ClicksTotal     *prometheus.CounterVec   // service, role
	RequestDuration *prometheus.HistogramVec // route, method, code

	activeSessions      prometheus.Gauge
	catalogServices     *prometheus.GaugeVec // state=active|inactive
	announcementsActive *prometheus.GaugeVec // severity
}

// New builds and registers the collectors on a private registry.
func New() *Metrics {
	m := &Metrics{
		reg: prometheus.NewRegistry(),
		ClicksTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "wolke_service_clicks_total",
			Help: "Launch clicks per service and role.",
		}, []string{"service", "role"}),
		RequestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "wolke_http_request_duration_seconds",
			Help:    "HTTP request duration by route, method, and status code.",
			Buckets: prometheus.DefBuckets,
		}, []string{"route", "method", "code"}),
		activeSessions: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "wolke_active_sessions",
			Help: "Currently valid server-side sessions.",
		}),
		catalogServices: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "wolke_catalog_services",
			Help: "Number of catalog services by state.",
		}, []string{"state"}),
		announcementsActive: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "wolke_announcements_active",
			Help: "Active announcements by severity.",
		}, []string{"severity"}),
	}
	m.reg.MustRegister(m.ClicksTotal, m.RequestDuration, m.activeSessions, m.catalogServices, m.announcementsActive)
	return m
}

// ObserveRequest records one request's duration.
func (m *Metrics) ObserveRequest(route, method string, code int, seconds float64) {
	m.RequestDuration.WithLabelValues(route, method, strconv.Itoa(code)).Observe(seconds)
}

// IncClick increments the per-service/role click counter.
func (m *Metrics) IncClick(service, role string) {
	m.ClicksTotal.WithLabelValues(service, role).Inc()
}

// GaugeSource provides the DB counts the periodic refresh reads (satisfied by
// *store.DB).
type GaugeSource interface {
	CountActiveSessions(ctx context.Context) (int64, error)
	CountServicesByState(ctx context.Context) ([]store.CountServicesByStateRow, error)
	CountActiveAnnouncementsBySeverity(ctx context.Context) ([]store.CountActiveAnnouncementsBySeverityRow, error)
}

// RefreshGauges updates the gauges from the database.
func (m *Metrics) RefreshGauges(ctx context.Context, src GaugeSource) error {
	n, err := src.CountActiveSessions(ctx)
	if err != nil {
		return err
	}
	m.activeSessions.Set(float64(n))

	rows, err := src.CountServicesByState(ctx)
	if err != nil {
		return err
	}
	active, inactive := 0.0, 0.0
	for _, r := range rows {
		if r.IsActive {
			active = float64(r.N)
		} else {
			inactive = float64(r.N)
		}
	}
	m.catalogServices.WithLabelValues("active").Set(active)
	m.catalogServices.WithLabelValues("inactive").Set(inactive)

	anns, err := src.CountActiveAnnouncementsBySeverity(ctx)
	if err != nil {
		return err
	}
	m.announcementsActive.Reset()
	for _, a := range anns {
		m.announcementsActive.WithLabelValues(a.Severity).Set(float64(a.N))
	}
	return nil
}

// Handler serves /metrics. If token is non-empty it requires a matching bearer
// token; /metrics must never be publicly reachable (docs/02 §7 — Caddy also
// blocks it).
func (m *Metrics) Handler(token string) http.Handler {
	h := promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
	if token == "" {
		return h
	}
	want := "Bearer " + token
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := r.Header.Get("Authorization")
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h.ServeHTTP(w, r)
	})
}
