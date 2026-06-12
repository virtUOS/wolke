package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
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
	NextFavoriteSort(ctx context.Context, userID pgtype.UUID) (int32, error)
	AddFavorite(ctx context.Context, arg store.AddFavoriteParams) error
	RemoveFavorite(ctx context.Context, arg store.RemoveFavoriteParams) (int64, error)
	SeedFavoritesFromRoleDefaults(ctx context.Context, arg store.SeedFavoritesFromRoleDefaultsParams) error
	MarkFavoritesSeeded(ctx context.Context, userID pgtype.UUID) error
}

// ListFavorites returns the user's favorited service ids in the user's chosen
// order (by usage or alphabetically). On the user's first call it pre-fills
// favorites from their role defaults, as real editable entries, exactly once
// (concept §4.4).
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

	var (
		ids []pgtype.UUID
		err error
	)
	if u.FavoritesOrder == "alpha" {
		ids, err = db.ListFavoritesAlpha(ctx, u.ID)
	} else {
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

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
