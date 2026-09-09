package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/httpx"
	"github.com/virtuos/wolke/internal/service"
)

// updatePrefs handles PATCH /api/me/prefs (docs/02 §12). Unspecified fields keep
// the user's current value; validation and the write live in internal/service.
func updatePrefs(db service.PrefsStore, vis config.VisibilitySet) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			httpx.WriteProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		var body struct {
			Theme                *string `json:"theme"`
			ViewMode             *string `json:"view_mode"`
			Locale               *string `json:"locale"`
			FavoritesOrder       *string `json:"favorites_order"`
			FavoritesSeparateTab *bool   `json:"favorites_separate_tab"`
			ShowBeta             *bool   `json:"show_beta"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}

		p := service.Prefs{
			Theme:                user.Theme,
			ViewMode:             user.ViewMode,
			Locale:               user.Locale,
			FavoritesOrder:       user.FavoritesOrder,
			FavoritesSeparateTab: user.FavoritesSeparateTab,
			ShowBeta:             user.ShowBeta,
		}
		if body.Theme != nil {
			p.Theme = *body.Theme
		}
		if body.ViewMode != nil {
			p.ViewMode = *body.ViewMode
		}
		if body.Locale != nil {
			p.Locale = *body.Locale
		}
		if body.FavoritesOrder != nil {
			p.FavoritesOrder = *body.FavoritesOrder
		}
		if body.FavoritesSeparateTab != nil {
			p.FavoritesSeparateTab = *body.FavoritesSeparateTab
		}
		if body.ShowBeta != nil {
			p.ShowBeta = *body.ShowBeta
		}

		updated, err := service.UpdatePrefs(r.Context(), db, user.ID, p)
		if err != nil {
			var ve *service.ValidationError
			if errors.As(err, &ve) {
				httpx.WriteProblem(w, http.StatusBadRequest, "invalid_prefs", ve.Error())
				return
			}
			serverError(w, r, "prefs_update_failed", "Could not save your preferences.", err)
			return
		}
		writeJSON(w, http.StatusOK, toMeResponse(updated, vis))
	}
}
