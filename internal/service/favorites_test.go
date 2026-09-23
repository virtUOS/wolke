package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
	"github.com/virtuos/wolke/internal/usage"
)

type fakeFav struct {
	byUsage, byAlpha, byManual []pgtype.UUID
	// active is what ListActiveFavoriteIDs reports; nil means "same as byUsage",
	// which is the normal case (every favorite resolves through the catalog).
	active    []pgtype.UUID
	seedCalls int
	markCalls int
	usedUsage bool
	// usageSince/manualSince record the window boundary each usage-derived
	// query was asked for (issue #159).
	usageSince      time.Time
	manualSince     time.Time
	usedAlpha       bool
	usedManual      bool
	manualSeedCalls int
	manualMarks     int
	orderWrites     [][]pgtype.UUID
	added           []store.AddFavoriteParams
	removeRows      int64
	removed         int
	// addRows is what AddFavorite reports as written; 0 stands for the
	// idempotent re-star that `on conflict do nothing` swallowed.
	addRows int64
}

// countingMetrics is a service.FavoriteMetrics that records what it was told,
// keyed by "service/role".
type countingMetrics struct{ added, removed map[string]int }

func newCountingMetrics() *countingMetrics {
	return &countingMetrics{added: map[string]int{}, removed: map[string]int{}}
}

func (c *countingMetrics) IncFavoriteAdded(service, role string) {
	c.added[service+"/"+role]++
}

func (c *countingMetrics) IncFavoriteRemoved(service, role string) {
	c.removed[service+"/"+role]++
}

func (c *countingMetrics) total(m map[string]int) int {
	n := 0
	for _, v := range m {
		n += v
	}
	return n
}

func (f *fakeFav) ListFavoritesByUsage(_ context.Context, arg store.ListFavoritesByUsageParams) ([]pgtype.UUID, error) {
	f.usedUsage = true
	f.usageSince = arg.Since.Time
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
func (f *fakeFav) SeedManualFavoritesOrder(_ context.Context, arg store.SeedManualFavoritesOrderParams) error {
	f.manualSeedCalls++
	f.manualSince = arg.Since.Time
	return nil
}
func (f *fakeFav) MarkFavoritesManualSeeded(context.Context, pgtype.UUID) error {
	f.manualMarks++
	return nil
}
func (f *fakeFav) NextFavoriteSort(context.Context, pgtype.UUID) (int32, error) {
	return int32(len(f.byUsage)), nil
}
func (f *fakeFav) AddFavorite(_ context.Context, arg store.AddFavoriteParams) (int64, error) {
	f.added = append(f.added, arg)
	return f.addRows, nil
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

// "Most used" has to mean a fixed, stated window — the same one "frequently
// used" uses — and not "everything raw click retention happens to still hold"
// (issue #159). Pinning the boundary here is what keeps the retention setting
// from silently reordering the list.
func TestListFavoritesByUsageAsksForTheFrequentWindow(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidVal()}}
	user := store.User{ID: uuidVal(), PrimaryRole: "student", FavoritesSeeded: true, FavoritesOrder: "usage"}
	before := time.Now()
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	want := before.Add(-usage.FrequentWindow)
	if d := f.usageSince.Sub(want); d < 0 || d > time.Minute {
		t.Errorf("usage window starts at %v, want ~%v (usage.FrequentWindow ago)", f.usageSince, want)
	}
}

