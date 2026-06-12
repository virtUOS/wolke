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
