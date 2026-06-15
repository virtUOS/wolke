package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// ValidationError is a business-rule violation the HTTP/MCP layers map to a 400.
type ValidationError struct {
	Field string
	Msg   string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Msg)
}

// PrefsStore is the persistence the prefs use case needs.
type PrefsStore interface {
	UpdateUserPrefs(ctx context.Context, arg store.UpdateUserPrefsParams) (store.User, error)
}

// Prefs are the user-controlled display preferences. All fields are required
// here; the caller fills any unspecified field with the user's current value.
type Prefs struct {
	Theme                string
	ViewMode             string
	FavoritesOrder       string
	FavoritesSeparateTab bool
}

var (
	validThemes          = map[string]bool{"light": true, "dark": true, "system": true}
	validViewModes       = map[string]bool{"list": true, "table": true, "auto": true}
	validFavoritesOrders = map[string]bool{"usage": true, "alpha": true}
)

// UpdatePrefs validates and persists a user's display preferences. Validation
// lives here (not in the handler) so any future caller — e.g. MCP — enforces the
// same rules (CLAUDE.md rule 3, docs/02 §10).
func UpdatePrefs(ctx context.Context, db PrefsStore, userID pgtype.UUID, p Prefs) (store.User, error) {
	if !validThemes[p.Theme] {
		return store.User{}, &ValidationError{Field: "theme", Msg: "must be one of light, dark, system"}
	}
	if !validViewModes[p.ViewMode] {
		return store.User{}, &ValidationError{Field: "view_mode", Msg: "must be one of list, table, auto"}
	}
	if !validFavoritesOrders[p.FavoritesOrder] {
		return store.User{}, &ValidationError{Field: "favorites_order", Msg: "must be one of usage, alpha"}
	}
	return db.UpdateUserPrefs(ctx, store.UpdateUserPrefsParams{
		ID:                   userID,
		ViewMode:             p.ViewMode,
		Theme:                p.Theme,
		FavoritesOrder:       p.FavoritesOrder,
		FavoritesSeparateTab: p.FavoritesSeparateTab,
	})
}
