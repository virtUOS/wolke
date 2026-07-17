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
	"github.com/virtuos/wolke/internal/store"
)

// Integration: search against the seeded DB (make db && make migrate && make seed).
func TestSearch(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set; skipping search integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, dbURL)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()
	cache := catalog.NewCache(time.Minute, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})
	h := search(cache, db)

	names := func(q string) []string {
		req := httptest.NewRequest(http.MethodGet, "/api/search?q="+url.QueryEscape(q), nil)
		rec := httptest.NewRecorder()
		h(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("q=%q status = %d, want 200", q, rec.Code)
		}
		var body struct {
			Query    string            `json:"query"`
			Services []catalog.Service `json:"services"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		out := make([]string, len(body.Services))
		for i, s := range body.Services {
			out[i] = s.Name
		}
		return out
	}

	if got := names("stud"); !contains(got, "Stud.IP") {
		t.Errorf("search 'stud' = %v, want to include Stud.IP", got)
	}
	if got := names("WLAN"); !contains(got, "WLAN an der UOS") {
		t.Errorf("search 'WLAN' = %v, want to include the doc-only WLAN entry", got)
	}
	// Match via description text ("Netzspeicher" is in MyShare's German description).
	if got := names("Netzspeicher"); !contains(got, "MyShare") {
		t.Errorf("search 'Netzspeicher' = %v, want to include MyShare (description match)", got)
	}
	// Match via category label ("Lehre" is the teaching category's German label).
	if got := names("Lehre"); !contains(got, "Stud.IP") {
		t.Errorf("search 'Lehre' = %v, want services in the teaching category", got)
	}
	// Keyword enrichment: "video conference" appears in neither BigBlueButton's
	// name nor its description, only its admin-configured keywords (dev/seed.sql).
	if got := names("video conference"); !contains(got, "BigBlueButton") {
		t.Errorf("search 'video conference' = %v, want to include BigBlueButton (keyword match)", got)
	}
	// Abbreviation keyword.
	if got := names("bbb"); !contains(got, "BigBlueButton") {
		t.Errorf("search 'bbb' = %v, want to include BigBlueButton (keyword match)", got)
	}
	// Empty query returns no services.
	if got := names(""); len(got) != 0 {
		t.Errorf("empty query returned %v, want none", got)
	}
	// LIKE metacharacters are escaped: '%' is matched literally, not as a
	// wildcard, so it returns nothing rather than every service.
	if got := names("%"); len(got) != 0 {
		t.Errorf("search '%%' returned %v, want none (wildcard must be escaped)", got)
	}
	if got := names("_"); len(got) != 0 {
		t.Errorf("search '_' returned %v, want none (wildcard must be escaped)", got)
	}
}

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
