package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

type fakeFav struct {
	byUsage, byAlpha, byManual []pgtype.UUID
	// active is what ListActiveFavoriteIDs reports; nil means "same as byUsage",
	// which is the normal case (every favorite resolves through the catalog).
	active          []pgtype.UUID
	seedCalls       int
	markCalls       int
	usedUsage       bool
	usedAlpha       bool
	usedManual      bool
	manualSeedCalls int
	manualMarks     int
	orderWrites     [][]pgtype.UUID
	added           []store.AddFavoriteParams
	removeRows      int64
	removed         int
}

func (f *fakeFav) ListFavoritesByUsage(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	f.usedUsage = true
	return f.byUsage, nil
}
func (f *fakeFav) ListFavoritesAlpha(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	f.usedAlpha = true
	return f.byAlpha, nil
}
func (f *fakeFav) ListFavoritesManual(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	f.usedManual = true
	return f.byManual, nil
}
func (f *fakeFav) ListActiveFavoriteIDs(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	if f.active != nil {
		return f.active, nil
	}
	return f.byUsage, nil
}
func (f *fakeFav) SetFavoritesOrder(_ context.Context, arg store.SetFavoritesOrderParams) (int64, error) {
	f.orderWrites = append(f.orderWrites, arg.ServiceIds)
	return int64(len(arg.ServiceIds)), nil
}
func (f *fakeFav) SeedManualFavoritesOrder(context.Context, pgtype.UUID) error {
	f.manualSeedCalls++
	return nil
}
func (f *fakeFav) MarkFavoritesManualSeeded(context.Context, pgtype.UUID) error {
	f.manualMarks++
	return nil
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

// uuidN is a distinguishable uuid — the permutation rules are about *which* ids
// were sent, so the order tests need ids that aren't all equal.
func uuidN(n byte) pgtype.UUID {
	var u pgtype.UUID
	u.Valid = true
	u.Bytes[15] = n
	return u
}

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

// --- manual order (issue #125) -----------------------------------------------

func TestListFavoritesManualSeedsSortFromUsageOnce(t *testing.T) {
	f := &fakeFav{byManual: []pgtype.UUID{uuidN(1), uuidN(2)}}
	user := store.User{
		ID: uuidVal(), PrimaryRole: "student",
		FavoritesSeeded: true, FavoritesOrder: "manual", FavoritesManualSeeded: false,
	}
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	if f.manualSeedCalls != 1 || f.manualMarks != 1 {
		t.Errorf("sort seed/mark = %d/%d, want 1/1 on the first list in manual mode", f.manualSeedCalls, f.manualMarks)
	}
	if !f.usedManual || f.usedUsage || f.usedAlpha {
		t.Errorf("manual order should query the stored order (manual=%v usage=%v alpha=%v)", f.usedManual, f.usedUsage, f.usedAlpha)
	}
}

// Switching to alpha and back must never renumber what the user arranged.
func TestListFavoritesManualDoesNotReseedSort(t *testing.T) {
	f := &fakeFav{byManual: []pgtype.UUID{uuidN(1)}}
	user := store.User{
		ID: uuidVal(), PrimaryRole: "student",
		FavoritesSeeded: true, FavoritesOrder: "manual", FavoritesManualSeeded: true,
	}
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	if f.manualSeedCalls != 0 || f.manualMarks != 0 {
		t.Errorf("sort seed/mark = %d/%d, want 0/0 once the manual order exists", f.manualSeedCalls, f.manualMarks)
	}
}

// The stored manual order is only *read* in manual mode: usage and alpha stay
// computed, and neither may trigger the seeding.
func TestListFavoritesUsageAndAlphaIgnoreStoredOrder(t *testing.T) {
	for _, mode := range []string{"usage", "alpha"} {
		t.Run(mode, func(t *testing.T) {
			f := &fakeFav{byUsage: []pgtype.UUID{uuidN(1)}, byAlpha: []pgtype.UUID{uuidN(1)}, byManual: []pgtype.UUID{uuidN(9)}}
			user := store.User{ID: uuidVal(), PrimaryRole: "student", FavoritesSeeded: true, FavoritesOrder: mode}
			if _, err := ListFavorites(context.Background(), f, user); err != nil {
				t.Fatalf("ListFavorites: %v", err)
			}
			if f.usedManual {
				t.Error("the stored manual order must not be read outside manual mode")
			}
			if f.manualSeedCalls != 0 {
				t.Errorf("manualSeedCalls = %d, want 0 outside manual mode", f.manualSeedCalls)
			}
		})
	}
}

func TestSetFavoritesOrderWritesThePermutationInOrder(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidN(1), uuidN(2), uuidN(3)}}
	want := []pgtype.UUID{uuidN(3), uuidN(1), uuidN(2)}
	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), want); err != nil {
		t.Fatalf("SetFavoritesOrder: %v", err)
	}
	if len(f.orderWrites) != 1 {
		t.Fatalf("orderWrites = %d, want 1", len(f.orderWrites))
	}
	for i, id := range f.orderWrites[0] {
		if id != want[i] {
			t.Fatalf("written order = %v, want %v", f.orderWrites[0], want)
		}
	}
}

