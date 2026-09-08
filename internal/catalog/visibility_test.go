package catalog

import (
	"encoding/json"
	"reflect"
	"testing"
)

func fixture() ([]Service, []Category) {
	services := []Service{
		{ID: "a", Name: "Alpha", Categories: []string{"learning"}},
		{ID: "b", Name: "Beta", Categories: []string{"data"}, DocOnly: true},
		{ID: "x", Name: "Xperiment", Categories: []string{"labs"}, Visibility: "experimental"},
		{ID: "i", Name: "Infra", Categories: []string{"data", "infra"}, Visibility: "it-infra"},
	}
	categories := []Category{
		{Slug: "learning", Sort: 10}, {Slug: "data", Sort: 20},
		{Slug: "labs", Sort: 30}, {Slug: "infra", Sort: 40},
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

// A non-holder sees public services only, and the categories that filtering
// emptied are gone — no empty "IT-Infrastruktur" pill leaking the group's name.
// A category that is empty for everyone stays, exactly as today.
func TestVisibleToNarrowsServicesAndCategories(t *testing.T) {
	snap := NewSnapshot(fixture())

	public := snap.VisibleTo(nil)
	if got := ids(public.Services); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("public services = %v, want [a b]", got)
	}
	if got := slugs(public.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "empty-for-everyone"}) {
		t.Fatalf("public categories = %v: labs and infra must vanish, empty-for-everyone must stay", got)
	}
	if _, ok := public.ServiceByID("x"); ok {
		t.Fatal("ServiceByID resolved a restricted service for a non-holder")
	}
	if _, ok := public.ServiceByID("a"); !ok {
		t.Fatal("ServiceByID lost a public service")
	}

	holder := snap.VisibleTo([]string{"experimental"})
	if got := ids(holder.Services); !reflect.DeepEqual(got, []string{"a", "b", "x"}) {
		t.Fatalf("experimental holder services = %v, want [a b x]", got)
	}
	if got := slugs(holder.Categories); !reflect.DeepEqual(got, []string{"learning", "data", "labs", "empty-for-everyone"}) {
		t.Fatalf("experimental holder categories = %v", got)
	}
	if svc, ok := holder.ServiceByID("x"); !ok || svc.Visibility != "experimental" {
		t.Fatalf("holder ServiceByID(x) = %+v, %v; want the badged service", svc, ok)
	}
	if _, ok := holder.ServiceByID("i"); ok {
		t.Fatal("holding one slug must not unlock another")
	}

	both := snap.VisibleTo([]string{"it-infra", "experimental", "unknown"})
	if got := ids(both.Services); !reflect.DeepEqual(got, []string{"a", "b", "x", "i"}) {
		t.Fatalf("both services = %v", got)
	}
	if len(both.Categories) != 5 {
		t.Fatalf("both categories = %v, want all five", slugs(both.Categories))
	}
}

// Regression (spec §10): with no restricted service — the unconfigured
// deployment — the view is byte-identical to the raw catalog, for every held
// set, and costs no copy.
func TestUnrestrictedCatalogIsByteIdentical(t *testing.T) {
	services := []Service{
		{ID: "a", Name: "Alpha", Categories: []string{"learning"}, Description: map[string]string{"de": "A"}},
		{ID: "b", Name: "Beta", Categories: []string{}, DocOnly: true, Tag: "beta"},
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
	for _, held := range [][]string{nil, {}, {"experimental"}, {"anything", "else"}} {
		view := snap.VisibleTo(held)
		got, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("held=%v: view JSON differs from the raw catalog:\n got %s\nwant %s", held, got, want)
		}
		if view != snap.public {
			t.Errorf("held=%v: an unrestricted catalog must serve the shared view, not a copy", held)
		}
	}
	// And the "empty" category is still there: only filtering may drop one.
	if got := slugs(snap.VisibleTo(nil).Categories); !reflect.DeepEqual(got, []string{"learning", "empty"}) {
		t.Errorf("categories = %v, want both", got)
	}
}

// A slug the deployment no longer configures fails closed: nobody holds it, so
// the service is invisible rather than public. (Held sets come from
// config.VisibilitySet.Held, which never yields an unconfigured slug.)
func TestUnheldSlugFailsClosed(t *testing.T) {
	snap := NewSnapshot([]Service{{ID: "x", Visibility: "gone"}}, nil)
	if n := len(snap.VisibleTo(nil).Services); n != 0 {
		t.Fatalf("public view has %d services, want 0", n)
	}
	if n := len(snap.VisibleTo([]string{"other"}).Services); n != 0 {
		t.Fatalf("view has %d services, want 0", n)
	}
}

// The zero Snapshot (what the cache tests build) is usable and empty.
func TestZeroSnapshotIsEmpty(t *testing.T) {
	var snap Snapshot
	view := snap.VisibleTo(nil)
	if view == nil {
		// A zero snapshot has no prebuilt view; VisibleTo must still answer.
		t.Fatal("VisibleTo returned nil for the zero Snapshot")
	}
	if len(view.Services) != 0 || len(view.Categories) != 0 {
		t.Fatal("zero Snapshot should be empty")
	}
}
