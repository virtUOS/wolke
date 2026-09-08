package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/metrics"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// One "a non-holder cannot obtain this service" test per read surface in the
// spec's §3 table (docs/specs/service-visibility.md §6): catalog, defaults,
// search, favourites, frequent, click — and the same again for a beta service
// and a reader who has not asked for beta. No database: every surface resolves
// ids through the catalog snapshot, so the fakes hand out every id and the
// narrowed view is what must refuse to resolve them.

const (
	publicID     = "11111111-1111-1111-1111-111111111111"
	restrictedID = "22222222-2222-2222-2222-222222222222"
	betaID       = "44444444-4444-4444-4444-444444444444"
)

func visibilityFixture(t *testing.T) (*catalog.Cache, config.VisibilitySet) {
	t.Helper()
	snap := catalog.NewSnapshot(
		[]catalog.Service{
			{ID: publicID, Name: "Public", Categories: []string{"data"}},
			{ID: restrictedID, Name: "Secret Lab", Categories: []string{"labs"}},
			{ID: betaID, Name: "Beta Thing", Categories: []string{"data"}, Tag: catalog.TagBeta},
		},
		[]catalog.Category{
			{Slug: "data", Sort: 10},
			{Slug: "labs", Sort: 20, Visibility: "it-infra"},
		},
	)
	cache := catalog.NewCache(time.Minute, func(context.Context) (*catalog.Snapshot, error) { return snap, nil })
	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{{
		Slug: "it-infra", Claim: "groups", Match: "it-service-admins",
		Label: map[string]string{"de": "IT-Infrastruktur", "en": "IT infrastructure"},
	}}}).Visibility()
	return cache, vis
}

func mustParseUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	u, ok := parseUUID(s)
	if !ok {
		t.Fatalf("bad uuid %q", s)
	}
	return u
}

// nonHolder, holder and betaReader are the same student; only what the IdP
// granted, or what they asked for, differs.
func nonHolder() store.User {
	return store.User{ID: pgtype.UUID{Valid: true}, PrimaryRole: "student", FavoritesSeeded: true, FavoritesOrder: "usage"}
}

func holder() store.User {
	u := nonHolder()
	u.VisibilityClaims = []string{"it-infra"}
	return u
}

func betaReader() store.User {
	u := nonHolder()
	u.ShowBeta = true
	return u
}

