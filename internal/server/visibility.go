package server

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/httpx"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// heldBy is the current user's effective visibility held set (spec §4):
// claims ∪ opt-in, each filtered to configured slugs of the matching grant
// type. Nothing held when there is no user in the context.
func heldBy(ctx context.Context, vis config.VisibilitySet) []string {
	user, ok := userFromContext(ctx)
	if !ok {
		return nil
	}
	return heldByUser(user, vis)
}

func heldByUser(u store.User, vis config.VisibilitySet) []string {
	return vis.Held(u.VisibilityClaims, u.VisibilityOptin)
}

// visibleCatalog is the ONE way a handler gets a readable catalog: the cached
// raw snapshot, narrowed to what the current user may see. The raw snapshot
// has no readable accessors, so a handler cannot skip this step and compile
// (docs/specs/service-visibility.md §3).
func visibleCatalog(ctx context.Context, c *catalog.Cache, vis config.VisibilitySet) (*catalog.View, error) {
	snap, err := c.Get(ctx)
	if err != nil {
		return nil, err
	}
	return snap.VisibleTo(heldBy(ctx, vis)), nil
}

// setVisibilityOptIn handles PUT /api/me/visibility: the whole list of opt-in
// slugs the user has enabled (issue #34). Validation and the write live in
// internal/service; the response is the refreshed /api/me shape so the SPA can
// replace its cached user in one step.
func setVisibilityOptIn(db service.VisibilityStore, vis config.VisibilitySet) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			httpx.WriteProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		var body struct {
			OptIn []string `json:"optin"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		updated, err := service.SetVisibilityOptIn(r.Context(), db, vis, user.ID, body.OptIn)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toMeResponse(updated, vis))
	}
}
