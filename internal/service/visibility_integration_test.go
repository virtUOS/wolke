package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// visTestSet is a deployment configuring one visibility group.
func visTestSet() config.VisibilitySet {
	return (&config.Config{VisibilityEntries: []config.VisibilityEntry{{
		Slug: "it-infra", Claim: "groups", Match: "it-service-admins",
		Label: map[string]string{"de": "IT-Infrastruktur", "en": "IT infrastructure"},
	}}}).Visibility()
}

// A service in a restricted category can never be a role default: default views
// stay public-only, so every user of a role sees the same one
// (docs/specs/service-visibility.md §2.2). Needs DATABASE_URL.
func TestServiceInARestrictedCategoryCannotBeARoleDefault(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping visibility integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "vis-svc-test", DisplayName: "Vis", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	actor := Actor{ID: admin.ID, Kind: ActorForm}
	origStaff, err := db.GetRoleDefaults(ctx, "staff")
	if err != nil {
		t.Fatalf("staff defaults: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from role_defaults where service_id in (select id from services where name like 'Vis Test%')")
		_, _ = db.Pool.Exec(ctx, "delete from service_categories where service_id in (select id from services where name like 'Vis Test%')")
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'Vis Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug like 'vis-test%'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'vis-svc-test'")
		db.Close()
	})

	vis := visTestSet()
	label := map[string]string{"de": "IT-Infrastruktur", "en": "IT infrastructure"}
	cat, err := CreateCategory(ctx, db, actor, vis, "vis-test-infra", label, 9100, "it-infra")
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	if !cat.Visibility.Valid || cat.Visibility.String != "it-infra" {
		t.Fatalf("created category visibility = %v, want it-infra", cat.Visibility)
	}

	restricted, err := CreateService(ctx, db, actor, Draft{
		Name: "Vis Test Restricted", Description: map[string]string{"de": "x", "en": "x"},
		ServiceURL: "https://vis.example.edu", Icon: "server",
		Categories: []string{"vis-test-infra"},
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}

	// The rejection names the service and leaves the role's defaults untouched.
	err = SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", append(append([]pgtype.UUID{}, origStaff...), mustUUID(t, restricted.ID)))
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Field != "service_ids" || !strings.Contains(ve.Msg, "Vis Test Restricted") {
		t.Fatalf("SetRoleDefaults with a restricted service: err = %v, want service_ids ValidationError naming it", err)
	}
	if !strings.Contains(ve.Msg, "it-infra") {
		t.Errorf("message %q should name the group", ve.Msg)
	}
	after, err := db.GetRoleDefaults(ctx, "staff")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(origStaff) {
		t.Fatalf("staff defaults changed on a rejected write: %d → %d", len(origStaff), len(after))
	}

	// Making the category public again lifts the restriction on everything in it.
	if _, err := UpdateCategory(ctx, db, actor, vis, "vis-test-infra", "vis-test-infra", label, ""); err != nil {
		t.Fatalf("UpdateCategory (make public): %v", err)
	}
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", append(append([]pgtype.UUID{}, origStaff...), mustUUID(t, restricted.ID))); err != nil {
		t.Fatalf("SetRoleDefaults with the now-public service: %v", err)
	}
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", origStaff); err != nil {
		t.Fatalf("restore staff defaults: %v", err)
	}
}

