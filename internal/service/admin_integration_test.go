package service

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
	"github.com/virtuos/wolke/internal/store/storetest"
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
		Description: map[string]string{"de": "Testdienst.", "en": "Test service."},
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
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", []pgtype.UUID{id}); err != nil {
		t.Fatalf("SetRoleDefaults: %v", err)
	}
	if auditCount("role_defaults.set") != 1 {
		t.Errorf("role_defaults.set audit rows = %d, want 1", auditCount("role_defaults.set"))
	}
	// Restore the seeded staff defaults so the seed stays intact.
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", origStaff); err != nil {
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

// Integration: the category write flow (issue #130) — update incl. rename,
// the guarded delete, and the permutation-checked reorder, each audited.
// Needs DATABASE_URL (make db && make migrate && make seed).
func TestCategoryWritesAudited(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping category integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{
		OidcSub: "cat-admin-test", DisplayName: "Admin", PrimaryRole: "staff", IsAdmin: true,
	})
	if err != nil {
		t.Fatalf("upsert admin: %v", err)
	}
	actor := Actor{ID: admin.ID, Kind: ActorForm}

	// The reorder is a whole-list write over the shared category set, so this
	// test needs it to itself while it runs (see storetest.LockCategorySet), and
	// has to put the seeded sort values back afterwards — the seed order other
	// tests and the demo rely on must not be left rearranged.
	type sortRow struct {
		slug string
		sort int32
	}
	var origSorts []sortRow
	cleanupSQL := func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'Cat Test Service%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug in ('cat-test','cat-test-renamed','cat-test-used')")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
	}
	t.Cleanup(func() {
		cleanupSQL()
		for _, r := range origSorts {
			_, _ = db.Pool.Exec(ctx, "update categories set sort = $1 where slug = $2", r.sort, r.slug)
		}
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'cat-admin-test'")
		db.Close()
	})
	// After the cleanup above, so the lock is released before the pool closes.
	storetest.LockCategorySet(ctx, t, db.Pool)
	cleanupSQL()

	rows, err := db.Pool.Query(ctx, "select slug, sort from categories order by sort, slug")
	if err != nil {
		t.Fatalf("read category sorts: %v", err)
	}
	for rows.Next() {
		var r sortRow
		if err := rows.Scan(&r.slug, &r.sort); err != nil {
			t.Fatalf("scan category sort: %v", err)
		}
		origSorts = append(origSorts, r)
	}
	rows.Close()
	if len(origSorts) < 2 {
		t.Skip("seeded catalog has fewer than two categories; skipping reorder assertions")
	}

	auditCount := func(action string) int {
		var n int
		if err := db.Pool.QueryRow(ctx,
			"select count(*) from audit_log where actor_id=$1 and action=$2", admin.ID, action).Scan(&n); err != nil {
			t.Fatalf("audit count: %v", err)
		}
		return n
	}
	auditDiff := func(action string) string {
		var diff string
		if err := db.Pool.QueryRow(ctx,
			"select diff::text from audit_log where actor_id=$1 and action=$2 order by id desc limit 1",
			admin.ID, action).Scan(&diff); err != nil {
			t.Fatalf("audit diff for %s: %v", action, err)
		}
		return diff
	}

	label := map[string]string{"de": "Kat-Test", "en": "Cat test"}

	// Create rejects a malformed slug at the *service* layer — the gap #130
	// closes (the regex used to live only in CategoriesAdmin.tsx).
	if _, err := CreateCategory(ctx, db, actor, config.VisibilitySet{}, "Foo Bar!!", label, 9000, ""); err == nil {
		t.Error("CreateCategory with a malformed slug should fail validation")
	} else {
		var ve *ValidationError
		if !errors.As(err, &ve) || ve.Field != "slug" {
			t.Errorf("err = %v, want ValidationError on slug", err)
		}
	}

	cat, err := CreateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test", label, 9000, "")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}

	// Update rejects a malformed slug and a missing label, and renames onto a
	// free slug — attachments join on the id, so a rename is safe.
	if _, err := UpdateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test", "Foo Bar!!", label, ""); err == nil {
		t.Error("UpdateCategory with a malformed slug should fail validation")
	}
	if _, err := UpdateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test", "cat-test", map[string]string{"de": "Nur DE"}, ""); err == nil {
		t.Error("UpdateCategory without an en label should fail validation")
	}
	if _, err := UpdateCategory(ctx, db, actor, config.VisibilitySet{}, "no-such-category", "x", label, ""); err == nil {
		t.Error("UpdateCategory on an unknown slug should be a not-found")
	} else {
		var nf *NotFoundError
		if !errors.As(err, &nf) {
			t.Errorf("err = %v, want NotFoundError", err)
		}
	}
	// Renaming onto a slug that exists is a field-level validation error, not a
	// raw 23505 from the unique index.
	if _, err := UpdateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test", origSorts[0].slug, label, ""); err == nil {
		t.Error("UpdateCategory onto an existing slug should fail validation")
	} else {
		var ve *ValidationError
		if !errors.As(err, &ve) || ve.Field != "slug" {
			t.Errorf("err = %v, want ValidationError on slug", err)
		}
	}
	// Creating onto an existing slug is the same error, from the same check.
	if _, err := CreateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test", label, 9000, ""); err == nil {
		t.Error("CreateCategory onto an existing slug should fail validation")
	} else {
		var ve *ValidationError
		if !errors.As(err, &ve) || ve.Field != "slug" {
			t.Errorf("err = %v, want ValidationError on slug", err)
		}
	}

	renamedLabel := map[string]string{"de": "Kat-Test v2", "en": "Cat test v2"}
	updated, err := UpdateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test", "cat-test-renamed", renamedLabel, "")
	if err != nil {
		t.Fatalf("UpdateCategory: %v", err)
	}
	if updated.Slug != "cat-test-renamed" {
		t.Errorf("slug after rename = %q, want %q", updated.Slug, "cat-test-renamed")
	}
	if updated.ID != cat.ID {
		t.Error("a rename must keep the category id (attachments join on it)")
	}
	if auditCount("category.update") != 1 {
		t.Errorf("category.update audit rows = %d, want 1", auditCount("category.update"))
	}
	if diff := auditDiff("category.update"); !strings.Contains(diff, `"before"`) ||
		!strings.Contains(diff, `"after"`) || !strings.Contains(diff, "cat-test-renamed") {
		t.Errorf("category.update diff = %s, want before/after with the new slug", diff)
	}

	// Delete is guarded: a category a service still uses is refused with the
	// blocking count, not a raw constraint violation.
	used, err := CreateCategory(ctx, db, actor, config.VisibilitySet{}, "cat-test-used", label, 9010, "")
	if err != nil {
		t.Fatalf("CreateCategory (used): %v", err)
	}
	svcIn := Draft{
		Name:        "Cat Test Service",
		Description: map[string]string{"de": "Testdienst.", "en": "Test service."},
		ServiceURL:  "https://cat-test.example.edu",
		Icon:        "server",
		Categories:  []string{"cat-test-used"},
	}
	if _, err := CreateService(ctx, db, actor, svcIn); err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	err = DeleteCategory(ctx, db, actor, "cat-test-used")
	var ce *ConflictError
	if !errors.As(err, &ce) {
		t.Fatalf("DeleteCategory on a used category: err = %v, want ConflictError", err)
	}
	if !strings.Contains(ce.Error(), "1 service still uses") || !strings.Contains(ce.Error(), "Cat Test Service") {
		t.Errorf("refusal = %q, want the count and the blocking service name", ce.Error())
	}
	if auditCount("category.delete") != 0 {
		t.Error("a refused delete must not write an audit row")
	}
	if _, err := db.GetCategoryBySlug(ctx, "cat-test-used"); err != nil {
		t.Errorf("the refused category must still exist: %v", err)
	}
	_ = used

	// Delete of an unused category succeeds and is audited with its before state.
	if err := DeleteCategory(ctx, db, actor, "cat-test-renamed"); err != nil {
		t.Fatalf("DeleteCategory (unused): %v", err)
	}
	if auditCount("category.delete") != 1 {
		t.Errorf("category.delete audit rows = %d, want 1", auditCount("category.delete"))
	}
	if diff := auditDiff("category.delete"); !strings.Contains(diff, `"before"`) ||
		!strings.Contains(diff, "cat-test-renamed") {
		t.Errorf("category.delete diff = %s, want a before with the deleted slug", diff)
	}
	if _, err := db.GetCategoryBySlug(ctx, "cat-test-renamed"); err == nil {
		t.Error("the deleted category should be gone")
	}
	if err := DeleteCategory(ctx, db, actor, "cat-test-renamed"); err == nil {
		t.Error("deleting a category twice should be a not-found")
	}

	// Reorder: a partial or duplicated list is refused; a real permutation
	// persists and is audited.
	current, err := db.ListCategorySlugs(ctx)
	if err != nil {
		t.Fatalf("ListCategorySlugs: %v", err)
	}
	if err := SetCategoryOrder(ctx, db, actor, current[:len(current)-1]); err == nil {
		t.Error("a partial list should be refused")
	}
	if err := SetCategoryOrder(ctx, db, actor, append([]string{current[0]}, current...)); err == nil {
		t.Error("a list with a duplicate should be refused")
	}
	if auditCount("category.reorder") != 0 {
		t.Error("a refused reorder must not write an audit row")
	}

	reversed := make([]string, len(current))
	for i, s := range current {
		reversed[len(current)-1-i] = s
	}
	if err := SetCategoryOrder(ctx, db, actor, reversed); err != nil {
		t.Fatalf("SetCategoryOrder: %v", err)
	}
	after, err := db.ListCategorySlugs(ctx)
	if err != nil {
		t.Fatalf("ListCategorySlugs after reorder: %v", err)
	}
	if !reflect.DeepEqual(after, reversed) {
		t.Errorf("order after reorder = %q, want %q", after, reversed)
	}
	if auditCount("category.reorder") != 1 {
		t.Errorf("category.reorder audit rows = %d, want 1", auditCount("category.reorder"))
	}
	if diff := auditDiff("category.reorder"); !strings.Contains(diff, `"before"`) || !strings.Contains(diff, `"after"`) {
		t.Errorf("category.reorder diff = %s, want before/after", diff)
	}
	// Idempotent: writing the same order again changes nothing.
	if err := SetCategoryOrder(ctx, db, actor, reversed); err != nil {
		t.Fatalf("SetCategoryOrder (repeat): %v", err)
	}
	again, err := db.ListCategorySlugs(ctx)
	if err != nil {
		t.Fatalf("ListCategorySlugs after repeat: %v", err)
	}
	if !reflect.DeepEqual(again, reversed) {
		t.Errorf("order after a repeated write = %q, want %q", again, reversed)
	}
}