// Idempotent: writing the same order twice is two identical, accepted writes.
func TestSetFavoritesOrderIsIdempotent(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidN(1), uuidN(2)}}
	ids := []pgtype.UUID{uuidN(2), uuidN(1)}
	for i := 0; i < 2; i++ {
		if err := SetFavoritesOrder(context.Background(), f, uuidVal(), ids); err != nil {
			t.Fatalf("write %d: %v", i+1, err)
		}
	}
	if len(f.orderWrites) != 2 {
		t.Fatalf("orderWrites = %d, want 2", len(f.orderWrites))
	}
}

// A user with no favorites can send the empty list; it writes nothing and is
// not an error (the UI does this when the last favorite is un-starred).
func TestSetFavoritesOrderAcceptsEmptyList(t *testing.T) {
	f := &fakeFav{byUsage: nil}
	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), nil); err != nil {
		t.Fatalf("SetFavoritesOrder(empty): %v", err)
	}
}

func TestSetFavoritesOrderRejectsNonPermutations(t *testing.T) {
	tests := []struct {
		name    string
		current []pgtype.UUID
		sent    []pgtype.UUID
	}{
		{"a foreign id — not this user's favorite", []pgtype.UUID{uuidN(1), uuidN(2)}, []pgtype.UUID{uuidN(1), uuidN(7)}},
		{"a missing id — the list is not the whole set", []pgtype.UUID{uuidN(1), uuidN(2), uuidN(3)}, []pgtype.UUID{uuidN(1), uuidN(2)}},
		{"a duplicate id", []pgtype.UUID{uuidN(1), uuidN(2)}, []pgtype.UUID{uuidN(1), uuidN(1)}},
		{"extra ids on top of the set", []pgtype.UUID{uuidN(1)}, []pgtype.UUID{uuidN(1), uuidN(2)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeFav{byUsage: tt.current}
			err := SetFavoritesOrder(context.Background(), f, uuidVal(), tt.sent)
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want ValidationError", err)
			}
			if ve.Field != "service_ids" {
				t.Errorf("field = %q, want service_ids", ve.Field)
			}
			if len(f.orderWrites) != 0 {
				t.Errorf("nothing may be written on a rejected order, got %v", f.orderWrites)
			}
		})
	}
}

// A favorite whose service was soft-deleted is not in /api/favorites, so the
// list the UI sends back cannot contain it — and must still be accepted.
func TestSetFavoritesOrderIgnoresSoftDeletedFavorites(t *testing.T) {
	f := &fakeFav{
		byUsage: []pgtype.UUID{uuidN(1), uuidN(2), uuidN(3)}, // #3's service is gone
		active:  []pgtype.UUID{uuidN(1), uuidN(2)},
	}
	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), []pgtype.UUID{uuidN(2), uuidN(1)}); err != nil {
		t.Fatalf("SetFavoritesOrder: %v", err)
	}
	if len(f.orderWrites) != 1 {
		t.Fatalf("orderWrites = %d, want 1", len(f.orderWrites))
	}
}