// serve runs a handler for a user and decodes the "services" list of the body.
func serveServices(t *testing.T, h http.HandlerFunc, method, target, body string, user store.User) []catalog.Service {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, reqWithUser(method, target, body, user))
	if rec.Code != http.StatusOK {
		t.Fatalf("%s %s: status = %d, body %s", method, target, rec.Code, rec.Body.String())
	}
	var out struct {
		Services []catalog.Service `json:"services"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out.Services
}

func names(list []catalog.Service) []string {
	out := make([]string, 0, len(list))
	for _, s := range list {
		out = append(out, s.Name)
	}
	return out
}

// assertOnlyPublic: the reader got the public service and nothing else —
// neither the restricted one nor the beta one, whichever the fake handed out.
func assertOnlyPublic(t *testing.T, surface string, list []catalog.Service) {
	t.Helper()
	for _, s := range list {
		if s.ID == restrictedID {
			t.Fatalf("%s leaked the restricted service to a non-holder: %v", surface, names(list))
		}
		if s.ID == betaID {
			t.Fatalf("%s leaked a beta service to a reader who did not ask for beta: %v", surface, names(list))
		}
	}
	if len(list) != 1 || list[0].ID != publicID {
		t.Fatalf("%s for a plain reader = %v, want just the public service", surface, names(list))
	}
}

func assertBoth(t *testing.T, surface string, list []catalog.Service) {
	t.Helper()
	if len(list) != 2 {
		t.Fatalf("%s = %v, want both services", surface, names(list))
	}
}

// --- fakes: each hands out BOTH ids; the view must drop the restricted one ---

type fakeDefaults struct{ ids []pgtype.UUID }

func (f fakeDefaults) GetRoleDefaults(context.Context, string) ([]pgtype.UUID, error) {
	return f.ids, nil
}

type fakeSearch struct {
	ids    []pgtype.UUID
	logged []int32
}

func (f *fakeSearch) SearchServiceIDs(context.Context, string) ([]pgtype.UUID, error) {
	return f.ids, nil
}
func (f *fakeSearch) InsertSearchEvent(_ context.Context, arg store.InsertSearchEventParams) error {
	f.logged = append(f.logged, arg.ResultCount)
	return nil
}

type fakeFavorites struct {
	service.FavoritesStore // nil: only the methods below are reached
	ids                    []pgtype.UUID
	added                  *int
}

func (f fakeFavorites) ListFavoritesByUsage(context.Context, pgtype.UUID) ([]pgtype.UUID, error) {
	return f.ids, nil
}
func (f fakeFavorites) NextFavoriteSort(context.Context, pgtype.UUID) (int32, error) { return 0, nil }
func (f fakeFavorites) AddFavorite(context.Context, store.AddFavoriteParams) error {
	*f.added++
	return nil
}

type fakeUsage struct {
	ids      []pgtype.UUID
	recorded *int
}

func (f fakeUsage) RecordClick(context.Context, store.RecordClickParams) error {
	if f.recorded != nil {
		*f.recorded++
	}
	return nil
}
func (f fakeUsage) FrequentServiceIDs(context.Context, store.FrequentServiceIDsParams) ([]pgtype.UUID, error) {
	return f.ids, nil
}

func TestNonHolderCannotObtainRestrictedService(t *testing.T) {
	cache, vis := visibilityFixture(t)
	both := []pgtype.UUID{mustParseUUID(t, publicID), mustParseUUID(t, restrictedID)}

	t.Run("catalog", func(t *testing.T) {
		rec := httptest.NewRecorder()
		catalogList(cache, vis)(rec, reqWithUser(http.MethodGet, "/api/catalog", "", nonHolder()))
		var body struct {
			Services   []catalog.Service  `json:"services"`
			Categories []catalog.Category `json:"categories"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		assertOnlyPublic(t, "/api/catalog", body.Services)
		if len(body.Categories) != 1 || body.Categories[0].Slug != "data" {
			t.Fatalf("categories = %+v: the emptied 'labs' category must vanish for a non-holder", body.Categories)
		}
		// And the raw response must not even mention the group or its category.
		if strings.Contains(rec.Body.String(), "it-infra") || strings.Contains(rec.Body.String(), "labs") {
			t.Fatalf("response leaks the restricted group: %s", rec.Body.String())
		}

		rec = httptest.NewRecorder()
		catalogList(cache, vis)(rec, reqWithUser(http.MethodGet, "/api/catalog", "", holder()))
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		assertBoth(t, "/api/catalog", body.Services)
		if len(body.Categories) != 2 {
			t.Fatalf("holder categories = %+v, want both", body.Categories)
		}
	})

	t.Run("defaults", func(t *testing.T) {
		h := catalogDefaults(cache, fakeDefaults{both}, vis)
		assertOnlyPublic(t, "/api/catalog/defaults", serveServices(t, h, http.MethodGet, "/api/catalog/defaults", "", nonHolder()))
		assertBoth(t, "/api/catalog/defaults", serveServices(t, h, http.MethodGet, "/api/catalog/defaults", "", holder()))
	})

	t.Run("search", func(t *testing.T) {
		s := &fakeSearch{ids: both}
		h := search(cache, s, vis)
		assertOnlyPublic(t, "/api/search", serveServices(t, h, http.MethodGet, "/api/search?q=secret", "", nonHolder()))
		assertBoth(t, "/api/search", serveServices(t, h, http.MethodGet, "/api/search?q=secret", "", holder()))
		// The zero-result insights log the catalog's match count, not the
		// viewer's slice: a non-holder's search for a restricted name is not a
		// keyword gap for the admin worklist (review finding 5).
		if len(s.logged) != 2 || s.logged[0] != 2 || s.logged[1] != 2 {
			t.Fatalf("logged result counts = %v, want [2 2] (pre-narrowing) for both viewers", s.logged)
		}
	})

	t.Run("favorites", func(t *testing.T) {
		h := listFavorites(cache, fakeFavorites{ids: both}, vis)
		assertOnlyPublic(t, "/api/favorites", serveServices(t, h, http.MethodGet, "/api/favorites", "", nonHolder()))
		assertBoth(t, "/api/favorites", serveServices(t, h, http.MethodGet, "/api/favorites", "", holder()))
	})

	t.Run("frequent", func(t *testing.T) {
		h := frequent(cache, fakeUsage{ids: both}, vis)
		assertOnlyPublic(t, "/api/usage/frequent", serveServices(t, h, http.MethodGet, "/api/usage/frequent", "", nonHolder()))
		assertBoth(t, "/api/usage/frequent", serveServices(t, h, http.MethodGet, "/api/usage/frequent", "", holder()))
	})

	t.Run("click", func(t *testing.T) {
		m := metrics.New()
		recorded := 0
		h := recordClick(fakeUsage{recorded: &recorded}, cache, m, vis)
		body := `{"service_id":"` + restrictedID + `"}`

		// Non-holder: nothing recorded, no metric series, and the same 204 an
		// unknown id gets — no existence oracle in the status.
		rec := httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/events/click", body, nonHolder()))
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", rec.Code)
		}
		if recorded != 0 {
			t.Fatalf("a non-holder's click wrote %d usage rows for the restricted service, want 0", recorded)
		}
		if n := testutil.CollectAndCount(m.ClicksTotal); n != 0 {
			t.Fatalf("a non-holder's click minted %d click series naming the restricted service, want 0", n)
		}
		rec = httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/events/click", `{"service_id":"33333333-3333-3333-3333-333333333333"}`, nonHolder()))
		if rec.Code != http.StatusNoContent || recorded != 0 {
			t.Fatalf("unknown id: status = %d, recorded = %d; want 204 and nothing recorded", rec.Code, recorded)
		}

		rec = httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/events/click", body, holder()))
		if rec.Code != http.StatusNoContent || recorded != 1 {
			t.Fatalf("holder: status = %d, recorded = %d; want 204 and one row", rec.Code, recorded)
		}
		if got := testutil.ToFloat64(m.ClicksTotal.WithLabelValues("Secret Lab", "student", "service")); got != 1 {
			t.Fatalf("holder click counter = %v, want 1", got)
		}
	})

	t.Run("add favorite", func(t *testing.T) {
		added := 0
		h := addFavorite(fakeFavorites{added: &added}, cache, vis)
		body := `{"service_id":"` + restrictedID + `"}`

		// Non-holder: not stored, and the same 404 an unknown id gets.
		rec := httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/favorites/items", body, nonHolder()))
		if rec.Code != http.StatusNotFound || added != 0 {
			t.Fatalf("non-holder: status = %d, added = %d; want 404 and nothing stored", rec.Code, added)
		}
		rec = httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/favorites/items", `{"service_id":"33333333-3333-3333-3333-333333333333"}`, nonHolder()))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("unknown id: status = %d, want 404 (indistinguishable from restricted)", rec.Code)
		}

		rec = httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/favorites/items", body, holder()))
		if rec.Code != http.StatusNoContent || added != 1 {
			t.Fatalf("holder: status = %d, added = %d; want 204 and one row", rec.Code, added)
		}
	})
}

