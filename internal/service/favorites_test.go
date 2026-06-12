package service

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
)

type fakeFav struct {
	byUsage, byAlpha []pgtype.UUID
	seedCalls        int
	markCalls        int
	usedUsage        bool
	usedAlpha        bool
	added            []store.AddFavoriteParams
	removeRows       int64
	removed          int
}

func (f *fakeFav) ListFavoritesByUsage(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	f.usedUsage = true
	return f.byUsage, nil
}
func (f *fakeFav) ListFavoritesAlpha(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	f.usedAlpha = true
	return f.byAlpha, nil
}
func (f *fakeFav) NextFavoriteSort(context.Context, pgtype.UUID) (int32, error) {
	return int32(len(f.byUsage)), nil
}
func (f *fakeFav) AddFavorite(_ context.Context, arg store.AddFavoriteParams) error {
	f.added = append(f.added, arg)
	return nil
}
func (f *fakeFav) RemoveFavorite(context.Context, store.RemoveFavoriteParams) (int64, error) {
	f.removed++
	return f.removeRows, nil
}
func (f *fakeFav) SeedFavoritesFromRoleDefaults(context.Context, store.SeedFavoritesFromRoleDefaultsParams) error {
	f.seedCalls++
	return nil
}
func (f *fakeFav) MarkFavoritesSeeded(context.Context, pgtype.UUID) error {
	f.markCalls++
	return nil
}

func uuidVal() pgtype.UUID { return pgtype.UUID{Valid: true} }

func TestListFavoritesSeedsOnceThenOrdersByUsage(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidVal()}}
	user := store.User{ID: uuidVal(), PrimaryRole: "student", FavoritesSeeded: false, FavoritesOrder: "usage"}
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	if f.seedCalls != 1 || f.markCalls != 1 {
		t.Errorf("seed/mark calls = %d/%d, want 1/1 on first (unseeded) list", f.seedCalls, f.markCalls)
	}
	if !f.usedUsage || f.usedAlpha {
		t.Errorf("usage order should query by usage (usage=%v alpha=%v)", f.usedUsage, f.usedAlpha)
	}
}

func TestListFavoritesNoReseedAndAlphaOrder(t *testing.T) {
	f := &fakeFav{byAlpha: []pgtype.UUID{uuidVal()}}
	user := store.User{ID: uuidVal(), PrimaryRole: "student", FavoritesSeeded: true, FavoritesOrder: "alpha"}
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	if f.seedCalls != 0 {
		t.Errorf("seedCalls = %d, want 0 when already seeded", f.seedCalls)
	}
	if !f.usedAlpha || f.usedUsage {
		t.Errorf("alpha order should query alphabetically (usage=%v alpha=%v)", f.usedUsage, f.usedAlpha)
	}
}

func TestAddFavoriteAppendsAtNextSort(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidVal(), uuidVal(), uuidVal()}} // 3 existing → next sort 3
	if err := AddFavorite(context.Background(), f, uuidVal(), uuidVal()); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}
	if len(f.added) != 1 || f.added[0].Sort != 3 {
		t.Errorf("added = %+v, want one entry at sort 3", f.added)
	}
}

func TestRemoveFavoriteIsIdempotent(t *testing.T) {
	f := &fakeFav{removeRows: 0} // not present
	if err := RemoveFavorite(context.Background(), f, uuidVal(), uuidVal()); err != nil {
		t.Fatalf("RemoveFavorite (absent) should be a no-op, got %v", err)
	}
	if f.removed != 1 {
		t.Errorf("RemoveFavorite called %d times, want 1", f.removed)
	}
}