// The manual-order seed mirrors the usage ranking (issue #125), so it has to
// be handed the same window or entering manual mode reintroduces the drift.
func TestListFavoritesManualSeedUsesTheSameWindow(t *testing.T) {
	f := &fakeFav{byManual: []pgtype.UUID{uuidN(1)}}
	user := store.User{
		ID: uuidVal(), PrimaryRole: "student",
		FavoritesSeeded: true, FavoritesOrder: "manual", FavoritesManualSeeded: false,
	}
	before := time.Now()
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	want := before.Add(-usage.FrequentWindow)
	if d := f.manualSince.Sub(want); d < 0 || d > time.Minute {
		t.Errorf("manual seed window starts at %v, want ~%v (usage.FrequentWindow ago)", f.manualSince, want)
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
	f := &fakeFav{byUsage: []pgtype.UUID{uuidVal(), uuidVal(), uuidVal()}, addRows: 1} // 3 existing → next sort 3
	if err := AddFavorite(context.Background(), f, nil, uuidVal(), uuidVal(), "MyShare", "student"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}
	if len(f.added) != 1 || f.added[0].Sort != 3 {
		t.Errorf("added = %+v, want one entry at sort 3", f.added)
	}
}

func TestRemoveFavoriteIsIdempotent(t *testing.T) {
	f := &fakeFav{removeRows: 0} // not present
	if err := RemoveFavorite(context.Background(), f, nil, uuidVal(), uuidVal(), "MyShare", "student"); err != nil {
		t.Fatalf("RemoveFavorite (absent) should be a no-op, got %v", err)
	}
	if f.removed != 1 {
		t.Errorf("RemoveFavorite called %d times, want 1", f.removed)
	}
}

// --- the toggle counters (issue #228) ----------------------------------------

func TestAddFavoriteCountsOnlyTheAdd(t *testing.T) {
	f := &fakeFav{addRows: 1}
	c := newCountingMetrics()
	if err := AddFavorite(context.Background(), f, c, uuidVal(), uuidVal(), "MyShare", "student"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}
	if c.added["MyShare/student"] != 1 {
		t.Errorf("added = %v, want one MyShare/student", c.added)
	}
	if c.total(c.removed) != 0 {
		t.Errorf("removed = %v, want nothing counted", c.removed)
	}
}

func TestRemoveFavoriteCountsOnlyTheRemove(t *testing.T) {
	f := &fakeFav{removeRows: 1}
	c := newCountingMetrics()
	if err := RemoveFavorite(context.Background(), f, c, uuidVal(), uuidVal(), "MyShare", "staff"); err != nil {
		t.Fatalf("RemoveFavorite: %v", err)
	}
	if c.removed["MyShare/staff"] != 1 {
		t.Errorf("removed = %v, want one MyShare/staff", c.removed)
	}
	if c.total(c.added) != 0 {
		t.Errorf("added = %v, want nothing counted", c.added)
	}
}

// TestSeedingFromRoleDefaultsCountsNeither is THE assertion behind the metric.
// The pre-fill at first login must never touch either counter: that placement,
// and nothing else, is what makes added_total minus removed_total the delta
// between what users chose and what the deployment pre-configured. If a future
// refactor moves the increment into the store or adds one to the seed path,
// the counter silently becomes "all favorites" — and this test is what catches
// it (issue #228).
func TestSeedingFromRoleDefaultsCountsNeither(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidVal(), uuidVal()}}
	c := newCountingMetrics()
	user := store.User{ID: uuidVal(), PrimaryRole: "student", FavoritesSeeded: false, FavoritesOrder: "usage"}

	// ListFavorites is the only path that seeds, and it takes no metrics at
	// all — which is the structural half of the guarantee. The counter below
	// is the behavioural half: nothing reached it.
	if _, err := ListFavorites(context.Background(), f, user); err != nil {
		t.Fatalf("ListFavorites: %v", err)
	}
	if f.seedCalls != 1 {
		t.Fatalf("seedCalls = %d, want the seed to have run", f.seedCalls)
	}
	if c.total(c.added) != 0 || c.total(c.removed) != 0 {
		t.Errorf("seeding counted added=%v removed=%v, want neither", c.added, c.removed)
	}
}

