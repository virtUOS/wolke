package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

func TestNormalizeSearchQuery(t *testing.T) {
	cases := map[string]string{
		"  Video  Conference ": "video conference",
		"BBB":                  "bbb",
		"":                     "",
		"\t  ":                 "",
	}
	for in, want := range cases {
		if got := normalizeSearchQuery(in); got != want {
			t.Errorf("normalizeSearchQuery(%q) = %q, want %q", in, got, want)
		}
	}
}

// Integration: a search that finds nothing is logged and surfaces in the admin
// zero-result insights; a search that finds something does not. Needs a seeded
// DB (make db && make migrate && make seed).
func TestSearchInsightsZeroResults(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set; skipping search insights integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, dbURL)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	const miss = "zzq integration miss"
	norm := normalizeSearchQuery(miss)
	_, _ = db.Pool.Exec(ctx, "delete from search_events where query_norm = $1", norm)
	t.Cleanup(func() { _, _ = db.Pool.Exec(ctx, "delete from search_events where query_norm = $1", norm) })

	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})
	h := search(cache, db)

	count := func(q string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/search?q="+url.QueryEscape(q), nil)
		rec := httptest.NewRecorder()
		h(rec, req)
		var body struct {
			Services []catalog.Service `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode search: %v", err)
		}
		return len(body.Services)
	}

	if n := count(miss); n != 0 {
		t.Fatalf("expected 0 results for %q, got %d", miss, n)
	}
	if n := count(miss); n != 0 {
		t.Fatalf("expected 0 results (2nd) for %q, got %d", miss, n)
	}
	if n := count("stud"); n == 0 {
		t.Fatal("expected results for 'stud' (Stud.IP)")
	}

	ih := adminSearchInsights(AdminDeps{Store: db})
	req := httptest.NewRequest(http.MethodGet, "/api/admin/search-insights?days=1&limit=200", nil)
	rec := httptest.NewRecorder()
	ih(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("insights status = %d, want 200", rec.Code)
	}
	var resp struct {
		Entries []service.SearchInsight `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode insights: %v", err)
	}
	var got *service.SearchInsight
	for i, e := range resp.Entries {
		if e.Query == norm {
			got = &resp.Entries[i]
		}
		if e.Query == "stud" {
			t.Error("'stud' returns results but appears in the zero-result insights")
		}
	}
	if got == nil {
		t.Fatalf("zero-result query %q missing from insights: %+v", norm, resp.Entries)
	}
	if got.Searches < 2 {
		t.Errorf("searches for %q = %d, want >= 2", norm, got.Searches)
	}
}
