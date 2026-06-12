package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/virtUOS/service-hub/internal/catalog"
	"github.com/virtUOS/service-hub/internal/store"
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
