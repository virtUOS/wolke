package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/virtUOS/service-hub/internal/service"
)

// updatePrefs handles PATCH /api/me/prefs (docs/02 §12). Unspecified fields keep
// the user's current value; validation and the write live in internal/service.
func updatePrefs(db service.PrefsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			writeProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		var body struct {
			Theme                *string `json:"theme"`
			ViewMode             *string `json:"view_mode"`
			FavoritesOrder       *string `json:"favorites_order"`
			FavoritesSeparateTab *bool   `json:"favorites_separate_tab"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}

		p := service.Prefs{
			Theme:                user.Theme,
			ViewMode:             user.ViewMode,
			FavoritesOrder:       user.FavoritesOrder,
			FavoritesSeparateTab: user.FavoritesSeparateTab,
		}
		if body.Theme != nil {
			p.Theme = *body.Theme
		}
		if body.ViewMode != nil {
			p.ViewMode = *body.ViewMode
		}
		if body.FavoritesOrder != nil {
			p.FavoritesOrder = *body.FavoritesOrder
		}
		if body.FavoritesSeparateTab != nil {
			p.FavoritesSeparateTab = *body.FavoritesSeparateTab
		}

		updated, err := service.UpdatePrefs(r.Context(), db, user.ID, p)
		if err != nil {
			var ve *service.ValidationError
			if errors.As(err, &ve) {
				writeProblem(w, http.StatusBadRequest, "invalid_prefs", ve.Error())
				return
			}
			writeProblem(w, http.StatusInternalServerError, "prefs_update_failed", "Could not save your preferences.")
			return
		}
		writeJSON(w, http.StatusOK, toMeResponse(updated))
	}
}
