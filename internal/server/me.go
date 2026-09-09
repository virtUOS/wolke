package server

import (
	"fmt"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/httpx"
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
	Locale               string `json:"locale"`
	FavoritesOrder       string `json:"favorites_order"`
	FavoritesSeparateTab bool   `json:"favorites_separate_tab"`
	// ShowBeta is the user's own choice to see the services tagged beta, which
	// are hidden by default (docs/specs/service-visibility.md §2.1). A pref like
	// any other — it is written through PATCH /api/me/prefs.
	ShowBeta bool `json:"show_beta"`
	// Visibility is the group state the SPA needs (§2.2): the slugs this user
	// holds, and the configured entries whose labels name them. Empty when the
	// deployment configures no groups.
	Visibility meVisibility `json:"visibility"`
}

type meVisibility struct {
	Held    []string            `json:"held"`
	Entries []config.Visibility `json:"entries"`
}

// me returns the authenticated user. It assumes requireUserJSON ran first.
func me(vis config.VisibilitySet) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			httpx.WriteProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		writeJSON(w, http.StatusOK, toMeResponse(user, vis))
	}
}

func toMeResponse(u store.User, vis config.VisibilitySet) meResponse {
	held := heldByUser(u, vis)
	return meResponse{
		ID:                   uuidString(u.ID),
		DisplayName:          u.DisplayName,
		Email:                textString(u.Email),
		PrimaryRole:          u.PrimaryRole,
		IsAdmin:              u.IsAdmin,
		ViewMode:             u.ViewMode,
		Theme:                u.Theme,
		Locale:               u.Locale,
		FavoritesOrder:       u.FavoritesOrder,
		FavoritesSeparateTab: u.FavoritesSeparateTab,
		ShowBeta:             u.ShowBeta,
		Visibility: meVisibility{
			Held:    held,
			Entries: visibleEntries(u, vis, held),
		},
	}
}

// visibleEntries is what one user may learn about the configured groups: only
// the ones they hold. A group the user does not hold is never named here —
// categories are narrowed precisely so a group's name cannot leak, and /api/me
// must not undo that. Admins get the whole list: the category editor is the one
// consumer that needs it.
func visibleEntries(u store.User, vis config.VisibilitySet, held []string) []config.Visibility {
	all := vis.List()
	if u.IsAdmin {
		return all
	}
	out := make([]config.Visibility, 0, len(all))
	for _, v := range all {
		if slices.Contains(held, v.Slug) {
			out = append(out, v)
		}
	}
	return out
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
