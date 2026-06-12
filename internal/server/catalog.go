package server

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/catalog"
)

// RoleDefaultsStore is the capability the defaults endpoint needs: the
// admin-curated, ordered service ids for a role.
type RoleDefaultsStore interface {
	GetRoleDefaults(ctx context.Context, role string) ([]pgtype.UUID, error)
}

// catalogList serves the active catalog (services + categories) from the cache,
// so the bulk of read traffic never touches the DB (docs/02 §9, §12).
func catalogList(c *catalog.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		snap, err := c.Get(r.Context())
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "catalog_unavailable", "Could not load the catalog.")
			return
		}
		writeJSON(w, http.StatusOK, snap)
	}
}

// catalogDefaults serves the role-ordered default view for the current user
// (docs/01 §3, docs/02 §12): the admin-curated order, resolved to live services.
func catalogDefaults(c *catalog.Cache, defaults RoleDefaultsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			writeProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		snap, err := c.Get(r.Context())
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "catalog_unavailable", "Could not load the catalog.")
			return
		}
		ids, err := defaults.GetRoleDefaults(r.Context(), user.PrimaryRole)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "defaults_unavailable", "Could not load your default view.")
			return
		}
		services := make([]catalog.Service, 0, len(ids))
		for _, id := range ids {
			if svc, ok := snap.ServiceByID(uuidString(id)); ok {
				services = append(services, svc)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"role":     user.PrimaryRole,
			"services": services,
		})
	}
}
