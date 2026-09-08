package catalog

import (
	"encoding/json"
	"reflect"
	"testing"
)

// The fixture exercises both halves of the predicate and their interaction:
// a public service, a beta one, a service in a restricted category, and a
// service in a restricted AND a public category (the "restricted wins" case).
func fixture() ([]Service, []Category) {
	services := []Service{
		{ID: "a", Name: "Alpha", Categories: []string{"learning"}},
		{ID: "b", Name: "Beta", Categories: []string{"data"}, DocOnly: true},
		{ID: "x", Name: "Xperiment", Categories: []string{"labs"}, Tag: TagBeta},
		{ID: "i", Name: "Infra", Categories: []string{"infra"}},
		{ID: "m", Name: "Mixed", Categories: []string{"data", "infra"}},
	}
	categories := []Category{
		{Slug: "learning", Sort: 10}, {Slug: "data", Sort: 20},
		{Slug: "labs", Sort: 30},
		{Slug: "infra", Sort: 40, Visibility: "it-infra"},
		{Slug: "empty-for-everyone", Sort: 50},
	}
	return services, categories
}

func ids(list []Service) []string {
	out := make([]string, 0, len(list))
	for _, s := range list {
		out = append(out, s.ID)
	}
	return out
}

func slugs(list []Category) []string {
	out := make([]string, 0, len(list))
	for _, c := range list {
		out = append(out, c.Slug)
	}
	return out
}

// The plain reader: no group, no beta. Restricted categories and beta services
// are both gone, and so are the categories that filtering emptied — no empty
// "IT-Infrastruktur" pill leaking the group's name. A category that is empty
// for everyone stays, exactly as today.
func TestVisibleToNarrowsServicesAndCategories(t *testing.T) {
	snap := NewSnapshot(fixture())

	public := snap.VisibleTo(nil, false)
	if got := ids(public.Services); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("public services = %v, want [a b]", got)
	}
	if got := slugs(public.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "empty-for-everyone"}) {
		t.Fatalf("public categories = %v: labs (beta only) and infra (restricted) must vanish", got)
	}
	if _, ok := public.ServiceByID("i"); ok {
		t.Fatal("ServiceByID resolved a restricted service for a non-holder")
	}
	if _, ok := public.ServiceByID("x"); ok {
		t.Fatal("ServiceByID resolved a beta service for a reader who did not ask for beta")
	}
	if _, ok := public.ServiceByID("a"); !ok {
		t.Fatal("ServiceByID lost a public service")
	}

	// Beta on, still no group: the beta service and its category come back.
	beta := snap.VisibleTo(nil, true)
	if got := ids(beta.Services); !reflect.DeepEqual(got, []string{"a", "b", "x"}) {
		t.Fatalf("beta reader services = %v, want [a b x]", got)
	}
	if got := slugs(beta.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "labs", "empty-for-everyone"}) {
		t.Fatalf("beta reader categories = %v", got)
	}

	// Group held, beta off: the restricted category and its services appear,
	// the beta one still does not.
	holder := snap.VisibleTo([]string{"it-infra"}, false)
	if got := ids(holder.Services); !reflect.DeepEqual(got, []string{"a", "b", "i", "m"}) {
		t.Fatalf("holder services = %v, want [a b i m]", got)
	}
	if got := slugs(holder.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "infra", "empty-for-everyone"}) {
		t.Fatalf("holder categories = %v", got)
	}

	both := snap.VisibleTo([]string{"it-infra", "unknown"}, true)
	if got := ids(both.Services); !reflect.DeepEqual(got, []string{"a", "b", "x", "i", "m"}) {
		t.Fatalf("both services = %v", got)
	}
	if len(both.Categories) != 5 {
		t.Fatalf("both categories = %v, want all five", slugs(both.Categories))
	}
}

