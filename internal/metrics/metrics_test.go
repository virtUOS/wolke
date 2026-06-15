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
	m.IncClick("MyShare", "student")
	m.ObserveRequest("/api/catalog", "GET", 200, 0.01)

	_, body := scrape(t, m.Handler(""), "")
	for _, want := range []string{
		`wolke_service_clicks_total{role="student",service="MyShare"}`,
		"wolke_http_request_duration_seconds",
		"wolke_active_sessions",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("scrape missing %q", want)
		}
	}
}

type fakeGauges struct{}

func (fakeGauges) CountActiveSessions(context.Context) (int64, error) { return 7, nil }
func (fakeGauges) CountServicesByState(context.Context) ([]store.CountServicesByStateRow, error) {
	return []store.CountServicesByStateRow{{IsActive: true, N: 5}, {IsActive: false, N: 2}}, nil
}
func (fakeGauges) CountActiveAnnouncementsBySeverity(context.Context) ([]store.CountActiveAnnouncementsBySeverityRow, error) {
	return []store.CountActiveAnnouncementsBySeverityRow{{Severity: "warning", N: 1}}, nil
}

func TestRefreshGauges(t *testing.T) {
	m := New()
	if err := m.RefreshGauges(context.Background(), fakeGauges{}); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	for _, want := range []string{
		"wolke_active_sessions 7",
		`wolke_catalog_services{state="active"} 5`,
		`wolke_catalog_services{state="inactive"} 2`,
		`wolke_announcements_active{severity="warning"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("scrape missing %q", want)
		}
	}
}
