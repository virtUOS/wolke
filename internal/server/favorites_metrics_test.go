package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/metrics"
	"github.com/virtuos/wolke/internal/store"
)

// favStore is a FavoritesStore that reports every write as having changed a
// row, which is what the counters key off.
type favStore struct {
	fakeFavorites
	removed int
}

func (f *favStore) AddFavorite(context.Context, store.AddFavoriteParams) (int64, error) {
	return 1, nil
}

func (f *favStore) RemoveFavorite(context.Context, store.RemoveFavoriteParams) (int64, error) {
	f.removed++
	return 1, nil
}

func scrapeText(t *testing.T, m *metrics.Metrics) string {
	t.Helper()
	rec := httptest.NewRecorder()
	m.Handler("").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	return rec.Body.String()
}

// The star toggle increments its own counter and only its own, labelled with
// the service NAME (as on wolke_service_clicks_total) and the user's role.
func TestFavoriteToggleCounters(t *testing.T) {
	cache, vis := visibilityFixture(t)
	m := metrics.New()
	db := &favStore{}
	body := `{"service_id":"` + publicID + `"}`

	rec := httptest.NewRecorder()
	addFavorite(db, cache, vis, m)(rec, reqWithUser(http.MethodPost, "/api/favorites/items", body, nonHolder()))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("add = %d, want 204", rec.Code)
	}
	scrape := scrapeText(t, m)
	if !strings.Contains(scrape, `wolke_service_favorites_added_total{role="student",service="Public"} 1`) {
		t.Errorf("after add, scrape missing the added series:\n%s", scrape)
	}
	if strings.Contains(scrape, "wolke_service_favorites_removed_total") {
		t.Errorf("adding a favorite touched the removed counter:\n%s", scrape)
	}

	rec = httptest.NewRecorder()
	removeFavorite(db, cache, vis, m)(rec, reqWithUser(http.MethodDelete, "/api/favorites/items", body, nonHolder()))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204", rec.Code)
	}
	scrape = scrapeText(t, m)
	if !strings.Contains(scrape, `wolke_service_favorites_removed_total{role="student",service="Public"} 1`) {
		t.Errorf("after remove, scrape missing the removed series:\n%s", scrape)
	}
	if !strings.Contains(scrape, `wolke_service_favorites_added_total{role="student",service="Public"} 1`) {
		t.Errorf("removing moved the added counter:\n%s", scrape)
	}
}

// An un-starred service the reader cannot see is still removed — and is not
// counted, because there is no name to label the series with that this reader
// was actually shown.
func TestRemovingAnInvisibleFavoriteIsUncounted(t *testing.T) {
	cache, vis := visibilityFixture(t)
	m := metrics.New()
	db := &favStore{}

	rec := httptest.NewRecorder()
	removeFavorite(db, cache, vis, m)(rec,
		reqWithUser(http.MethodDelete, "/api/favorites/items", `{"service_id":"`+restrictedID+`"}`, nonHolder()))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("remove = %d, want 204 (an invisible favorite must stay removable)", rec.Code)
	}
	if db.removed != 1 {
		t.Errorf("RemoveFavorite called %d times, want 1", db.removed)
	}
	if strings.Contains(scrapeText(t, m), "wolke_service_favorites_removed_total") {
		t.Errorf("an unnameable service minted a series")
	}
}

// The role label is the EFFECTIVE role — the same rule the favorites gauge
// applies (config.RoleSet.Effective, via withEffectiveRole where the session is
// loaded). A user left behind on a role this deployment no longer configures
// counts under the default instead of minting a series the gauge can never
// have (#228).
func TestFavoriteCounterUsesTheEffectiveRole(t *testing.T) {
	cache, vis := visibilityFixture(t)
	roles := twoRoleSet() // staff + student, student the default
	stale := nonHolder()
	stale.PrimaryRole = "visiting-scholar" // gone from the configured set
	user := withEffectiveRole(stale, roles)

	m := metrics.New()
	rec := httptest.NewRecorder()
	addFavorite(&favStore{}, cache, vis, m)(rec,
		reqWithUser(http.MethodPost, "/api/favorites/items", `{"service_id":"`+publicID+`"}`, user))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("add = %d, want 204", rec.Code)
	}
	if roles.Default() != "student" {
		t.Fatalf("fixture default role = %q, want student", roles.Default())
	}
	want := `wolke_service_favorites_added_total{role="student",service="Public"} 1`
	if scrape := scrapeText(t, m); !strings.Contains(scrape, want) {
		t.Errorf("scrape missing %q — a stale role must fold onto the default:\n%s", want, scrape)
	}
}