// The two ways a default can become unviewable, both purged in the same
// transaction and both reported as `purged_roles` in the audit diff: moving a
// service into a restricted category, and restricting a category that already
// holds one. Without this the role's editor is wedged — every save afterwards
// would be rejected. Needs DATABASE_URL.
func TestRestrictingPurgesRoleDefaults(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping visibility integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "vis-purge-test", DisplayName: "Vis", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	actor := Actor{ID: admin.ID, Kind: ActorForm}
	origStudent, err := db.GetRoleDefaults(ctx, "student")
	if err != nil {
		t.Fatalf("student defaults: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from role_defaults where service_id in (select id from services where name like 'Vis Purge%')")
		_, _ = db.Pool.Exec(ctx, "delete from service_categories where service_id in (select id from services where name like 'Vis Purge%')")
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'Vis Purge%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug like 'vis-purge%'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'vis-purge-test'")
		db.Close()
	})

	vis := visTestSet()
	label := map[string]string{"de": "Purge", "en": "Purge"}
	if _, err := CreateCategory(ctx, db, actor, vis, "vis-purge-open", label, 9200, ""); err != nil {
		t.Fatalf("CreateCategory (public): %v", err)
	}
	if _, err := CreateCategory(ctx, db, actor, vis, "vis-purge-closed", label, 9210, "it-infra"); err != nil {
		t.Fatalf("CreateCategory (restricted): %v", err)
	}

	draft := Draft{
		Name: "Vis Purge Svc", Description: map[string]string{"de": "x", "en": "x"},
		ServiceURL: "https://purge.example.edu", Icon: "server",
		Categories: []string{"vis-purge-open"},
	}
	svc, err := CreateService(ctx, db, actor, draft)
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	id := mustUUID(t, svc.ID)

	purgedRoles := func(action string) []string {
		t.Helper()
		var diff []byte
		if err := db.Pool.QueryRow(ctx,
			"select diff from audit_log where actor_id = $1 and action = $2 order by id desc limit 1",
			admin.ID, action).Scan(&diff); err != nil {
			t.Fatalf("read audit diff: %v", err)
		}
		var parsed struct {
			PurgedRoles []string `json:"purged_roles"`
		}
		if err := json.Unmarshal(diff, &parsed); err != nil {
			t.Fatalf("parse diff %s: %v", diff, err)
		}
		return parsed.PurgedRoles
	}
	countDefaults := func() int {
		t.Helper()
		var n int
		if err := db.Pool.QueryRow(ctx, "select count(*) from role_defaults where service_id = $1", id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	studentDefaults := append(append([]pgtype.UUID{}, origStudent...), id)

	// (a) The service moves into the restricted category.
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "student", studentDefaults); err != nil {
		t.Fatalf("SetRoleDefaults: %v", err)
	}
	draft.Categories = []string{"vis-purge-closed"}
	if _, err := UpdateService(ctx, db, actor, id, draft); err != nil {
		t.Fatalf("UpdateService (restrict): %v", err)
	}
	if n := countDefaults(); n != 0 {
		t.Fatalf("role_defaults rows for the now-restricted service = %d, want 0", n)
	}
	if got := purgedRoles("service.update"); len(got) != 1 || got[0] != "student" {
		t.Fatalf("service.update purged_roles = %v, want [student]", got)
	}

	// (b) The category the service already sits in becomes restricted.
	draft.Categories = []string{"vis-purge-open"}
	if _, err := UpdateService(ctx, db, actor, id, draft); err != nil {
		t.Fatalf("UpdateService (back to public): %v", err)
	}
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "student", studentDefaults); err != nil {
		t.Fatalf("SetRoleDefaults: %v", err)
	}
	if _, err := UpdateCategory(ctx, db, actor, vis, "vis-purge-open", "vis-purge-open", label, "it-infra"); err != nil {
		t.Fatalf("UpdateCategory (restrict): %v", err)
	}
	if n := countDefaults(); n != 0 {
		t.Fatalf("role_defaults rows after restricting the category = %d, want 0", n)
	}
	if got := purgedRoles("category.update"); len(got) != 1 || got[0] != "student" {
		t.Fatalf("category.update purged_roles = %v, want [student]", got)
	}

	// The other student defaults are untouched, and the editor still saves.
	after, err := db.GetRoleDefaults(ctx, "student")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(origStudent) {
		t.Fatalf("student defaults = %d rows, want the original %d", len(after), len(origStudent))
	}
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "student", origStudent); err != nil {
		t.Fatalf("SetRoleDefaults after the purge: %v", err)
	}
}

// ListAdminCategories is unnarrowed by construction: it reports restricted
// categories with their slug, whoever asks (spec §5). Needs DATABASE_URL.
func TestListAdminCategoriesReportsVisibility(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping visibility integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "vis-list-test", DisplayName: "Vis", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	actor := Actor{ID: admin.ID, Kind: ActorForm}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug like 'vis-list%'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'vis-list-test'")
		db.Close()
	})

	label := map[string]string{"de": "Liste", "en": "List"}
	if _, err := CreateCategory(ctx, db, actor, visTestSet(), "vis-list-closed", label, 9300, "it-infra"); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	list, err := ListAdminCategories(ctx, db)
	if err != nil {
		t.Fatalf("ListAdminCategories: %v", err)
	}
	var found bool
	for _, c := range list {
		if c.Slug == "vis-list-closed" {
			found = true
			if c.Visibility != "it-infra" {
				t.Errorf("visibility = %q, want it-infra", c.Visibility)
			}
		}
	}
	if !found {
		t.Fatal("the restricted category is missing from the admin list")
	}
}
