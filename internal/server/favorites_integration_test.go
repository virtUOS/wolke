package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/store"
)

// Integration: flat favorites with one-time role-default pre-fill, add/remove,
// and no re-seed. Needs a seeded DB; skipped without DATABASE_URL.
func TestFavoritesFlow(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping favorites integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'fav-api-test'")
		db.Close()
	})

	user, err := db.UpsertUser(ctx, store.UpsertUserParams{
		OidcSub: "fav-api-test", DisplayName: "Fav Tester", PrimaryRole: "student",
	})
	if err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	// Fresh user each request, as loadSession does — so the seeded flag is read
	// from the DB (the handler must not re-seed after the first list).
	current := func() store.User {
		u, err := db.GetUserByID(ctx, user.ID)
		if err != nil {
			t.Fatalf("get user: %v", err)
		}
		return u
	}

	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})
	call := func(h http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/favorites", strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, current()))
		rec := httptest.NewRecorder()
		h(rec, r)
		return rec
	}
	listIDs := func() []string {
		rec := call(listFavorites(cache, db), http.MethodGet, "")
		if rec.Code != http.StatusOK {
			t.Fatalf("list favorites = %d, want 200", rec.Code)
		}
		var body struct {
			Services []catalog.Service `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		out := make([]string, len(body.Services))
		for i, s := range body.Services {
			out[i] = s.ID
		}
		return out
	}

	// First list pre-fills from the student role defaults.
	defaults, err := db.GetRoleDefaults(ctx, "student")
	if err != nil || len(defaults) == 0 {
		t.Fatalf("expected seeded student role defaults: %v", err)
	}
	seeded := listIDs()
	if len(seeded) != len(defaults) {
		t.Fatalf("after pre-fill: %d favorites, want %d (the role defaults)", len(seeded), len(defaults))
	}

	// Remove one of the seeded favorites; it must not come back on the next list
	// (one-time seeding only).
	removed := seeded[0]
	if rec := call(removeFavorite(db), http.MethodDelete, `{"service_id":"`+removed+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204", rec.Code)
	}
	after := listIDs()
	if len(after) != len(seeded)-1 {
		t.Fatalf("after remove: %d favorites, want %d (no re-seed)", len(after), len(seeded)-1)
	}
	for _, id := range after {
		if id == removed {
			t.Fatalf("removed favorite %s came back — re-seeding occurred", removed)
		}
	}

	// Re-add it.
	if rec := call(addFavorite(db), http.MethodPost, `{"service_id":"`+removed+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("add = %d, want 204", rec.Code)
	}
	if len(listIDs()) != len(seeded) {
		t.Fatalf("after re-add: want %d favorites", len(seeded))
	}
}

