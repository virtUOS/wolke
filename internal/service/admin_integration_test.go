package service

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
)

// Integration: the admin write flow against a seeded DB, asserting each write is
// audited. Needs DATABASE_URL (make db && make migrate && make seed).
func TestAdminServiceLifecycleAudited(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping admin integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{
		OidcSub: "admin-test", DisplayName: "Admin", PrimaryRole: "staff", IsAdmin: true,
	})
	if err != nil {
		t.Fatalf("upsert admin: %v", err)
	}
	actor := Actor{ID: admin.ID, Kind: ActorForm}

	// Start clean so counts are deterministic regardless of prior runs.
	_, _ = db.Pool.Exec(ctx, "delete from services where name like 'Admin Test Service%'")
	_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)

	// SetRoleDefaults replaces a role's defaults; capture the seeded staff set so
	// we can restore it and not corrupt the seed other tests/demo rely on.
	origStaff, err := db.GetRoleDefaults(ctx, "staff")
	if err != nil {
		t.Fatalf("get staff defaults: %v", err)
	}

	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'Admin Test Service%'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'admin-test'")
		db.Close()
	})

	auditCount := func(action string) int {
		var n int
		if err := db.Pool.QueryRow(ctx,
			"select count(*) from audit_log where actor_id=$1 and action=$2", admin.ID, action).Scan(&n); err != nil {
			t.Fatalf("audit count: %v", err)
		}
		return n
	}

	in := Draft{
		Name:        "Admin Test Service",
		Description: map[string]string{"de": "Testdienst."},
		ServiceURL:  "https://test.example.edu",
		Icon:        "server",
		Categories:  []string{"data"},
	}

	// Create → audited, present in admin list.
	svc, err := CreateService(ctx, db, actor, in)
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if !svc.IsActive || len(svc.Categories) != 1 {
		t.Fatalf("created service = %+v, want active with one category", svc)
	}
	if auditCount("service.create") != 1 {
		t.Errorf("service.create audit rows = %d, want 1", auditCount("service.create"))
	}

	id := mustUUID(t, svc.ID)

	// Update → audited; rejects an unknown category.
	in.Name = "Admin Test Service v2"
	in.Categories = []string{"data", "communication"}
	if _, err := UpdateService(ctx, db, actor, id, in); err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if auditCount("service.update") != 1 {
		t.Errorf("service.update audit rows = %d, want 1", auditCount("service.update"))
	}
	bad := in
	bad.Categories = []string{"no-such-category"}
	if _, err := UpdateService(ctx, db, actor, id, bad); err == nil {
		t.Error("UpdateService with unknown category should fail validation")
	}

	// Soft delete → audited; still present in the admin list but inactive.
	if err := SoftDeleteService(ctx, db, actor, id); err != nil {
		t.Fatalf("SoftDeleteService: %v", err)
	}
	if auditCount("service.delete") != 1 {
		t.Errorf("service.delete audit rows = %d, want 1", auditCount("service.delete"))
	}
	all, err := ListAdminServices(ctx, db)
	if err != nil {
		t.Fatalf("ListAdminServices: %v", err)
	}
	var found bool
	for _, s := range all {
		if s.ID == svc.ID {
			found = true
			if s.IsActive {
				t.Error("soft-deleted service should be inactive in the admin list")
			}
		}
	}
	if !found {
		t.Error("soft-deleted service missing from admin list (should remain, inactive)")
	}

	// Role defaults set → audited.
	if err := SetRoleDefaults(ctx, db, actor, "staff", []pgtype.UUID{id}); err != nil {
		t.Fatalf("SetRoleDefaults: %v", err)
	}
	if auditCount("role_defaults.set") != 1 {
		t.Errorf("role_defaults.set audit rows = %d, want 1", auditCount("role_defaults.set"))
	}
	// Restore the seeded staff defaults so the seed stays intact.
	if err := SetRoleDefaults(ctx, db, actor, "staff", origStaff); err != nil {
		t.Fatalf("restore staff defaults: %v", err)
	}
}

func mustUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return u
}
