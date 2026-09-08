package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/store"
)

func scrape(t *testing.T, h http.Handler, auth string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec, rec.Body.String()
}

func TestMetricsTokenGating(t *testing.T) {
	m := New()
	h := m.Handler("s3cret")

	if rec, _ := scrape(t, h, ""); rec.Code != http.StatusForbidden {
		t.Errorf("no token = %d, want 403", rec.Code)
	}
	if rec, _ := scrape(t, h, "Bearer wrong"); rec.Code != http.StatusForbidden {
		t.Errorf("wrong token = %d, want 403", rec.Code)
	}
	if rec, _ := scrape(t, h, "Bearer s3cret"); rec.Code != http.StatusOK {
		t.Errorf("good token = %d, want 200", rec.Code)
	}
}

func TestMetricsUngatedWhenNoToken(t *testing.T) {
	m := New()
	if rec, _ := scrape(t, m.Handler(""), ""); rec.Code != http.StatusOK {
		t.Errorf("ungated = %d, want 200", rec.Code)
	}
}

func TestMetricsExposeSeries(t *testing.T) {
	m := New()
	m.IncClick("MyShare", "student", "service")
	m.IncClick("MyShare", "student", "documentation")
	m.ObserveRequest("/api/catalog", "GET", 200, 0.01)

	_, body := scrape(t, m.Handler(""), "")
	for _, want := range []string{
		`wolke_service_clicks_total{role="student",service="MyShare",target="service"} 1`,
		`wolke_service_clicks_total{role="student",service="MyShare",target="documentation"} 1`,
		"wolke_http_request_duration_seconds",
		"wolke_active_sessions",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("scrape missing %q", want)
		}
	}
}

// fakeGauges stands in for *store.DB. favorites is per-test so a refresh can
// be replayed with a service removed (the Reset case).
type fakeGauges struct {
	favorites []store.CountFavoritesByServiceRow
}

func (fakeGauges) CountActiveSessions(context.Context) (int64, error) { return 7, nil }
func (fakeGauges) CountServicesByState(context.Context) ([]store.CountServicesByStateRow, error) {
	return []store.CountServicesByStateRow{{IsActive: true, N: 5}, {IsActive: false, N: 2}}, nil
}
func (fakeGauges) CountActiveAnnouncementsBySeverity(context.Context) ([]store.CountActiveAnnouncementsBySeverityRow, error) {
	return []store.CountActiveAnnouncementsBySeverityRow{{Severity: "warning", N: 1}}, nil
}
func (f fakeGauges) CountFavoritesByService(context.Context) ([]store.CountFavoritesByServiceRow, error) {
	return f.favorites, nil
}

func TestRefreshGauges(t *testing.T) {
	m := New()
	src := fakeGauges{favorites: []store.CountFavoritesByServiceRow{
		{Name: "MyShare", N: 3},
		{Name: "Stud.IP", N: 12},
		{Name: "Unbeliebt", N: 0}, // nobody pinned it: an explicit zero, not a missing series
	}}
	if err := m.RefreshGauges(context.Background(), src); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	for _, want := range []string{
		"wolke_active_sessions 7",
		`wolke_catalog_services{state="active"} 5`,
		`wolke_catalog_services{state="inactive"} 2`,
		`wolke_announcements_active{severity="warning"} 1`,
		`wolke_service_favorites{service="MyShare"} 3`,
		`wolke_service_favorites{service="Stud.IP"} 12`,
		`wolke_service_favorites{service="Unbeliebt"} 0`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("scrape missing %q", want)
		}
	}
}

// A service that is soft-deleted or renamed drops out of the query, and its
// gauge series must go with it rather than freezing at its last value.
func TestRefreshGaugesDropsVanishedFavoritesSeries(t *testing.T) {
	m := New()
	before := fakeGauges{favorites: []store.CountFavoritesByServiceRow{
		{Name: "MyShare", N: 3},
		{Name: "Gone", N: 4},
	}}
	if err := m.RefreshGauges(context.Background(), before); err != nil {
		t.Fatalf("first RefreshGauges: %v", err)
	}
	if _, body := scrape(t, m.Handler(""), ""); !strings.Contains(body, `wolke_service_favorites{service="Gone"} 4`) {
		t.Fatalf("first scrape missing the series that should later drop:\n%s", body)
	}

	after := fakeGauges{favorites: []store.CountFavoritesByServiceRow{{Name: "MyShare", N: 3}}}
	if err := m.RefreshGauges(context.Background(), after); err != nil {
		t.Fatalf("second RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	if strings.Contains(body, `service="Gone"`) {
		t.Errorf("stale series for the removed service survived the refresh:\n%s", body)
	}
	if !strings.Contains(body, `wolke_service_favorites{service="MyShare"} 3`) {
		t.Errorf("surviving service lost its series:\n%s", body)
	}
}
