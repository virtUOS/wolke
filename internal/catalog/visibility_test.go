package catalog

import (
	"encoding/json"
	"reflect"
	"slices"
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
// "IT-Infrastruktur" pill leaking the group's name. Since #139 a category that
// is empty for *everyone* goes too: the rule is simply "has a visible service"
// (docs/specs/empty-facets.md §2).
func TestVisibleToNarrowsServicesAndCategories(t *testing.T) {
	snap := NewSnapshot(fixture())

	public := snap.VisibleTo(nil, false)
	if got := ids(public.Services); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("public services = %v, want [a b]", got)
	}
	if got := slugs(public.Categories); !reflect.DeepEqual(got, []string{"learning", "data"}) {
		t.Fatalf("public categories = %v: labs (beta only), infra (restricted) and empty-for-everyone must vanish", got)
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
	if got := slugs(beta.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "labs"}) {
		t.Fatalf("beta reader categories = %v", got)
	}

	// Group held, beta off: the restricted category and its services appear,
	// the beta one still does not.
	holder := snap.VisibleTo([]string{"it-infra"}, false)
	if got := ids(holder.Services); !reflect.DeepEqual(got, []string{"a", "b", "i", "m"}) {
		t.Fatalf("holder services = %v, want [a b i m]", got)
	}
	if got := slugs(holder.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "infra"}) {
		t.Fatalf("holder categories = %v", got)
	}

	both := snap.VisibleTo([]string{"it-infra", "unknown"}, true)
	if got := ids(both.Services); !reflect.DeepEqual(got, []string{"a", "b", "x", "i", "m"}) {
		t.Fatalf("both services = %v", got)
	}
	// Four of the five: "empty-for-everyone" has no service for any reader.
	if got := slugs(both.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "labs", "infra"}) {
		t.Fatalf("both categories = %v", got)
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
	if got := slugs(public.Categories); !reflect.DeepEqual(got, []string{"learning", "data"}) {
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

// Regression, RULE CHANGED by issue #139 (docs/specs/empty-facets.md §2).
//
// This test used to assert that with no restricted category and no beta service
// the view was byte-identical to the RAW catalog — including a category no
// service was filed under. That half of the contract was reversed deliberately:
// an unused category rendered as a filter pill that led to an empty page, so
// narrowing now drops every category without a visible service, for every
// reader and every reason it is empty. The payload of a deployment that has an
// unused category therefore differs from the raw catalog by exactly that
// category, and that difference is the point of #139.
//
// What the test still guards, because those properties did NOT change:
//   - the SERVICES list is untouched by narrowing when nothing is restricted or
//     beta-tagged, for every reader;
//   - such a deployment is served ONE shared view, handed out without copying;
//   - a category with services is never dropped.
func TestUnrestrictedCatalogKeepsEveryServiceAndDropsOnlyEmptyCategories(t *testing.T) {
	services := []Service{
		{ID: "a", Name: "Alpha", Categories: []string{"learning"}, Description: map[string]string{"de": "A"}},
		{ID: "b", Name: "Beta", Categories: []string{}, DocOnly: true, Tag: "wartung"},
	}
	categories := []Category{{Slug: "learning", Sort: 10}, {Slug: "empty", Sort: 20}}
	snap := NewSnapshot(services, categories)

	wantServices, err := json.Marshal(services)
	if err != nil {
		t.Fatal(err)
	}
	for _, held := range [][]string{nil, {}, {"it-infra"}, {"anything", "else"}} {
		for _, showBeta := range []bool{false, true} {
			view := snap.VisibleTo(held, showBeta)
			got, err := json.Marshal(view.Services)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != string(wantServices) {
				t.Errorf("held=%v beta=%v: services differ from the raw catalog:\n got %s\nwant %s", held, showBeta, got, wantServices)
			}
			if view != snap.public {
				t.Errorf("held=%v beta=%v: an unrestricted catalog must serve the shared view, not a copy", held, showBeta)
			}
		}
	}
	// The reversed half: "empty" is gone, "learning" (which has a service) stays.
	if got := slugs(snap.VisibleTo(nil, false).Categories); !reflect.DeepEqual(got, []string{"learning"}) {
		t.Errorf("categories = %v, want only the populated one", got)
	}
}

// The three ways a category can end up with no visible service all drop it —
// one rule, not three special cases (docs/specs/empty-facets.md §2).
func TestEveryKindOfEmptyCategoryIsDropped(t *testing.T) {
	snap := NewSnapshot(
		[]Service{
			{ID: "keep", Categories: []string{"kept"}},
			{ID: "x", Categories: []string{"labs"}, Tag: TagBeta},
			{ID: "i", Categories: []string{"infra"}},
		},
		[]Category{
			{Slug: "kept", Sort: 10},
			{Slug: "never-used", Sort: 20},                    // no service anywhere
			{Slug: "labs", Sort: 30},                          // only a beta service
			{Slug: "infra", Sort: 40, Visibility: "it-infra"}, // restricted, unheld
		},
	)
	if got := slugs(snap.VisibleTo(nil, false).Categories); !reflect.DeepEqual(got, []string{"kept"}) {
		t.Fatalf("categories = %v, want only [kept]", got)
	}
	// Each reason, undone in turn, brings its category back.
	if got := slugs(snap.VisibleTo(nil, true).Categories); !reflect.DeepEqual(got, []string{"kept", "labs"}) {
		t.Fatalf("beta reader categories = %v, want [kept labs]", got)
	}
	if got := slugs(snap.VisibleTo([]string{"it-infra"}, false).Categories); !reflect.DeepEqual(got, []string{"kept", "infra"}) {
		t.Fatalf("holder categories = %v, want [kept infra]", got)
	}
	// "never-used" has no such reason: nothing brings it back.
	if got := slugs(snap.VisibleTo([]string{"it-infra"}, true).Categories); slices.Contains(got, "never-used") {
		t.Fatalf("categories = %v, want no unused category for any reader", got)
	}
}

// A catalog whose ONLY category is unused still narrows: the fast path in
// NewSnapshot must notice the empty category even though nothing is restricted
// and nothing is beta-tagged.
func TestEmptyCategoryIsDroppedWithoutRestrictionOrBeta(t *testing.T) {
	snap := NewSnapshot(
		[]Service{{ID: "a", Categories: []string{}}},
		[]Category{{Slug: "never-used", Sort: 10}},
	)
	if got := slugs(snap.VisibleTo(nil, false).Categories); len(got) != 0 {
		t.Fatalf("categories = %v, want none", got)
	}
	if n := len(snap.VisibleTo(nil, false).Services); n != 1 {
		t.Fatalf("services = %d, want the uncategorized service kept", n)
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