// The same sweep for the beta half of the predicate: a beta service is absent
// from every surface until the user asks for beta services, then present on all
// of them — inline, in its own category, badged by the tag it already had
// (docs/specs/service-visibility.md §2.1).
func TestBetaServiceHiddenUntilTheUserAsksForIt(t *testing.T) {
	cache, vis := visibilityFixture(t)
	both := []pgtype.UUID{mustParseUUID(t, publicID), mustParseUUID(t, betaID)}

	t.Run("catalog", func(t *testing.T) {
		rec := httptest.NewRecorder()
		catalogList(cache, vis)(rec, reqWithUser(http.MethodGet, "/api/catalog", "", nonHolder()))
		var body struct {
			Services   []catalog.Service  `json:"services"`
			Categories []catalog.Category `json:"categories"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		assertOnlyPublic(t, "/api/catalog", body.Services)

		rec = httptest.NewRecorder()
		catalogList(cache, vis)(rec, reqWithUser(http.MethodGet, "/api/catalog", "", betaReader()))
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		assertBoth(t, "/api/catalog", body.Services)
		// It stays in its own category, and keeps the badge the admin set.
		for _, s := range body.Services {
			if s.ID == betaID {
				if len(s.Categories) != 1 || s.Categories[0] != "data" {
					t.Errorf("a revealed beta service must stay in its own category, got %v", s.Categories)
				}
				if s.Tag != catalog.TagBeta {
					t.Errorf("tag = %q, want beta — the badge is the tag, there is no second one", s.Tag)
				}
			}
		}
	})

	t.Run("defaults", func(t *testing.T) {
		h := catalogDefaults(cache, fakeDefaults{both}, vis)
		assertOnlyPublic(t, "/api/catalog/defaults", serveServices(t, h, http.MethodGet, "/api/catalog/defaults", "", nonHolder()))
		assertBoth(t, "/api/catalog/defaults", serveServices(t, h, http.MethodGet, "/api/catalog/defaults", "", betaReader()))
	})

	t.Run("search", func(t *testing.T) {
		h := search(cache, &fakeSearch{ids: both}, vis)
		assertOnlyPublic(t, "/api/search", serveServices(t, h, http.MethodGet, "/api/search?q=beta", "", nonHolder()))
		assertBoth(t, "/api/search", serveServices(t, h, http.MethodGet, "/api/search?q=beta", "", betaReader()))
	})

	t.Run("favorites", func(t *testing.T) {
		h := listFavorites(cache, fakeFavorites{ids: both}, vis)
		assertOnlyPublic(t, "/api/favorites", serveServices(t, h, http.MethodGet, "/api/favorites", "", nonHolder()))
		assertBoth(t, "/api/favorites", serveServices(t, h, http.MethodGet, "/api/favorites", "", betaReader()))
	})

	t.Run("frequent", func(t *testing.T) {
		h := frequent(cache, fakeUsage{ids: both}, vis)
		assertOnlyPublic(t, "/api/usage/frequent", serveServices(t, h, http.MethodGet, "/api/usage/frequent", "", nonHolder()))
		assertBoth(t, "/api/usage/frequent", serveServices(t, h, http.MethodGet, "/api/usage/frequent", "", betaReader()))
	})

	t.Run("click", func(t *testing.T) {
		recorded := 0
		h := recordClick(fakeUsage{recorded: &recorded}, cache, metrics.New(), vis)
		body := `{"service_id":"` + betaID + `"}`

		rec := httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/events/click", body, nonHolder()))
		if rec.Code != http.StatusNoContent || recorded != 0 {
			t.Fatalf("hidden beta click: status = %d, recorded = %d; want 204 and nothing recorded", rec.Code, recorded)
		}
		rec = httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/events/click", body, betaReader()))
		if rec.Code != http.StatusNoContent || recorded != 1 {
			t.Fatalf("revealed beta click: status = %d, recorded = %d; want 204 and one row", rec.Code, recorded)
		}
	})

	t.Run("add favorite", func(t *testing.T) {
		added := 0
		h := addFavorite(fakeFavorites{added: &added}, cache, vis)
		body := `{"service_id":"` + betaID + `"}`

		rec := httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/favorites/items", body, nonHolder()))
		if rec.Code != http.StatusNotFound || added != 0 {
			t.Fatalf("hidden beta: status = %d, added = %d; want 404 and nothing stored", rec.Code, added)
		}
		rec = httptest.NewRecorder()
		h(rec, reqWithUser(http.MethodPost, "/api/favorites/items", body, betaReader()))
		if rec.Code != http.StatusNoContent || added != 1 {
			t.Fatalf("revealed beta: status = %d, added = %d; want 204 and one row", rec.Code, added)
		}
	})
}

// /api/me exposes the held group slugs, the show_beta pref, and the entries a
// user may learn about: only the groups they hold — never one they do not (that
// name is what category narrowing protects). Admins get every entry; the
// category editor needs them. Nothing when nothing is configured.
func TestMeExposesVisibility(t *testing.T) {
	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{
		{Slug: "it-infra", Claim: "groups", Match: "x", Label: map[string]string{"de": "IT-Infrastruktur"}},
		{Slug: "net-ops", Claim: "groups", Match: "y", Label: map[string]string{"de": "Netzbetrieb"}},
	}}).Visibility()

	get := func(t *testing.T, u store.User, set config.VisibilitySet) (meResponse, string) {
		t.Helper()
		rec := httptest.NewRecorder()
		me(set)(rec, reqWithUser(http.MethodGet, "/api/me", "", u))
		var body meResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body, rec.Body.String()
	}
	entrySlugs := func(b meResponse) []string {
		out := []string{}
		for _, e := range b.Visibility.Entries {
			out = append(out, e.Slug)
		}
		return out
	}

	// A non-admin holding nothing learns about no group at all.
	body, raw := get(t, nonHolder(), vis)
	if got := entrySlugs(body); len(got) != 0 {
		t.Errorf("non-holder entries = %v, want none", got)
	}
	if strings.Contains(raw, "IT-Infrastruktur") || strings.Contains(raw, "it-infra") {
		t.Errorf("/api/me leaks a group the user does not hold: %s", raw)
	}

	// Holding one reveals that one — and only that one.
	body, raw = get(t, holder(), vis)
	if got := entrySlugs(body); len(got) != 1 || got[0] != "it-infra" {
		t.Errorf("holder entries = %v, want [it-infra]", got)
	}
	if len(body.Visibility.Held) != 1 || body.Visibility.Held[0] != "it-infra" {
		t.Errorf("held = %v, want [it-infra]", body.Visibility.Held)
	}
	if strings.Contains(raw, "net-ops") {
		t.Errorf("/api/me leaks the group the user does not hold: %s", raw)
	}

	// An admin sees the whole list: the category editor offers every group.
	adminUser := nonHolder()
	adminUser.IsAdmin = true
	body, _ = get(t, adminUser, vis)
	if got := entrySlugs(body); len(got) != 2 {
		t.Errorf("admin entries = %v, want both", got)
	}

	// show_beta is reported as the plain pref it is.
	if body, _ := get(t, nonHolder(), vis); body.ShowBeta {
		t.Error("show_beta must default to false")
	}
	if body, _ := get(t, betaReader(), vis); !body.ShowBeta {
		t.Error("show_beta must be reported once the user turned it on")
	}

	// A stored claim for a slug the deployment no longer configures is not held.
	body, raw = get(t, holder(), config.VisibilitySet{})
	if len(body.Visibility.Held) != 0 || len(body.Visibility.Entries) != 0 {
		t.Errorf("unconfigured: visibility = %+v, want all empty", body.Visibility)
	}
	// Empty lists, not null — the SPA iterates them.
	if !strings.Contains(raw, `"held":[]`) || !strings.Contains(raw, `"entries":[]`) {
		t.Errorf("empty lists must serialize as [] not null: %s", raw)
	}
}

// show_beta rides on PATCH /api/me/prefs like any other pref: the reveal is a
// preference, not a grant, so it needs no endpoint of its own (spec §4).
func TestShowBetaIsAnOrdinaryPref(t *testing.T) {
	_, vis := visibilityFixture(t)
	db := &fakePrefsStore{}
	h := updatePrefs(db, vis)
	user := nonHolder()
	user.Theme, user.ViewMode, user.Locale = "system", "auto", "auto"

	rec := httptest.NewRecorder()
	h(rec, reqWithUser(http.MethodPatch, "/api/me/prefs", `{"show_beta":true}`, user))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	if !db.got.ShowBeta {
		t.Error("the write did not carry show_beta")
	}
	var body meResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.ShowBeta {
		t.Error("the response must be the refreshed /api/me shape, with show_beta on")
	}

	// Unspecified fields keep their current value — turning beta on must not
	// reset the theme, and a later prefs write must not silently turn it off.
	on := user
	on.ShowBeta = true
	rec = httptest.NewRecorder()
	h(rec, reqWithUser(http.MethodPatch, "/api/me/prefs", `{"theme":"dark"}`, on))
	if !db.got.ShowBeta || db.got.Theme != "dark" {
		t.Errorf("params = %+v, want show_beta kept and theme changed", db.got)
	}

	// And it can be turned back off.
	rec = httptest.NewRecorder()
	h(rec, reqWithUser(http.MethodPatch, "/api/me/prefs", `{"show_beta":false}`, on))
	if rec.Code != http.StatusOK || db.got.ShowBeta {
		t.Errorf("status = %d, show_beta = %v; want 200 and false", rec.Code, db.got.ShowBeta)
	}
}
