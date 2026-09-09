package server

import (
	"context"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// heldBy is the current user's held visibility slugs: what the IdP granted at
// login, filtered to the slugs config still defines
// (docs/specs/service-visibility.md §2.2). Nothing held when there is no user
// in the context.
func heldBy(ctx context.Context, vis config.VisibilitySet) []string {
	user, ok := userFromContext(ctx)
	if !ok {
		return nil
	}
	return heldByUser(user, vis)
}

func heldByUser(u store.User, vis config.VisibilitySet) []string {
	return vis.Held(u.VisibilityClaims)
}

// showBetaFor reports whether the current user asked to see beta services
// (§2.1). No user — no beta, the same answer the catalog MCP gets.
func showBetaFor(ctx context.Context) bool {
	user, ok := userFromContext(ctx)
	return ok && user.ShowBeta
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
	return snap.VisibleTo(heldBy(ctx, vis), showBetaFor(ctx)), nil
}
