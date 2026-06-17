package readmcp

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// Enforces the read-only catalog contract: the public MCP server serves only
// active services (never soft-deleted ones), surfaces the maintenance tag, and
// resolves documentation links — the same data as /api/catalog. Needs
// DATABASE_URL.
func TestReadServerActiveOnly(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping readmcp integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}

	// An admin actor is needed only to seed the fixtures through the shared
	// use-case layer; the read server itself never uses one.
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "readmcp-test", DisplayName: "RM", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	actor := service.Actor{ID: admin.ID, Kind: service.ActorMCP}

	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from service_categories sc using services s where sc.service_id = s.id and s.name like 'RM Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'RM Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug = 'rm-test-cat'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'readmcp-test'")
		db.Close()
	})

	if _, err := service.CreateCategory(ctx, db, actor, "rm-test-cat", map[string]string{"de": "RM Test"}, 9999); err != nil {
		t.Fatalf("create category: %v", err)
	}

	// A normal active service, an active one in maintenance, and one we then
	// soft-delete so it must NOT appear in any read.
	normal, err := service.CreateService(ctx, db, actor, service.Draft{
		Name: "RM Test Normal", Description: map[string]string{"de": "Normal."},
		ServiceURL: "https://normal.example.edu", DocURL: "https://docs.example.edu/normal",
		Icon: "server", Categories: []string{"rm-test-cat"},
	})
	if err != nil {
		t.Fatalf("create normal: %v", err)
	}
	if _, err := service.CreateService(ctx, db, actor, service.Draft{
		Name: "RM Test Maint", Description: map[string]string{"de": "In Wartung."},
		ServiceURL: "https://maint.example.edu", Icon: "server",
		Categories: []string{"rm-test-cat"}, Tag: "wartung",
	}); err != nil {
		t.Fatalf("create maint: %v", err)
	}
	gone, err := service.CreateService(ctx, db, actor, service.Draft{
		Name: "RM Test Gone", Description: map[string]string{"de": "Gelöscht."},
		ServiceURL: "https://gone.example.edu", Icon: "server", Categories: []string{"rm-test-cat"},
	})
	if err != nil {
		t.Fatalf("create gone: %v", err)
	}
	var goneID pgtype.UUID
	if err := goneID.Scan(gone.ID); err != nil {
		t.Fatalf("scan gone id: %v", err)
	}
	if err := service.SoftDeleteService(ctx, db, actor, goneID); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	// The Manager reads through a fresh snapshot each call (TTL 0).
	cache := catalog.NewCache(0, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})
	mgr := New(cache, db)

	inCat := func(list []catalog.Service) []catalog.Service {
		out := []catalog.Service{}
		for _, s := range list {
			for _, c := range s.Categories {
				if c == "rm-test-cat" {
					out = append(out, s)
				}
			}
		}
		return out
	}

	// service.list: the two active ones, never the soft-deleted one.
	all, err := mgr.ListServices(ctx, "rm-test-cat", "")
	if err != nil {
		t.Fatalf("ListServices: %v", err)
	}
	if got := len(all); got != 2 {
		t.Fatalf("ListServices returned %d active services, want 2", got)
	}
	for _, s := range all {
		if s.Name == "RM Test Gone" {
			t.Fatal("soft-deleted service leaked into ListServices")
		}
	}

	// status filter + the dedicated maintenance tool agree, and carry the tag.
	maint, err := mgr.ListInMaintenance(ctx)
	if err != nil {
		t.Fatalf("ListInMaintenance: %v", err)
	}
	maint = inCat(maint)
	if len(maint) != 1 || maint[0].Name != "RM Test Maint" || maint[0].Tag != "wartung" {
		t.Fatalf("ListInMaintenance = %+v, want one RM Test Maint with tag wartung", maint)
	}

	// service.get resolves the active service with its doc link, and refuses the
	// soft-deleted id.
	svc, err := mgr.GetService(ctx, normal.ID)
	if err != nil {
		t.Fatalf("GetService(normal): %v", err)
	}
	if svc.DocURL != "https://docs.example.edu/normal" {
		t.Errorf("doc_url = %q, want the documentation link", svc.DocURL)
	}
	if _, err := mgr.GetService(ctx, gone.ID); err == nil {
		t.Error("GetService returned a soft-deleted service, want not-found error")
	}

	// search finds the active service by name and never the deleted one.
	found, err := mgr.Search(ctx, "RM Test")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	for _, s := range found {
		if s.Name == "RM Test Gone" {
			t.Fatal("soft-deleted service leaked into Search")
		}
	}
}
