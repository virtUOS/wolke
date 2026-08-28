package auth

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// Integration tests against a real Postgres (docs/04 §3); skipped unless
// DATABASE_URL points at a migrated database, same as internal/store.
func testDB(t *testing.T) *store.DB {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping Postgres integration test")
	}
	db, err := store.Open(context.Background(), url)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(db.Close)
	return db
}

// testUser creates (and cleans up) a user row for session tests.
func testUser(t *testing.T, db *store.DB, sub string) store.User {
	t.Helper()
	ctx := context.Background()
	u, err := db.UpsertUser(ctx, store.UpsertUserParams{
		OidcSub:     sub,
		DisplayName: "Test User " + sub,
		PrimaryRole: "student",
	})
	if err != nil {
		t.Fatalf("UpsertUser(%q): %v", sub, err)
	}
	t.Cleanup(func() {
		// cascade removes the user's session rows too
		_, _ = db.Pool.Exec(context.Background(), "delete from users where oidc_sub = $1", sub)
	})
	return u
}

// A session created without a sid (IdP that doesn't send one) stores NULL and
// keeps working — back-channel logout is opt-in per IdP, never a login breaker.
func TestSessionNewWithoutSID(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	user := testUser(t, db, "bcl-nosid")
	s := NewSessionStore(db, time.Hour)

	token, _, err := s.New(ctx, user.ID, "")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := s.Lookup(ctx, token); err != nil {
		t.Fatalf("Lookup after sid-less New: %v", err)
	}

	var sid pgtype.Text
	err = db.Pool.QueryRow(ctx,
		"select oidc_sid from sessions where user_id = $1", user.ID).Scan(&sid)
	if err != nil {
		t.Fatalf("query oidc_sid: %v", err)
	}
	if sid.Valid {
		t.Errorf("oidc_sid = %q, want NULL for a sid-less login", sid.String)
	}
}

// DeleteBySID ends exactly the sessions bound to that IdP session: other sids
// and other users stay logged in.
func TestSessionDeleteBySID(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	alice := testUser(t, db, "bcl-alice")
	bob := testUser(t, db, "bcl-bob")
	s := NewSessionStore(db, time.Hour)

	target, _, err := s.New(ctx, alice.ID, "idp-sid-1")
	if err != nil {
		t.Fatalf("New(target): %v", err)
	}
	otherSID, _, err := s.New(ctx, alice.ID, "idp-sid-2")
	if err != nil {
		t.Fatalf("New(otherSID): %v", err)
	}
	bobs, _, err := s.New(ctx, bob.ID, "idp-sid-3")
	if err != nil {
		t.Fatalf("New(bobs): %v", err)
	}

	n, err := s.DeleteBySID(ctx, "idp-sid-1")
	if err != nil {
		t.Fatalf("DeleteBySID: %v", err)
	}
	if n != 1 {
		t.Errorf("DeleteBySID ended %d sessions, want 1", n)
	}
	if _, err := s.Lookup(ctx, target); err == nil {
		t.Errorf("target session still resolves after DeleteBySID")
	}
	if _, err := s.Lookup(ctx, otherSID); err != nil {
		t.Errorf("same user's other-sid session was ended: %v", err)
	}
	if _, err := s.Lookup(ctx, bobs); err != nil {
		t.Errorf("other user's session was ended: %v", err)
	}

	// Unknown sid deletes nothing and is not an error (200-even-when-no-match
	// behavior at the endpoint rests on this).
	n, err = s.DeleteBySID(ctx, "idp-sid-unknown")
	if err != nil {
		t.Fatalf("DeleteBySID(unknown): %v", err)
	}
	if n != 0 {
		t.Errorf("DeleteBySID(unknown) ended %d sessions, want 0", n)
	}
}

// DeleteByOIDCSub is the sub-only logout token: the IdP couldn't say which
// session, so every session of that user ends — including sid-less ones.
func TestSessionDeleteByOIDCSub(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	alice := testUser(t, db, "bcl-suball")
	bob := testUser(t, db, "bcl-subother")
	s := NewSessionStore(db, time.Hour)

	a1, _, err := s.New(ctx, alice.ID, "idp-sid-a1")
	if err != nil {
		t.Fatalf("New(a1): %v", err)
	}
	a2, _, err := s.New(ctx, alice.ID, "")
	if err != nil {
		t.Fatalf("New(a2): %v", err)
	}
	b1, _, err := s.New(ctx, bob.ID, "idp-sid-b1")
	if err != nil {
		t.Fatalf("New(b1): %v", err)
	}

	n, err := s.DeleteByOIDCSub(ctx, "bcl-suball")
	if err != nil {
		t.Fatalf("DeleteByOIDCSub: %v", err)
	}
	if n != 2 {
		t.Errorf("DeleteByOIDCSub ended %d sessions, want 2", n)
	}
	for name, tok := range map[string]string{"a1": a1, "a2": a2} {
		if _, err := s.Lookup(ctx, tok); err == nil {
			t.Errorf("%s still resolves after DeleteByOIDCSub", name)
		}
	}
	if _, err := s.Lookup(ctx, b1); err != nil {
		t.Errorf("other user's session was ended: %v", err)
	}
}
