package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/httpx"
	"github.com/virtuos/wolke/internal/service"
)

// listFavorites returns the user's favorited services, resolved via the catalog
// cache so the shape matches /api/catalog (docs/02 §12). Favorites are a flat
// set — no lists (docs/01 §4.4).
func listFavorites(c *catalog.Cache, db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		ids, err := service.ListFavorites(r.Context(), db, user)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		snap, err := c.Get(r.Context())
		if err != nil {
			httpx.WriteProblem(w, http.StatusInternalServerError, "catalog_unavailable", "Could not load the catalog.")
			return
		}
		services := make([]catalog.Service, 0, len(ids))
		for _, id := range ids {
			if svc, ok := snap.ServiceByID(id); ok {
				services = append(services, svc)
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"services": services})
	}
}

func addFavorite(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		serviceID, ok := decodeServiceID(w, r)
		if !ok {
			return
		}
		if err := service.AddFavorite(r.Context(), db, user.ID, serviceID); err != nil {
			writeServiceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func removeFavorite(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		serviceID, ok := decodeServiceID(w, r)
		if !ok {
			return
		}
		if err := service.RemoveFavorite(r.Context(), db, user.ID, serviceID); err != nil {
			writeServiceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// setFavoritesOrder handles PUT /api/favorites/order: the whole ordered list of
// the caller's favorites, written to favorites.sort (issue #125). A whole-list
// write rather than a move-one-step call, so a client and the server can never
// end up with two different notions of the order; sending the same list twice
// is a no-op. Validation (permutation, no duplicates) lives in internal/service.
func setFavoritesOrder(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		var body struct {
			ServiceIDs []string `json:"service_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		ids := make([]pgtype.UUID, 0, len(body.ServiceIDs))
		for _, s := range body.ServiceIDs {
			id, ok := parseUUID(s)
			if !ok {
				httpx.WriteProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id in list.")
				return
			}
			ids = append(ids, id)
		}
		if err := service.SetFavoritesOrder(r.Context(), db, user.ID, ids); err != nil {
			writeServiceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// decodeServiceID reads {service_id} from the body and parses it, writing the
// error response itself on failure.
func decodeServiceID(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	var body struct {
		ServiceID string `json:"service_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
		return pgtype.UUID{}, false
	}
	id, ok := parseUUID(body.ServiceID)
	if !ok {
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id.")
		return pgtype.UUID{}, false
	}
	return id, true
}

// writeServiceError maps use-case errors to HTTP problem responses.
func writeServiceError(w http.ResponseWriter, err error) {
	var ve *service.ValidationError
	var nf *service.NotFoundError
	switch {
	case errors.As(err, &ve):
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid", ve.Error())
	case errors.As(err, &nf):
		httpx.WriteProblem(w, http.StatusNotFound, "not_found", nf.Error())
	default:
		httpx.WriteProblem(w, http.StatusInternalServerError, "internal", "Unexpected error.")
	}
}

func parseUUID(s string) (pgtype.UUID, bool) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return u, false
	}
	return u, u.Valid
}
