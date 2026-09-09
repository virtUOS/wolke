package readmcp

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/config"
)

type fakeStore struct {
	Store // nil: announcements are never reached here
	ids   []pgtype.UUID
}

func (f fakeStore) SearchServiceIDs(context.Context, string) ([]pgtype.UUID, error) {
	return f.ids, nil
}

// The catalog MCP server has no identity: it holds no group and cannot ask for
// beta services, so both a restricted category's services and the beta ones are
// absent from every read, unconditionally (docs/specs/service-visibility.md §3).
func TestCatalogMCPNeverServesRestrictedServices(t *testing.T) {
	const restricted = "22222222-2222-2222-2222-222222222222"
	var rid pgtype.UUID
	if err := rid.Scan(restricted); err != nil {
		t.Fatal(err)
	}
	snap := catalog.NewSnapshot(
		[]catalog.Service{
			{ID: "1", Name: "Public", Categories: []string{"data"}, Tag: "wartung"},
			{ID: restricted, Name: "Secret Lab", Categories: []string{"labs"}, Tag: "wartung"},
			{ID: "3", Name: "Beta Thing", Categories: []string{"data"}, Tag: catalog.TagBeta},
		},
		[]catalog.Category{{Slug: "data"}, {Slug: "labs", Visibility: "it-infra"}},
	)
	cache := catalog.NewCache(time.Minute, func(context.Context) (*catalog.Snapshot, error) { return snap, nil })
	mgr := New(cache, fakeStore{ids: []pgtype.UUID{rid}}, config.RoleSet{})
	ctx := context.Background()

	list, err := mgr.ListServices(ctx, "", "")
	if err != nil || len(list) != 1 || list[0].Name != "Public" {
		t.Fatalf("ListServices = %+v, %v; want only the public service", list, err)
	}
	maint, err := mgr.ListInMaintenance(ctx)
	if err != nil || len(maint) != 1 || maint[0].Name != "Public" {
		t.Fatalf("ListInMaintenance = %+v, %v; want only the public service", maint, err)
	}
	if _, err := mgr.GetService(ctx, restricted); err == nil {
		t.Fatal("GetService resolved a restricted service without any identity")
	}
	found, err := mgr.Search(ctx, "secret")
	if err != nil || len(found) != 0 {
		t.Fatalf("Search = %+v, %v; a restricted id must fail to resolve", found, err)
	}
	// Beta is "hidden unless the user asks for it", and this server has no user
	// to ask (§2.1) — so it never lists one either.
	if _, err := mgr.GetService(ctx, "3"); err == nil {
		t.Fatal("GetService resolved a beta service without any identity")
	}
	beta, err := mgr.ListServices(ctx, "", catalog.TagBeta)
	if err != nil || len(beta) != 0 {
		t.Fatalf("ListServices(tag=beta) = %+v, %v; want nothing", beta, err)
	}
	cats, err := mgr.ListCategories(ctx)
	if err != nil || len(cats) != 1 || cats[0].Slug != "data" {
		t.Fatalf("ListCategories = %+v, %v; the emptied 'labs' category must vanish", cats, err)
	}
}
