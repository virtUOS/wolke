package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/metrics"
	"github.com/virtuos/wolke/internal/usage"
)

// recordClick ingests a click for the current user (docs/01 §5.4, docs/02 §12)
// and increments the per-service/role/target metric. target distinguishes a
// service launch from a documentation-link click. Fire-and-forget from the SPA;
// returns 204.
func recordClick(db usage.Store, cache *catalog.Cache, m *metrics.Metrics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		var body struct {
			ServiceID string `json:"service_id"`
			Target    string `json:"target"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		serviceID, ok := parseUUID(body.ServiceID)
		if !ok {
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id.")
			return
		}
		// Validate target against the closed set: it becomes a Prometheus label, so
		// an arbitrary client value must never mint new series. Empty = launch.
		target := body.Target
		switch target {
		case "":
			target = usage.TargetService
		case usage.TargetService, usage.TargetDocumentation:
		default:
			writeProblem(w, http.StatusBadRequest, "invalid_target", "Unknown click target.")
			return
		}
		if err := usage.Record(r.Context(), db, user.ID, serviceID, user.PrimaryRole, target); err != nil {
			writeProblem(w, http.StatusInternalServerError, "click_failed", "Could not record the event.")
			return
		}
		if m != nil && cache != nil {
			if snap, err := cache.Get(r.Context()); err == nil {
				if svc, ok := snap.ServiceByID(body.ServiceID); ok {
					m.IncClick(svc.Name, user.PrimaryRole, target)
				}
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// frequent returns the user's most-used services, resolved via the catalog cache
// so the shape matches /api/catalog (docs/01 §4.5, docs/02 §12).
func frequent(c *catalog.Cache, db usage.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		ids, err := usage.Frequent(r.Context(), db, user.ID, time.Now().Add(-usage.FrequentWindow), usage.FrequentLimit)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "usage_unavailable", "Could not load frequently-used services.")
			return
		}
		snap, err := c.Get(r.Context())
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "catalog_unavailable", "Could not load the catalog.")
			return
		}
		services := make([]catalog.Service, 0, len(ids))
		for _, id := range ids {
			if svc, ok := snap.ServiceByID(uuidString(id)); ok {
				services = append(services, svc)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"services": services})
	}
}
