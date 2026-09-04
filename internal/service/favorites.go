package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// NotFoundError is a missing/!owned resource the HTTP layer maps to 404.
// (Kept for the admin write paths in later phases.)
type NotFoundError struct{ What string }

func (e *NotFoundError) Error() string { return e.What + " not found" }

// FavoritesStore is the persistence the favorites use case needs. Favorites are
// a flat per-user set — no named lists (docs/01 §4.4).
type FavoritesStore interface {
	ListFavoritesByUsage(ctx context.Context, userID pgtype.UUID) ([]pgtype.UUID, error)
	ListFavoritesAlpha(ctx context.Context, userID pgtype.UUID) ([]pgtype.UUID, error)
	ListFavoritesManual(ctx context.Context, userID pgtype.UUID) ([]pgtype.UUID, error)
	ListActiveFavoriteIDs(ctx context.Context, userID pgtype.UUID) ([]pgtype.UUID, error)
	SetFavoritesOrder(ctx context.Context, arg store.SetFavoritesOrderParams) (int64, error)
	SeedManualFavoritesOrder(ctx context.Context, userID pgtype.UUID) error
	MarkFavoritesManualSeeded(ctx context.Context, userID pgtype.UUID) error
	NextFavoriteSort(ctx context.Context, userID pgtype.UUID) (int32, error)
	AddFavorite(ctx context.Context, arg store.AddFavoriteParams) error
	RemoveFavorite(ctx context.Context, arg store.RemoveFavoriteParams) (int64, error)
	SeedFavoritesFromRoleDefaults(ctx context.Context, arg store.SeedFavoritesFromRoleDefaultsParams) error
	MarkFavoritesSeeded(ctx context.Context, userID pgtype.UUID) error
}

// FavoritesOrderManual is the order mode in which the user arranges favorites
// themselves; the arrangement lives in favorites.sort (issue #125).
const FavoritesOrderManual = "manual"

// ListFavorites returns the user's favorited service ids in the user's chosen
// order: by usage, alphabetically, or in the order they arranged themselves.
// On the user's first call it pre-fills favorites from their role defaults, as
// real editable entries, exactly once (concept §4.4).
func ListFavorites(ctx context.Context, db FavoritesStore, u store.User) ([]string, error) {
	if !u.FavoritesSeeded {
		if err := db.SeedFavoritesFromRoleDefaults(ctx, store.SeedFavoritesFromRoleDefaultsParams{
			UserID: u.ID, Role: u.PrimaryRole,
		}); err != nil {
			return nil, fmt.Errorf("seed favorites: %w", err)
		}
		if err := db.MarkFavoritesSeeded(ctx, u.ID); err != nil {
			return nil, fmt.Errorf("mark favorites seeded: %w", err)
		}
	}

	// Entering manual mode starts from the order the user effectively had, so
	// they adjust rather than re-derive it. Seeded lazily here, on the first
	// list in manual mode, for the same reason the role-default pre-fill above
	// is: it then covers every path into the mode, not just the prefs handler.
	// Guarded by its own flag, so alpha → manual later keeps the arrangement.
	if u.FavoritesOrder == FavoritesOrderManual && !u.FavoritesManualSeeded {
		if err := db.SeedManualFavoritesOrder(ctx, u.ID); err != nil {
			return nil, fmt.Errorf("seed manual favorites order: %w", err)
		}
		if err := db.MarkFavoritesManualSeeded(ctx, u.ID); err != nil {
			return nil, fmt.Errorf("mark manual favorites order seeded: %w", err)
		}
	}

	var (
		ids []pgtype.UUID
		err error
	)
	switch u.FavoritesOrder {
	case "alpha":
		ids, err = db.ListFavoritesAlpha(ctx, u.ID)
	case FavoritesOrderManual:
		ids, err = db.ListFavoritesManual(ctx, u.ID)
	default:
		ids, err = db.ListFavoritesByUsage(ctx, u.ID)
	}
	if err != nil {
		return nil, fmt.Errorf("list favorites: %w", err)
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, uuidStr(id))
	}
	return out, nil
}

// AddFavorite favorites a service (idempotent), appending it after existing ones.
func AddFavorite(ctx context.Context, db FavoritesStore, userID, serviceID pgtype.UUID) error {
	sort, err := db.NextFavoriteSort(ctx, userID)
	if err != nil {
		return fmt.Errorf("next favorite sort: %w", err)
	}
	if err := db.AddFavorite(ctx, store.AddFavoriteParams{UserID: userID, ServiceID: serviceID, Sort: sort}); err != nil {
		return fmt.Errorf("add favorite: %w", err)
	}
	return nil
}

// RemoveFavorite un-favorites a service (idempotent — a no-op if absent).
func RemoveFavorite(ctx context.Context, db FavoritesStore, userID, serviceID pgtype.UUID) error {
	if _, err := db.RemoveFavorite(ctx, store.RemoveFavoriteParams{UserID: userID, ServiceID: serviceID}); err != nil {
		return fmt.Errorf("remove favorite: %w", err)
	}
	return nil
}

// SetFavoritesOrder replaces the user's manual favorites order with the given
// whole list. It is idempotent, and validated here — not in the handler — so
// the rule holds for any caller (CLAUDE.md rule 3): the list must be a
// permutation of exactly the favorites the API exposes to this user, with no
// duplicates. Anything else is a client that is out of sync, and renumbering a
// partial list would silently collapse the order it didn't send.
//
// The reference set is the user's *active* favorites: /api/favorites resolves
// ids through the catalog snapshot, so a favorite whose service was
// soft-deleted is not in the list the UI has to send back. Such a row keeps its
// stored sort and slots back in where it was if the service returns.
func SetFavoritesOrder(ctx context.Context, db FavoritesStore, userID pgtype.UUID, serviceIDs []pgtype.UUID) error {
	seen := make(map[pgtype.UUID]bool, len(serviceIDs))
	for _, id := range serviceIDs {
		if seen[id] {
			return &ValidationError{Field: "service_ids", Msg: "must not list a service twice"}
		}
		seen[id] = true
	}

	current, err := db.ListActiveFavoriteIDs(ctx, userID)
	if err != nil {
		return fmt.Errorf("list favorite ids: %w", err)
	}
	if len(current) != len(seen) {
		return &ValidationError{Field: "service_ids", Msg: "must list exactly your current favorites"}
	}
	for _, id := range current {
		if !seen[id] {
			return &ValidationError{Field: "service_ids", Msg: "must list exactly your current favorites"}
		}
	}

	if len(serviceIDs) == 0 {
		return nil
	}
	if _, err := db.SetFavoritesOrder(ctx, store.SetFavoritesOrderParams{
		UserID: userID, ServiceIds: serviceIDs,
	}); err != nil {
		return fmt.Errorf("set favorites order: %w", err)
	}
	return nil
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