// Integration: the manual order mode (issue #125) — the first list in manual
// mode seeds favorites.sort from the usage order, PUT /api/favorites/order
// rewrites it, GET reflects it, and switching away and back preserves it.
// Needs a seeded DB; skipped without DATABASE_URL.
func TestFavoritesManualOrderFlow(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping favorites manual-order integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'fav-order-test'")
		db.Close()
	})

	user, err := db.UpsertUser(ctx, store.UpsertUserParams{
		OidcSub: "fav-order-test", DisplayName: "Order Tester", PrimaryRole: "student",
	})
	if err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	current := func() store.User {
		u, err := db.GetUserByID(ctx, user.ID)
		if err != nil {
			t.Fatalf("get user: %v", err)
		}
		return u
	}
	setOrderPref := func(mode string) {
		u := current()
		if _, err := db.UpdateUserPrefs(ctx, store.UpdateUserPrefsParams{
			ID: u.ID, ViewMode: u.ViewMode, Theme: u.Theme, Locale: u.Locale,
			FavoritesOrder: mode, FavoritesSeparateTab: u.FavoritesSeparateTab,
		}); err != nil {
			t.Fatalf("set favorites_order = %s: %v", mode, err)
		}
	}

	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})
	call := func(h http.HandlerFunc, method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, current()))
		rec := httptest.NewRecorder()
		h(rec, r)
		return rec
	}
	listIDs := func() []string {
		rec := call(listFavorites(cache, db), http.MethodGet, "/api/favorites", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("list favorites = %d, want 200: %s", rec.Code, rec.Body)
		}
		var body struct {
			Services []catalog.Service `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		out := make([]string, len(body.Services))
		for i, s := range body.Services {
			out[i] = s.ID
		}
		return out
	}
	putOrder := func(ids []string) *httptest.ResponseRecorder {
		quoted := make([]string, len(ids))
		for i, id := range ids {
			quoted[i] = `"` + id + `"`
		}
		return call(setFavoritesOrder(db), http.MethodPut, "/api/favorites/order",
			`{"service_ids":[`+strings.Join(quoted, ",")+`]}`)
	}

	// The usage order the user effectively has (first list also pre-fills from
	// the role defaults).
	usage := listIDs()
	if len(usage) < 3 {
		t.Fatalf("need at least 3 seeded favorites to reorder, got %d", len(usage))
	}

	// First list in manual mode: sort is seeded from the usage order, so the
	// user starts from what they already saw rather than from insertion order.
	setOrderPref("manual")
	if got := listIDs(); !slices.Equal(got, usage) {
		t.Fatalf("first manual list = %v, want the usage order %v (seeding)", got, usage)
	}
	if !current().FavoritesManualSeeded {
		t.Error("favorites_manual_seeded should be true after the first manual list")
	}

	// Move the last favorite to the front — the "an den Anfang" action.
	moved := append([]string{usage[len(usage)-1]}, usage[:len(usage)-1]...)
	if rec := putOrder(moved); rec.Code != http.StatusNoContent {
		t.Fatalf("put order = %d, want 204: %s", rec.Code, rec.Body)
	}
	if got := listIDs(); !slices.Equal(got, moved) {
		t.Fatalf("manual list = %v, want %v", got, moved)
	}

	// Idempotent: the same list again changes nothing.
	if rec := putOrder(moved); rec.Code != http.StatusNoContent {
		t.Fatalf("repeat put order = %d, want 204: %s", rec.Code, rec.Body)
	}
	if got := listIDs(); !slices.Equal(got, moved) {
		t.Fatalf("after repeat put: %v, want %v", got, moved)
	}

	// usage/alpha stay computed and are never disturbed by the stored order;
	// coming back to manual finds the arrangement intact (no re-seed).
	setOrderPref("usage")
	if got := listIDs(); !slices.Equal(got, usage) {
		t.Fatalf("usage order = %v, want %v — the stored manual order leaked in", got, usage)
	}
	setOrderPref("alpha")
	alpha := listIDs()
	if len(alpha) != len(usage) {
		t.Fatalf("alpha order has %d entries, want %d", len(alpha), len(usage))
	}
	setOrderPref("manual")
	if got := listIDs(); !slices.Equal(got, moved) {
		t.Fatalf("back in manual: %v, want the arrangement %v", got, moved)
	}

	// A new favorite starred in manual mode appends at the end.
	all, err := db.ListActiveServices(ctx)
	if err != nil {
		t.Fatalf("list services: %v", err)
	}
	var extra string
	for _, s := range all {
		id := uuidString(s.ID)
		if !slices.Contains(moved, id) {
			extra = id
			break
		}
	}
	if extra == "" {
		t.Skip("every active service is already a favorite; nothing left to append")
	}
	if rec := call(addFavorite(db), http.MethodPost, "/api/favorites/items", `{"service_id":"`+extra+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("add = %d, want 204", rec.Code)
	}
	if got := listIDs(); !slices.Equal(got, append(append([]string{}, moved...), extra)) {
		t.Fatalf("after starring in manual mode: %v, want %v then %s", got, moved, extra)
	}

	// A list that is not a permutation of the caller's favorites is a 400, and
	// leaves the stored order alone.
	stored := listIDs()
	for _, bad := range [][]string{
		stored[:len(stored)-1],                                      // missing one
		append(append([]string{}, stored...), stored[0]),            // duplicate
		append(append([]string{}, stored[1:]...), user.ID.String()), // a foreign id
	} {
		if rec := putOrder(bad); rec.Code != http.StatusBadRequest {
			t.Errorf("put order %v = %d, want 400", bad, rec.Code)
		}
	}
	if got := listIDs(); !slices.Equal(got, stored) {
		t.Fatalf("a rejected order changed the stored one: %v, want %v", got, stored)
	}
}
