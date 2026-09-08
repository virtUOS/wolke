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
// spec's §3 table (docs/specs/service-visibility.md §10): catalog, defaults,
// search, favourites, frequent, click. No database: every surface resolves ids
// through the catalog snapshot, so fakes hand out the restricted id and the
// narrowed view is what must refuse to resolve it.

const (
	publicID     = "11111111-1111-1111-1111-111111111111"
	restrictedID = "22222222-2222-2222-2222-222222222222"
)

func visibilityFixture(t *testing.T) (*catalog.Cache, config.VisibilitySet) {
	t.Helper()
	snap := catalog.NewSnapshot(
		[]catalog.Service{
			{ID: publicID, Name: "Public", Categories: []string{"data"}},
			{ID: restrictedID, Name: "Secret Lab", Categories: []string{"labs"}, Visibility: "experimental"},
		},
		[]catalog.Category{{Slug: "data", Sort: 10}, {Slug: "labs", Sort: 20}},
	)
	cache := catalog.NewCache(time.Minute, func(context.Context) (*catalog.Snapshot, error) { return snap, nil })
	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{{
		Slug: "experimental", Grant: config.GrantOptIn,
		Label:   map[string]string{"de": "Experimentell", "en": "Experimental"},
		Warning: map[string]string{"de": "Kann verschwinden.", "en": "May vanish."},
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

// nonHolder and holder are the same student; only the stored opt-in differs.
func nonHolder() store.User {
	return store.User{ID: pgtype.UUID{Valid: true}, PrimaryRole: "student", FavoritesSeeded: true, FavoritesOrder: "usage"}
}

func holder() store.User {
	u := nonHolder()
	u.VisibilityOptin = []string{"experimental"}
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

func assertOnlyPublic(t *testing.T, surface string, list []catalog.Service) {
	t.Helper()
	for _, s := range list {
		if s.ID == restrictedID || s.Visibility != "" {
			t.Fatalf("%s leaked the restricted service to a non-holder: %v", surface, names(list))
		}
	}
	if len(list) != 1 || list[0].ID != publicID {
		t.Fatalf("%s for a non-holder = %v, want just the public service", surface, names(list))
	}
}

func assertBoth(t *testing.T, surface string, list []catalog.Service) {
	t.Helper()
	if len(list) != 2 {
		t.Fatalf("%s for a holder = %v, want both services", surface, names(list))
	}
	for _, s := range list {
		if s.ID == restrictedID && s.Visibility != "experimental" {
			t.Fatalf("%s: the restricted service must carry its slug for the badge, got %+v", surface, s)
		}
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
		// And the raw response must not even mention the slug.
		if strings.Contains(rec.Body.String(), "experimental") || strings.Contains(rec.Body.String(), "labs") {
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

// /api/me exposes the held set, the user's own opt-in list, and the entries a
// user may learn about: opt-in ones plus the labels of held slugs — never a
// claim group they do not hold (that name is what category narrowing protects).
// Admins get every entry; the service form needs them. Nothing when nothing is
// configured.
func TestMeExposesVisibility(t *testing.T) {
	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{
		{Slug: "experimental", Grant: config.GrantOptIn, Label: map[string]string{"de": "Experimentell"}, Warning: map[string]string{"de": "Kann verschwinden."}},
		{Slug: "it-infra", Grant: config.GrantClaim, Claim: "groups", Match: "x", Label: map[string]string{"de": "IT-Infrastruktur"}},
	}}).Visibility()

	entrySlugs := func(b meResponse) []string {
		out := []string{}
		for _, e := range b.Visibility.Entries {
			out = append(out, e.Slug)
		}
		return out
	}

	// A non-admin non-holder learns about the opt-in group only.
	rec := httptest.NewRecorder()
	me(vis)(rec, reqWithUser(http.MethodGet, "/api/me", "", nonHolder()))
	var body meResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := entrySlugs(body); len(got) != 1 || got[0] != "experimental" {
		t.Errorf("non-holder entries = %v, want [experimental] only", got)
	}
	if strings.Contains(rec.Body.String(), "IT-Infrastruktur") || strings.Contains(rec.Body.String(), "it-infra") {
		t.Errorf("/api/me leaks a claim group the user does not hold: %s", rec.Body.String())
	}

	// Holding the claim slug reveals its label (for the badge).
	claimHolder := nonHolder()
	claimHolder.VisibilityClaims = []string{"it-infra"}
	rec = httptest.NewRecorder()
	me(vis)(rec, reqWithUser(http.MethodGet, "/api/me", "", claimHolder))
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := entrySlugs(body); len(got) != 2 {
		t.Errorf("claim holder entries = %v, want both", got)
	}

	// An admin sees the whole list: the service form offers every group.
	adminUser := nonHolder()
	adminUser.IsAdmin = true
	rec = httptest.NewRecorder()
	me(vis)(rec, reqWithUser(http.MethodGet, "/api/me", "", adminUser))
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := entrySlugs(body); len(got) != 2 {
		t.Errorf("admin entries = %v, want both", got)
	}

	rec = httptest.NewRecorder()
	me(vis)(rec, reqWithUser(http.MethodGet, "/api/me", "", holder()))
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Visibility.Held) != 1 || body.Visibility.Held[0] != "experimental" {
		t.Errorf("held = %v, want [experimental]", body.Visibility.Held)
	}
	if len(body.Visibility.OptIn) != 1 || body.Visibility.OptIn[0] != "experimental" {
		t.Errorf("optin = %v, want [experimental]", body.Visibility.OptIn)
	}
	if len(body.Visibility.Entries) != 1 || body.Visibility.Entries[0].Warning["de"] != "Kann verschwinden." {
		t.Errorf("entries = %+v, want the configured entry with its warning", body.Visibility.Entries)
	}

	// A stored opt-in for a slug the deployment no longer configures is not "on".
	rec = httptest.NewRecorder()
	me(config.VisibilitySet{})(rec, reqWithUser(http.MethodGet, "/api/me", "", holder()))
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Visibility.Held) != 0 || len(body.Visibility.OptIn) != 0 || len(body.Visibility.Entries) != 0 {
		t.Errorf("unconfigured: visibility = %+v, want all empty", body.Visibility)
	}
	// Empty lists, not null — the SPA iterates them.
	if !strings.Contains(rec.Body.String(), `"held":[]`) || !strings.Contains(rec.Body.String(), `"entries":[]`) {
		t.Errorf("empty lists must serialize as [] not null: %s", rec.Body.String())
	}
}

type fakeVisibilityStore struct {
	got   []string
	calls int
}

func (f *fakeVisibilityStore) UpdateUserVisibilityOptIn(_ context.Context, arg store.UpdateUserVisibilityOptInParams) (store.User, error) {
	f.calls++
	f.got = arg.Optin
	u := nonHolder()
	u.VisibilityOptin = arg.Optin
	return u, nil
}

// PUT /api/me/visibility writes the opt-in list through the service layer and
// answers with the refreshed /api/me shape; a claim slug cannot be self-granted.
func TestSetVisibilityOptInHandler(t *testing.T) {
	_, vis := visibilityFixture(t)
	db := &fakeVisibilityStore{}
	h := setVisibilityOptIn(db, vis)

	rec := httptest.NewRecorder()
	h(rec, reqWithUser(http.MethodPut, "/api/me/visibility", `{"optin":["experimental"]}`, nonHolder()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var body meResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Visibility.Held) != 1 || body.Visibility.Held[0] != "experimental" {
		t.Errorf("held after opt-in = %v", body.Visibility.Held)
	}

	rec = httptest.NewRecorder()
	h(rec, reqWithUser(http.MethodPut, "/api/me/visibility", `{"optin":["it-infra"]}`, nonHolder()))
	if rec.Code != http.StatusBadRequest || db.calls != 1 {
		t.Fatalf("unknown slug: status = %d, writes = %d; want 400 and no write", rec.Code, db.calls)
	}

	rec = httptest.NewRecorder()
	h(rec, reqWithUser(http.MethodPut, "/api/me/visibility", `{"optin":[]}`, holder()))
	if rec.Code != http.StatusOK || len(db.got) != 0 {
		t.Fatalf("opt-out: status = %d, stored = %v; want 200 and an empty list", rec.Code, db.got)
	}
}
