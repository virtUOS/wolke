package server

import (
	"net/http"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// roleList serves GET /api/roles: the deployment's configured roles in
// precedence order, with display labels (docs/02 §12). The admin screens render
// their role tabs and their announcement audience picker from it, so a
// deployment that configures two roles shows two roles — no rebuild, no
// hardcoded triple. The audience picker adds "all" client-side.
func roleList(roles config.RoleSet) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, roles.List())
	}
}

// withEffectiveRole maps a user's stored role onto the configured set. A row
// left behind by an earlier claim mapping reads as the default rather than
// failing, and heals itself at that user's next login, when roles re-resolve
// (spec §2.2). Applied once, where the session is loaded, so every downstream
// read — /api/me, the default view, announcement scoping — agrees.
func withEffectiveRole(u store.User, roles config.RoleSet) store.User {
	u.PrimaryRole = roles.Effective(u.PrimaryRole)
	return u
}

// flagUnknownAudiences marks announcements addressed to a role this deployment
// no longer configures. They reach nobody (no user can hold that role), but the
// admin list still shows them, flagged, so the notice is fixable instead of
// invisible.
func flagUnknownAudiences(list []announce.Announcement, roles config.RoleSet) {
	for i, a := range list {
		list[i].AudienceUnknown = a.Audience != service.AudienceAll && !roles.Has(a.Audience)
	}
}
