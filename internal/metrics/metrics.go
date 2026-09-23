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

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// Metrics owns a private registry and the app's collectors.
type Metrics struct {
	reg *prometheus.Registry

	ClicksTotal     *prometheus.CounterVec   // service, role, target
	RequestDuration *prometheus.HistogramVec // route, method, code

	favoritesAdded   *prometheus.CounterVec // service, role
	favoritesRemoved *prometheus.CounterVec // service, role

	activeSessions      *prometheus.GaugeVec // role
	catalogServices     *prometheus.GaugeVec // state=active|inactive
	announcementsActive *prometheus.GaugeVec // severity
	serviceFavorites    *prometheus.GaugeVec // service (name, as on ClicksTotal), role
}

// New builds and registers the collectors on a private registry.
func New() *Metrics {
	m := &Metrics{
		reg: prometheus.NewRegistry(),
		ClicksTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "wolke_service_clicks_total",
			Help: "Clicks per service, role, and target (service launch | documentation link).",
		}, []string{"service", "role", "target"}),
		RequestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "wolke_http_request_duration_seconds",
			Help:    "HTTP request duration by route, method, and status code.",
			Buckets: prometheus.DefBuckets,
		}, []string{"route", "method", "code"}),
		// Counted only where the user themselves toggles the star, so the pair
		// is the delta to the pre-configured favorites rather than "all
		// favorites" — see the increments in internal/service/favorites.go.
		favoritesAdded: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "wolke_service_favorites_added_total",
			Help: "Favorites added by users themselves, per service and role. Never counts the role defaults seeded at first login, so this is the delta to the pre-configured set.",
		}, []string{"service", "role"}),
		favoritesRemoved: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "wolke_service_favorites_removed_total",
			Help: "Favorites removed by users themselves, per service and role. Counts a removed role default too: dropping one is a user choice.",
		}, []string{"service", "role"}),
		activeSessions: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "wolke_active_sessions",
			Help: "Currently valid server-side sessions, per role. The total is the sum across roles — see the dashboard's Active sessions panel (#232).",
		}, []string{"role"}),
		catalogServices: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "wolke_catalog_services",
			Help: "Number of catalog services by state.",
		}, []string{"state"}),
		announcementsActive: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "wolke_announcements_active",
			Help: "Active announcements by severity.",
		}, []string{"severity"}),
		serviceFavorites: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "wolke_service_favorites",
			Help: "Users currently having a service favorited, per active service and role. Current state: a user's favorites move between roles when their role changes.",
		}, []string{"service", "role"}),
	}
	m.reg.MustRegister(m.ClicksTotal, m.RequestDuration, m.favoritesAdded, m.favoritesRemoved, m.activeSessions, m.catalogServices, m.announcementsActive, m.serviceFavorites)
	return m
}

// ObserveRequest records one request's duration.
func (m *Metrics) ObserveRequest(route, method string, code int, seconds float64) {
	m.RequestDuration.WithLabelValues(route, method, strconv.Itoa(code)).Observe(seconds)
}

// IncClick increments the per-service/role/target click counter. target is the
// link followed (usage.TargetService | usage.TargetDocumentation).
func (m *Metrics) IncClick(service, role, target string) {
	m.ClicksTotal.WithLabelValues(service, role, target).Inc()
}

// IncFavoriteAdded increments the per-service/role counter of favorites the
// user added themselves. It and IncFavoriteRemoved below are counters,
// per-instance like ClicksTotal,
// so dashboard queries sum across instances — unlike the wolke_service_favorites
// gauge, which is shared state read from the database and is maxed (#224).
//
// Together they satisfy service.FavoriteMetrics; the rule about which call
// sites may reach them lives there, with the increments.
func (m *Metrics) IncFavoriteAdded(service, role string) {
	m.favoritesAdded.WithLabelValues(service, role).Inc()
}

// IncFavoriteRemoved is the un-star counterpart of IncFavoriteAdded.
func (m *Metrics) IncFavoriteRemoved(service, role string) {
	m.favoritesRemoved.WithLabelValues(service, role).Inc()
}

// GaugeSource provides the DB counts the periodic refresh reads (satisfied by
// *store.DB).
type GaugeSource interface {
	CountActiveSessionsByRole(ctx context.Context, roles []string) ([]store.CountActiveSessionsByRoleRow, error)
	CountServicesByState(ctx context.Context) ([]store.CountServicesByStateRow, error)
	CountActiveAnnouncementsBySeverity(ctx context.Context) ([]store.CountActiveAnnouncementsBySeverityRow, error)
	CountFavoritesByServiceAndRole(ctx context.Context, roles []string) ([]store.CountFavoritesByServiceAndRoleRow, error)
}

// RefreshGauges updates the gauges from the database.
func (m *Metrics) RefreshGauges(ctx context.Context, src GaugeSource, roles config.RoleSet) error {
	sessions, err := src.CountActiveSessionsByRole(ctx, roles.Slugs())
	if err != nil {
		return err
	}
	// Same three rules as the favorites gauge below, for the same reasons: the
	// query's zero rows keep a role with no sessions in the scrape as an
	// explicit 0, a stale role folds onto the configured default here rather
	// than in SQL (config.RoleSet.Effective is the single place that rule
	// lives), and a role therefore appears more than once and is summed.
	sessionsByRole := make(map[string]float64, len(sessions))
	for _, s := range sessions {
		sessionsByRole[roles.Effective(s.Role)] += float64(s.N)
	}
	// Reset first, so a role dropped from the configuration takes its series
	// with it instead of freezing at its last value.
	m.activeSessions.Reset()
	for role, n := range sessionsByRole {
		m.activeSessions.WithLabelValues(role).Set(n)
	}

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

	favs, err := src.CountFavoritesByServiceAndRole(ctx, roles.Slugs())
	if err != nil {
		return err
	}
	// The query returns a zero row per (active service x configured role) plus
	// the real counts grouped by the role as stored on the user, so a pair can
	// appear twice and is summed here. Folding a stale role — one this
	// deployment no longer configures — onto the configured default happens in
	// Go rather than in SQL so the rule stays in exactly one place,
	// config.RoleSet.Effective, the same function withEffectiveRole uses to
	// decide what that user is actually served.
	totals := make(map[[2]string]float64, len(favs))
	for _, f := range favs {
		totals[[2]string{f.Name, roles.Effective(f.Role)}] += float64(f.N)
	}
	// Reset first: a service that was soft-deleted or renamed has left the
	// query, and all of its series must go with it instead of freezing at
	// their last values.
	m.serviceFavorites.Reset()
	for key, n := range totals {
		m.serviceFavorites.WithLabelValues(key[0], key[1]).Set(n)
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
