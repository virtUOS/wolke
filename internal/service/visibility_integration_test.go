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

// A restricted service round-trips through the shared write path with its
// slug, and can never become a role default (service-visibility spec §7.1).
// Needs DATABASE_URL.
func TestRestrictedServiceCannotBeARoleDefault(t *testing.T) {
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
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'vis-svc-test'")
		db.Close()
	})

	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{{
		Slug: "experimental", Grant: config.GrantOptIn, Warning: map[string]string{"de": "!"},
	}}}).Visibility()

	restricted, err := CreateService(ctx, db, actor, vis, Draft{
		Name: "Vis Test Restricted", Description: map[string]string{"de": "x", "en": "x"},
		ServiceURL: "https://vis.example.edu", Icon: "server", Categories: []string{"data"},
		Visibility: "experimental",
	})
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	if restricted.Visibility != "experimental" {
		t.Fatalf("created visibility = %q, want experimental", restricted.Visibility)
	}
	got, err := GetAdminService(ctx, db, mustUUID(t, restricted.ID))
	if err != nil || got.Visibility != "experimental" {
		t.Fatalf("GetAdminService = %+v, %v; want visibility experimental", got, err)
	}

	// The rejection names the service and leaves the role's defaults untouched.
	err = SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", append(append([]pgtype.UUID{}, origStaff...), mustUUID(t, restricted.ID)))
	var ve *ValidationError
	if !errors.As(err, &ve) || ve.Field != "service_ids" || !strings.Contains(ve.Msg, "Vis Test Restricted") {
		t.Fatalf("SetRoleDefaults with a restricted service: err = %v, want service_ids ValidationError naming it", err)
	}
	after, err := db.GetRoleDefaults(ctx, "staff")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(origStaff) {
		t.Fatalf("staff defaults changed on a rejected write: %d → %d", len(origStaff), len(after))
	}

	// Making it public again lifts the restriction — and clears the column.
	public, err := UpdateService(ctx, db, actor, vis, mustUUID(t, restricted.ID), Draft{
		Name: "Vis Test Restricted", Description: map[string]string{"de": "x", "en": "x"},
		ServiceURL: "https://vis.example.edu", Icon: "server", Categories: []string{"data"},
	})
	if err != nil {
		t.Fatalf("UpdateService: %v", err)
	}
	if public.Visibility != "" {
		t.Fatalf("visibility after update = %q, want public", public.Visibility)
	}
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", append(append([]pgtype.UUID{}, origStaff...), mustUUID(t, restricted.ID))); err != nil {
		t.Fatalf("SetRoleDefaults with the now-public service: %v", err)
	}
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "staff", origStaff); err != nil {
		t.Fatalf("restore staff defaults: %v", err)
	}
}

// Review finding 1: restricting a service that is already a role default must
// purge the role_defaults rows in the same transaction (spec §7.1 holds by
// construction, and the role's editor is not wedged), and record them in the
// audit diff like SetRoleDefaults's purged_roles. Needs DATABASE_URL.
func TestRestrictingAServicePurgesItsRoleDefaults(t *testing.T) {
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
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'vis-purge-test'")
		db.Close()
	})

	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{{
		Slug: "experimental", Grant: config.GrantOptIn, Warning: map[string]string{"de": "!"},
	}}}).Visibility()
	draft := Draft{
		Name: "Vis Purge Svc", Description: map[string]string{"de": "x", "en": "x"},
		ServiceURL: "https://purge.example.edu", Icon: "server", Categories: []string{"data"},
	}
	svc, err := CreateService(ctx, db, actor, vis, draft)
	if err != nil {
		t.Fatalf("CreateService: %v", err)
	}
	id := mustUUID(t, svc.ID)

	// Public → a student default. Then restrict it.
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "student", append(append([]pgtype.UUID{}, origStudent...), id)); err != nil {
		t.Fatalf("SetRoleDefaults: %v", err)
	}
	draft.Visibility = "experimental"
	if _, err := UpdateService(ctx, db, actor, vis, id, draft); err != nil {
		t.Fatalf("UpdateService (restrict): %v", err)
	}

	// The row is gone…
	var n int
	if err := db.Pool.QueryRow(ctx, "select count(*) from role_defaults where service_id = $1", id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("role_defaults rows for the now-restricted service = %d, want 0", n)
	}
	// …the other student defaults are untouched…
	after, err := db.GetRoleDefaults(ctx, "student")
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(origStudent) {
		t.Fatalf("student defaults = %d rows, want the original %d", len(after), len(origStudent))
	}
	// …the audit diff says which roles lost a default…
	var diff []byte
	if err := db.Pool.QueryRow(ctx, "select diff from audit_log where actor_id = $1 and action = 'service.update' order by id desc limit 1", admin.ID).Scan(&diff); err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		PurgedRoles []string `json:"purged_roles"`
	}
	if err := json.Unmarshal(diff, &parsed); err != nil || len(parsed.PurgedRoles) != 1 || parsed.PurgedRoles[0] != "student" {
		t.Fatalf("audit diff purged_roles = %v (%v), want [student]; diff = %s", parsed.PurgedRoles, err, diff)
	}
	// …and the role's editor still saves afterwards (not wedged by a 400).
	if err := SetRoleDefaults(ctx, db, actor, exampleRoles(), "student", origStudent); err != nil {
		t.Fatalf("SetRoleDefaults after the purge: %v", err)
	}
}