// Restricted wins (spec §2.2): a service filed under a restricted AND a public
// category is hidden from non-holders, so a second category cannot be used to
// bypass the restriction.
func TestRestrictedWinsOverAPublicCategory(t *testing.T) {
	snap := NewSnapshot(fixture())

	public := snap.VisibleTo(nil, false)
	for _, s := range public.Services {
		if s.ID == "m" {
			t.Fatal("a service in a restricted category leaked through its public one")
		}
	}
	// ...and the public category it also belongs to still renders, because
	// another visible service populates it.
	if got := slugs(public.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "empty-for-everyone"}) {
		t.Fatalf("categories = %v, want data to survive on its other service", got)
	}
	if _, ok := snap.VisibleTo([]string{"it-infra"}, false).ServiceByID("m"); !ok {
		t.Fatal("a holder must see the service")
	}
}

// Every restricted category must be held, not just one of them.
func TestTwoRestrictedCategoriesBothMustBeHeld(t *testing.T) {
	snap := NewSnapshot(
		[]Service{{ID: "s", Categories: []string{"infra", "net"}}},
		[]Category{
			{Slug: "infra", Visibility: "it-infra"},
			{Slug: "net", Visibility: "net-ops"},
		},
	)
	if n := len(snap.VisibleTo([]string{"it-infra"}, false).Services); n != 0 {
		t.Fatal("holding one of two restricted categories must not reveal the service")
	}
	if n := len(snap.VisibleTo([]string{"it-infra", "net-ops"}, false).Services); n != 1 {
		t.Fatal("holding both must reveal the service")
	}
}

// Regression (spec §6): with no restricted category and no beta service — the
// plain deployment — the view is byte-identical to the raw catalog, for every
// reader, and costs no copy.
func TestUnrestrictedCatalogIsByteIdentical(t *testing.T) {
	services := []Service{
		{ID: "a", Name: "Alpha", Categories: []string{"learning"}, Description: map[string]string{"de": "A"}},
		{ID: "b", Name: "Beta", Categories: []string{}, DocOnly: true, Tag: "wartung"},
	}
	categories := []Category{{Slug: "learning", Sort: 10}, {Slug: "empty", Sort: 20}}
	snap := NewSnapshot(services, categories)

	want, err := json.Marshal(struct {
		Services   []Service  `json:"services"`
		Categories []Category `json:"categories"`
	}{services, categories})
	if err != nil {
		t.Fatal(err)
	}
	for _, held := range [][]string{nil, {}, {"it-infra"}, {"anything", "else"}} {
		for _, showBeta := range []bool{false, true} {
			view := snap.VisibleTo(held, showBeta)
			got, err := json.Marshal(view)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != string(want) {
				t.Errorf("held=%v beta=%v: view JSON differs from the raw catalog:\n got %s\nwant %s", held, showBeta, got, want)
			}
			if view != snap.public {
				t.Errorf("held=%v beta=%v: an unrestricted catalog must serve the shared view, not a copy", held, showBeta)
			}
		}
	}
	// And the "empty" category is still there: only filtering may drop one.
	if got := slugs(snap.VisibleTo(nil, false).Categories); !reflect.DeepEqual(got, []string{"learning", "empty"}) {
		t.Errorf("categories = %v, want both", got)
	}
}

// A slug the deployment no longer configures fails closed: nobody holds it, so
// the category and its services are invisible rather than public. (Held sets
// come from config.VisibilitySet.Held, which never yields an unconfigured slug.)
func TestUnheldSlugFailsClosed(t *testing.T) {
	snap := NewSnapshot(
		[]Service{{ID: "x", Categories: []string{"gone-group"}}},
		[]Category{{Slug: "gone-group", Visibility: "gone"}},
	)
	if n := len(snap.VisibleTo(nil, true).Services); n != 0 {
		t.Fatalf("public view has %d services, want 0", n)
	}
	if n := len(snap.VisibleTo([]string{"other"}, true).Services); n != 0 {
		t.Fatalf("view has %d services, want 0", n)
	}
}

// The zero Snapshot (what the cache tests build) is usable and empty.
func TestZeroSnapshotIsEmpty(t *testing.T) {
	var snap Snapshot
	view := snap.VisibleTo(nil, false)
	if view == nil {
		// A zero snapshot has no prebuilt view; VisibleTo must still answer.
		t.Fatal("VisibleTo returned nil for the zero Snapshot")
	}
	if len(view.Services) != 0 || len(view.Categories) != 0 {
		t.Fatal("zero Snapshot should be empty")
	}
}
