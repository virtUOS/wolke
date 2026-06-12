package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/virtUOS/service-hub/internal/catalog"
	"github.com/virtUOS/service-hub/internal/store"
)

// Integration: search against the seeded DB (make db && make migrate && make seed).
func TestSearch(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping search integration test")
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
	h := search(cache, db)

	names := func(q string) []string {
		req := httptest.NewRequest(http.MethodGet, "/api/search?q="+q, nil)
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
	// Empty query returns no services.
	if got := names(""); len(got) != 0 {
		t.Errorf("empty query returned %v, want none", got)
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
