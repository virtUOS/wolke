package service

import (
	"context"
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
