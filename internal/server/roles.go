package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// mustRolesJSON renders the role set once, at router build time: the response
// is the same for every request, and the set cannot change without a restart.
func mustRolesJSON(roles config.RoleSet) []byte {
	body, err := json.Marshal(roles.List())
	if err != nil {
		// A slug/label map cannot fail to marshal; a panic here is a programming
		// error at startup, never a request-time failure.
		panic(fmt.Sprintf("marshal role set: %v", err))
	}
	return body
}

// roleList serves GET /api/roles: the deployment's configured roles in
// precedence order, with display labels (docs/02 §12). The admin screens render
// their role tabs and their announcement audience picker from it, so a
// deployment that configures two roles shows two roles — no rebuild, no
// hardcoded triple. The audience picker adds "all" client-side.
func roleList(body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
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
