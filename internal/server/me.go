package server

import (
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// meResponse is the current-user read model (docs/02 §12): identity, role/admin,
// and the persisted prefs the SPA needs to render.
type meResponse struct {
	ID                   string `json:"id"`
	DisplayName          string `json:"display_name"`
	Email                string `json:"email,omitempty"`
	PrimaryRole          string `json:"primary_role"`
	IsAdmin              bool   `json:"is_admin"`
	ViewMode             string `json:"view_mode"`
	Theme                string `json:"theme"`
	FavoritesOrder       string `json:"favorites_order"`
	FavoritesSeparateTab bool   `json:"favorites_separate_tab"`
}

// me returns the authenticated user. It assumes requireUserJSON ran first.
func me(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
		return
	}
	writeJSON(w, http.StatusOK, toMeResponse(user))
}

func toMeResponse(u store.User) meResponse {
	return meResponse{
		ID:                   uuidString(u.ID),
		DisplayName:          u.DisplayName,
		Email:                textString(u.Email),
		PrimaryRole:          u.PrimaryRole,
		IsAdmin:              u.IsAdmin,
		ViewMode:             u.ViewMode,
		Theme:                u.Theme,
		FavoritesOrder:       u.FavoritesOrder,
		FavoritesSeparateTab: u.FavoritesSeparateTab,
	}
}

func uuidString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func textString(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}
