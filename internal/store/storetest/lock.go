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
// Cleanup ordering matters in both directions, and `t.Cleanup` runs LIFO — so
// register, in this order:
//
//  1. the pool close (runs last: the lock's connection must go back first),
//  2. this lock,
//  3. every cleanup that deletes or rewrites category rows (runs first).
//
// Putting the category cleanup *before* this call inverts step 3: the lock is
// released while the rows it protects still exist, and the next test to take
// the lock can read a category that is about to be deleted out from under it
// (issue #142). Category-mutating cleanup has to run while the lock is held.
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

// announcementsKey is the advisory-lock key guarding the announcements table.
// Arbitrary, but stable: every caller has to name the same number.
const announcementsKey = 234234

// ClaimAnnouncements gives the calling test the announcements table to itself:
// it takes an advisory lock, empties the table under it, and releases the lock
// when the test ends.
//
// It empties the table on purpose, and that is the part worth understanding
// before reaching for it. A lock alone is what LockCategorySet does, and it is
// not enough here. A lock serializes tests that run at the same time; it says
// nothing about a row that was already sitting there when the run started — a
// notice inserted by hand to populate a Grafana panel, or residue from a run
// that crashed before its cleanup. The announcements tests assert through
// announce.ListActive and announce.ListHistory, and those read the whole table
// because reading the whole table *is* the contract under test: retire-on-create
// means "at most one active announcement" is an invariant of the table, not of
// any one row, so no amount of marker-scoping can express it (issue #234).
// announce.Purge is the same shape from the other end — it returns a global
// delete count, so one stray expired notice changes the number.
//
// So a stray announcement does not merely make these tests fail. It makes them
// fail *and* destroys the row: retire-on-create sets its ends_at, and Purge
// deletes it outright. Emptying the table first is therefore not a new cost —
// the rows were already forfeit. What changes is that the loss is now
// deliberate, documented, and does not come with a red test.
//
// Consequently: if you are keeping an announcement in the development database
// on purpose, `go test ./internal/service/` will take it. The catalog is safe;
// only announcements are cleared.
//
// Cleanup ordering follows LockCategorySet's rule, for the same reason —
// `t.Cleanup` runs LIFO, so register, in this order:
//
//  1. the pool close (runs last: the lock's connection must go back first),
//  2. this call,
//  3. every cleanup that deletes announcement rows (runs first).
//
// Deleting the test's own rows after the lock is released would let the next
// holder read rows this test is about to remove (issue #142).
func ClaimAnnouncements(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire connection for the announcements lock: %v", err)
	}
	if _, err := conn.Exec(ctx, "select pg_advisory_lock($1)", announcementsKey); err != nil {
		conn.Release()
		t.Fatalf("take the announcements lock: %v", err)
	}
	t.Cleanup(func() {
		if _, err := conn.Exec(ctx, "select pg_advisory_unlock($1)", announcementsKey); err != nil {
			t.Errorf("release the announcements lock: %v", err)
		}
		conn.Release()
	})
	// Under the lock, so nothing can re-populate the table between here and the
	// test's first assertion. The cascade takes the dismissals with it.
	if _, err := conn.Exec(ctx, "delete from announcements"); err != nil {
		t.Fatalf("clear announcements: %v", err)
	}
}
