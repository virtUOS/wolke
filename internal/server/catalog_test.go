package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/store"
)

// withUser returns a request carrying an authenticated user in context, as
// loadSession would, so handlers can be exercised without the auth middleware.
func withUser(req *http.Request, role string) *http.Request {
	return req.WithContext(context.WithValue(req.Context(), userCtxKey{}, store.User{PrimaryRole: role}))
}

func TestCatalogListServesSnapshot(t *testing.T) {
	snap := &catalog.Snapshot{
		Services: []catalog.Service{
			{ID: "a", Name: "Alpha", Categories: []string{"learning"}},
			{ID: "b", Name: "Beta", Categories: []string{"data"}, DocOnly: true},
		},
		Categories: []catalog.Category{{Slug: "learning", Sort: 10}, {Slug: "data", Sort: 20}},
	}
	cache := catalog.NewCache(time.Minute, func(context.Context) (*catalog.Snapshot, error) { return snap, nil })

	rec := httptest.NewRecorder()
	catalogList(cache)(rec, httptest.NewRequest(http.MethodGet, "/api/catalog", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Services   []catalog.Service  `json:"services"`
		Categories []catalog.Category `json:"categories"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Services) != 2 || len(body.Categories) != 2 {
		t.Fatalf("got %d services / %d categories, want 2/2", len(body.Services), len(body.Categories))
	}
}

// Integration: the role-default view resolves the admin-curated order to live
// services. Needs a seeded DB (make db && make migrate && make seed).
func TestCatalogDefaultsForStudent(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping defaults integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})

	req := withUser(httptest.NewRequest(http.MethodGet, "/api/catalog/defaults", nil), "student")
	rec := httptest.NewRecorder()
	catalogDefaults(cache, db)(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Role     string            `json:"role"`
		Services []catalog.Service `json:"services"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Role != "student" {
		t.Errorf("role = %q, want student", body.Role)
	}
	if len(body.Services) == 0 {
		t.Fatal("no default services for student (did you run make seed?)")
	}
	// Every returned default must be a real, active catalog service.
	for _, s := range body.Services {
		if s.ID == "" || s.Name == "" {
			t.Errorf("default service not resolved: %+v", s)
		}
	}
}
