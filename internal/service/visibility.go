package service

// The opt-in flavour of service visibility (docs/specs/service-visibility.md §5,
// issue #34): a user enables a `grant: opt-in` slug themselves. The write is
// validated here — not in the handler — so any future caller enforces the same
// rule (CLAUDE.md rule 3).

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// VisibilityStore is the persistence the opt-in write needs.
type VisibilityStore interface {
	UpdateUserVisibilityOptIn(ctx context.Context, arg store.UpdateUserVisibilityOptInParams) (store.User, error)
}

// SetVisibilityOptIn replaces the user's self-enabled visibility slugs with the
// given whole list — the same idempotent whole-list shape as the favorites
// order, so a client and the server can never disagree about the set. Every
// slug must be configured with grant: opt-in; a claim-granted slug cannot be
// self-granted, and an unknown one cannot be stored. Duplicates collapse; the
// stored order is config order.
func SetVisibilityOptIn(ctx context.Context, db VisibilityStore, vis config.VisibilitySet, userID pgtype.UUID, optin []string) (store.User, error) {
	allowed := vis.OptInSlugs()
	for _, slug := range optin {
		if !slices.Contains(allowed, slug) {
			return store.User{}, &ValidationError{Field: "optin", Msg: fmt.Sprintf("%q is not an opt-in visibility slug; allowed: %s", slug, strings.Join(allowed, ", "))}
		}
	}
	// Normalize to config order, deduplicated, never nil (Postgres text[]).
	clean := make([]string, 0, len(allowed))
	for _, slug := range allowed {
		if slices.Contains(optin, slug) {
			clean = append(clean, slug)
		}
	}
	u, err := db.UpdateUserVisibilityOptIn(ctx, store.UpdateUserVisibilityOptInParams{ID: userID, Optin: clean})
	if err != nil {
		return store.User{}, fmt.Errorf("update visibility opt-in: %w", err)
	}
	return u, nil
}
