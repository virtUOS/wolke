package service

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
)

type fakeFav struct {
	ids        []pgtype.UUID
	added      []store.AddFavoriteParams
	removeRows int64
	removed    int
}

func (f *fakeFav) ListFavoriteServiceIDs(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	return f.ids, nil
}
func (f *fakeFav) NextFavoriteSort(context.Context, pgtype.UUID) (int32, error) {
	return int32(len(f.ids)), nil
}
func (f *fakeFav) AddFavorite(_ context.Context, arg store.AddFavoriteParams) error {
	f.added = append(f.added, arg)
	return nil
}
func (f *fakeFav) RemoveFavorite(context.Context, store.RemoveFavoriteParams) (int64, error) {
	f.removed++
	return f.removeRows, nil
}

func uuidVal() pgtype.UUID { return pgtype.UUID{Valid: true} }

func TestListFavoritesMapsIDs(t *testing.T) {
	f := &fakeFav{ids: []pgtype.UUID{uuidVal(), uuidVal()}}
	got, err := ListFavorites(context.Background(), f, uuidVal())
	if err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("got %d favorites, want 2", len(got))
	}
}

func TestAddFavoriteAppendsAtNextSort(t *testing.T) {
	f := &fakeFav{ids: []pgtype.UUID{uuidVal(), uuidVal(), uuidVal()}} // 3 existing → next sort 3
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
