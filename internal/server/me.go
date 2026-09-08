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
	// Visibility is the service-visibility state the SPA needs
	// (docs/specs/service-visibility.md §5): what the user holds, what they
	// opted into themselves, and the configured entries (labels for the tile
	// badge, warnings for the opt-in dialog). Empty lists when nothing is
	// configured — the account menu then renders no visibility UI at all.
	Visibility meVisibility `json:"visibility"`
}

type meVisibility struct {
	Held    []string            `json:"held"`
	OptIn   []string            `json:"optin"`
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
	// The stored opt-in list is reported filtered the same way it is granted:
	// a slug that no longer exists or changed grant type is not "on".
	optin := vis.Held(nil, u.VisibilityOptin)
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
		Visibility: meVisibility{
			Held:    held,
			OptIn:   optin,
			Entries: visibleEntries(u, vis, held),
		},
	}
}

// visibleEntries is what one user may learn about the configured groups: the
// opt-in ones (they render as the user's own switches) plus the labels of
// whatever else they hold (for the tile badge). A claim-granted group the user
// does not hold is never named here — categories are narrowed precisely so a
// group's name cannot leak, and /api/me must not undo that. Admins get the
// whole list: the service form is the one consumer that needs it.
func visibleEntries(u store.User, vis config.VisibilitySet, held []string) []config.Visibility {
	all := vis.List()
	if u.IsAdmin {
		return all
	}
	out := make([]config.Visibility, 0, len(all))
	for _, v := range all {
		if v.Grant == config.GrantOptIn || slices.Contains(held, v.Slug) {
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
