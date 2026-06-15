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

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/store"
)

// Integration: recording clicks feeds "frequently used" (docs/01 §4.5).
// Needs a seeded DB; skipped without DATABASE_URL.
func TestClickThenFrequent(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping usage integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'usage-test'")
		db.Close()
	})

	user, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "usage-test", DisplayName: "Usage", PrimaryRole: "student"})
	if err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	svcs, err := db.ListActiveServices(ctx)
	if err != nil || len(svcs) < 2 {
		t.Fatalf("need >=2 seeded services: %v", err)
	}
	top := uuidString(svcs[0].ID)
	other := uuidString(svcs[1].ID)

	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})

	post := func(target, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, target, strings.NewReader(body))
		r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, user))
		rec := httptest.NewRecorder()
		recordClick(db, cache, nil)(rec, r)
		return rec
	}

	// `top` clicked 3×, `other` once → top should rank first.
	for i := 0; i < 3; i++ {
		if rec := post("/api/events/click", `{"service_id":"`+top+`"}`); rec.Code != http.StatusNoContent {
			t.Fatalf("record click = %d, want 204", rec.Code)
		}
	}
	if rec := post("/api/events/click", `{"service_id":"`+other+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("record click = %d, want 204", rec.Code)
	}

	r := httptest.NewRequest(http.MethodGet, "/api/usage/frequent", nil)
	r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, user))
	rec := httptest.NewRecorder()
	frequent(cache, db)(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("frequent = %d, want 200", rec.Code)
	}
	var body struct {
		Services []catalog.Service `json:"services"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Services) < 2 {
		t.Fatalf("frequent returned %d services, want >=2", len(body.Services))
	}
	if body.Services[0].ID != top {
		t.Errorf("top frequent = %s, want the 3×-clicked service %s", body.Services[0].ID, top)
	}
}
