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

// Integration: flat favorites (add/list/remove) against a seeded DB
// (make db && make migrate && make seed). Skipped without DATABASE_URL.
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
	svcs, err := db.ListActiveServices(ctx)
	if err != nil || len(svcs) == 0 {
		t.Fatalf("need seeded services: %v", err)
	}
	serviceID := uuidString(svcs[0].ID)
	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})

	call := func(h http.HandlerFunc, method, target, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, user))
		rec := httptest.NewRecorder()
		h(rec, r)
		return rec
	}
	favoriteNames := func() []string {
		rec := call(listFavorites(cache, db), http.MethodGet, "/api/favorites", "")
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

	// Initially empty.
	if got := favoriteNames(); len(got) != 0 {
		t.Fatalf("favorites start = %v, want empty", got)
	}

	// Add (idempotent: adding twice keeps one).
	for i := 0; i < 2; i++ {
		if rec := call(addFavorite(db), http.MethodPost, "/api/favorites/items", `{"service_id":"`+serviceID+`"}`); rec.Code != http.StatusNoContent {
			t.Fatalf("add favorite = %d, want 204", rec.Code)
		}
	}
	if got := favoriteNames(); len(got) != 1 || got[0] != serviceID {
		t.Fatalf("after add: %v, want exactly the one service", got)
	}

	// Remove (idempotent).
	if rec := call(removeFavorite(db), http.MethodDelete, "/api/favorites/items", `{"service_id":"`+serviceID+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("remove favorite = %d, want 204", rec.Code)
	}
	if got := favoriteNames(); len(got) != 0 {
		t.Fatalf("after remove: %v, want empty", got)
	}
}
