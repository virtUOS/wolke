package catalog

import (
	"context"
	"os"
	"testing"

	"github.com/virtuos/wolke/internal/store"
)

// Integration test against a seeded Postgres (run: make db && make migrate &&
// make seed). Skipped without DATABASE_URL.
func TestLoadSnapshotFromSeededDB(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping catalog load integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	snap, err := Load(ctx, db)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(snap.Services) == 0 {
		t.Fatal("no services loaded (did you run `make seed`?)")
	}
	if len(snap.Categories) == 0 {
		t.Fatal("no categories loaded")
	}

	// Every active service should carry localized name + at least one category.
	for _, s := range snap.Services {
		if s.Name == "" {
			t.Errorf("service %s has empty name", s.ID)
		}
		if len(s.Categories) == 0 {
			t.Errorf("service %q has no categories", s.Name)
		}
	}

	// The doc-only seed entry must be flagged and have no service URL.
	var found bool
	for _, s := range snap.Services {
		if s.Name == "WLAN an der UOS" {
			found = true
			if !s.DocOnly {
				t.Error("WLAN entry should be DocOnly")
			}
			if s.ServiceURL != "" {
				t.Errorf("doc-only entry has service_url %q, want empty", s.ServiceURL)
			}
			if s.DocURL == "" {
				t.Error("doc-only entry should have a doc_url")
			}
		}
	}
	if !found {
		t.Error("expected the seeded doc-only entry 'WLAN an der UOS'")
	}

	// ServiceByID lookup works.
	first := snap.Services[0]
	if got, ok := snap.ServiceByID(first.ID); !ok || got.Name != first.Name {
		t.Errorf("ServiceByID(%s) failed", first.ID)
	}
}
