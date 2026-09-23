package store

import (
	"context"
	"os"
	"testing"
)

// These are integration tests against a real Postgres (docs/04 §3). They are
// skipped unless DATABASE_URL points at a database with migrations applied —
// the local loop runs `goose up` first (see README). CI provides a Postgres 17
// service and sets DATABASE_URL.
func testDB(t *testing.T) *DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping Postgres integration test")
	}
	db, err := Open(context.Background(), url)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func TestPing(t *testing.T) {
	db := testDB(t)
	if err := db.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestCountCategories(t *testing.T) {
	db := testDB(t)
	// Proves the sqlc-generated query runs against the migrated schema. The
	// count itself is incidental (>= 0); the point is the round trip compiles
	// and executes.
	if _, err := db.CountCategories(context.Background()); err != nil {
		t.Fatalf("CountCategories: %v", err)
	}
}

func TestCountFavoritesByServiceAndRole(t *testing.T) {
	db := testDB(t)
	// The union of a cross join over an unnested role array with a grouped
	// count is more SQL than sqlc can prove executes, so run it. Every active
	// service must appear once per requested role even with no favorites at
	// all — that zero is the property #128 added and #148 keeps per role.
	rows, err := db.CountFavoritesByServiceAndRole(context.Background(), []string{"student", "staff"})
	if err != nil {
		t.Fatalf("CountFavoritesByServiceAndRole: %v", err)
	}
	seen := map[string]map[string]bool{}
	for _, r := range rows {
		if seen[r.Name] == nil {
			seen[r.Name] = map[string]bool{}
		}
		seen[r.Name][r.Role] = true
	}
	for name, roles := range seen {
		for _, role := range []string{"student", "staff"} {
			if !roles[role] {
				t.Errorf("service %q has no row for role %q", name, role)
			}
		}
	}
}

func TestCountActiveSessionsByRole(t *testing.T) {
	db := testDB(t)
	// Same union-over-unnest shape as the favorites query, so run it for the
	// same reason: sqlc cannot prove it executes. Every requested role must
	// come back even with no sessions at all — that zero is what keeps a role
	// reading 0 instead of vanishing from the dashboard (#232).
	rows, err := db.CountActiveSessionsByRole(context.Background(), []string{"student", "staff"})
	if err != nil {
		t.Fatalf("CountActiveSessionsByRole: %v", err)
	}
	seen := map[string]bool{}
	for _, r := range rows {
		seen[r.Role] = true
	}
	for _, role := range []string{"student", "staff"} {
		if !seen[role] {
			t.Errorf("no row for role %q", role)
		}
	}
}