func TestRepeatedToggleCountsOnlyTheRealChange(t *testing.T) {
	c := newCountingMetrics()
	// on conflict do nothing / delete of an absent row: no state change.
	if err := AddFavorite(context.Background(), &fakeFav{addRows: 0}, c, uuidVal(), uuidVal(), "MyShare", "student"); err != nil {
		t.Fatalf("AddFavorite: %v", err)
	}
	if err := RemoveFavorite(context.Background(), &fakeFav{removeRows: 0}, c, uuidVal(), uuidVal(), "MyShare", "student"); err != nil {
		t.Fatalf("RemoveFavorite: %v", err)
	}
	if c.total(c.added) != 0 || c.total(c.removed) != 0 {
		t.Errorf("idempotent repeats counted added=%v removed=%v, want neither", c.added, c.removed)
	}
}

func TestToggleWithoutAResolvableNameCountsNothing(t *testing.T) {
	c := newCountingMetrics()
	if err := RemoveFavorite(context.Background(), &fakeFav{removeRows: 1}, c, uuidVal(), uuidVal(), "", "student"); err != nil {
		t.Fatalf("RemoveFavorite: %v", err)
	}
	if c.total(c.removed) != 0 {
		t.Errorf("removed = %v, want no series minted under an empty service name", c.removed)
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

// visibleAll is the "nothing is hidden from this reader" predicate the plain
// order tests use.
func visibleAll(pgtype.UUID) bool { return true }

func TestSetFavoritesOrderWritesThePermutationInOrder(t *testing.T) {
	f := &fakeFav{byUsage: []pgtype.UUID{uuidN(1), uuidN(2), uuidN(3)}}
	want := []pgtype.UUID{uuidN(3), uuidN(1), uuidN(2)}
	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), want, visibleAll); err != nil {
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
		if err := SetFavoritesOrder(context.Background(), f, uuidVal(), ids, visibleAll); err != nil {
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
	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), nil, visibleAll); err != nil {
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
			err := SetFavoritesOrder(context.Background(), f, uuidVal(), tt.sent, visibleAll)
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
	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), []pgtype.UUID{uuidN(2), uuidN(1)}, visibleAll); err != nil {
		t.Fatalf("SetFavoritesOrder: %v", err)
	}
	if len(f.orderWrites) != 1 {
		t.Fatalf("orderWrites = %d, want 1", len(f.orderWrites))
	}
}

// A favorite the *reader* can no longer see — a beta service after the pref
// went off, or one in a category whose group the IdP stopped granting — is
// exactly as absent from /api/favorites as a soft-deleted one, so the same two
// rules apply: it must not be required in the list, and it must not be written
// away. Without this the user is stuck — every reorder 400s, and they cannot
// un-star a tile that no longer renders (review finding 1).
func TestSetFavoritesOrderIgnoresInvisibleFavorites(t *testing.T) {
	hidden := uuidN(3)
	f := &fakeFav{byUsage: []pgtype.UUID{uuidN(1), uuidN(2), hidden}}
	visible := func(id pgtype.UUID) bool { return id != hidden }

	if err := SetFavoritesOrder(context.Background(), f, uuidVal(), []pgtype.UUID{uuidN(2), uuidN(1)}, visible); err != nil {
		t.Fatalf("SetFavoritesOrder: %v", err)
	}
	if len(f.orderWrites) != 1 {
		t.Fatalf("orderWrites = %d, want 1", len(f.orderWrites))
	}
	for _, id := range f.orderWrites[0] {
		if id == hidden {
			t.Fatalf("the invisible favorite was renumbered: %v", f.orderWrites[0])
		}
	}

	// And sending it anyway is still a non-permutation: the client cannot
	// smuggle an id it was never shown into the order.
	f2 := &fakeFav{byUsage: []pgtype.UUID{uuidN(1), uuidN(2), hidden}}
	err := SetFavoritesOrder(context.Background(), f2, uuidVal(), []pgtype.UUID{uuidN(2), uuidN(1), hidden}, visible)
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("err = %v, want ValidationError", err)
	}
	if len(f2.orderWrites) != 0 {
		t.Errorf("nothing may be written on a rejected order, got %v", f2.orderWrites)
	}
}
