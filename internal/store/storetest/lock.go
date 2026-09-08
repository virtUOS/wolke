// Package storetest holds test-only helpers shared by the integration tests
// that run against the one local development database.
package storetest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// categorySetKey is the advisory-lock key guarding the shared category set.
// Arbitrary, but stable: every caller has to name the same number.
const categorySetKey = 130130

// LockCategorySet serializes tests that mutate the shared category set, and
// releases the lock when the test ends.
//
// `go test ./...` runs packages in parallel against one database, and the
// category order is a whole-list write validated as a permutation of what
// currently exists (issue #130) — so a category another package creates or
// deletes mid-test makes an otherwise correct reorder both fail to write and
// fail to assert. A Postgres session advisory lock is the smallest fix that
// keeps the tests honest about the real whole-list contract instead of weakening
// the assertion.
//
// Call it *after* registering the cleanup that closes the pool: cleanups run
// LIFO, so this one has to release its connection before Close waits for it.
func LockCategorySet(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire connection for the category lock: %v", err)
	}
	if _, err := conn.Exec(ctx, "select pg_advisory_lock($1)", categorySetKey); err != nil {
		conn.Release()
		t.Fatalf("take the category lock: %v", err)
	}
	t.Cleanup(func() {
		if _, err := conn.Exec(ctx, "select pg_advisory_unlock($1)", categorySetKey); err != nil {
			t.Errorf("release the category lock: %v", err)
		}
		conn.Release()
	})
}
