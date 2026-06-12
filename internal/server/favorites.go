package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/service"
)

// listFavorites returns the user's lists with their items (docs/02 §12).
func listFavorites(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		lists, err := service.ListFavorites(r.Context(), db, user.ID)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"lists": lists})
	}
}

func createList(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		list, err := service.CreateList(r.Context(), db, user.ID, body.Name)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, list)
	}
}

func patchList(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		listID, ok := parseUUID(chi.URLParam(r, "id"))
		if !ok {
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid list id.")
			return
		}
		var body struct {
			Name *string `json:"name"`
			Sort *int    `json:"sort"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		if body.Name != nil {
			if err := service.RenameList(r.Context(), db, user.ID, listID, *body.Name); err != nil {
				writeServiceError(w, err)
				return
			}
		}
		if body.Sort != nil {
			if err := service.ReorderList(r.Context(), db, user.ID, listID, *body.Sort); err != nil {
				writeServiceError(w, err)
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func deleteList(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		listID, ok := parseUUID(chi.URLParam(r, "id"))
		if !ok {
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid list id.")
			return
		}
		if err := service.DeleteList(r.Context(), db, user.ID, listID); err != nil {
			writeServiceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// addItem adds a service to a list. With no list_id it quick-stars to the default
// list (creating it on first use); the response carries the target list id.
func addItem(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		var body struct {
			ListID    string `json:"list_id"`
			ServiceID string `json:"service_id"`
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
		if body.ListID == "" {
			listID, err := service.QuickStar(r.Context(), db, user.ID, serviceID)
			if err != nil {
				writeServiceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"list_id": listID})
			return
		}
		listID, ok := parseUUID(body.ListID)
		if !ok {
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid list id.")
			return
		}
		if err := service.AddItem(r.Context(), db, user.ID, listID, serviceID); err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"list_id": body.ListID})
	}
}

func removeItem(db service.FavoritesStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		var body struct {
			ListID    string `json:"list_id"`
			ServiceID string `json:"service_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		listID, ok1 := parseUUID(body.ListID)
		serviceID, ok2 := parseUUID(body.ServiceID)
		if !ok1 || !ok2 {
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid list or service id.")
			return
		}
		if err := service.RemoveItem(r.Context(), db, user.ID, listID, serviceID); err != nil {
			writeServiceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// writeServiceError maps use-case errors to HTTP problem responses.
func writeServiceError(w http.ResponseWriter, err error) {
	var ve *service.ValidationError
	var nf *service.NotFoundError
	switch {
	case errors.As(err, &ve):
		writeProblem(w, http.StatusBadRequest, "invalid", ve.Error())
	case errors.As(err, &nf):
		writeProblem(w, http.StatusNotFound, "not_found", nf.Error())
	default:
		writeProblem(w, http.StatusInternalServerError, "internal", "Unexpected error.")
	}
}

func parseUUID(s string) (pgtype.UUID, bool) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return u, false
	}
	return u, u.Valid
}
