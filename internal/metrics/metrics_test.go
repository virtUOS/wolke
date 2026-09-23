package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
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
	m.IncFavoriteAdded("MyShare", "student")
	m.IncFavoriteRemoved("MyShare", "staff")

	_, body := scrape(t, m.Handler(""), "")
	for _, want := range []string{
		`wolke_service_clicks_total{role="student",service="MyShare",target="service"} 1`,
		`wolke_service_clicks_total{role="student",service="MyShare",target="documentation"} 1`,
		"wolke_http_request_duration_seconds",
		`wolke_service_favorites_added_total{role="student",service="MyShare"} 1`,
		`wolke_service_favorites_removed_total{role="staff",service="MyShare"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("scrape missing %q", want)
		}
	}
}

// fakeGauges stands in for *store.DB. sessions and favorites are per-test so a
// refresh can be replayed with a role or a service removed (the Reset cases);
// gotRoles and gotSessionRoles record the role list the refresh handed each
// query.
type fakeGauges struct {
	sessions        []store.CountActiveSessionsByRoleRow
	favorites       []store.CountFavoritesByServiceAndRoleRow
	gotRoles        *[]string
	gotSessionRoles *[]string
}

func (f fakeGauges) CountActiveSessionsByRole(_ context.Context, roles []string) ([]store.CountActiveSessionsByRoleRow, error) {
	if f.gotSessionRoles != nil {
		*f.gotSessionRoles = roles
	}
	return f.sessions, nil
}
func (fakeGauges) CountServicesByState(context.Context) ([]store.CountServicesByStateRow, error) {
	return []store.CountServicesByStateRow{{IsActive: true, N: 5}, {IsActive: false, N: 2}}, nil
}
func (fakeGauges) CountActiveAnnouncementsBySeverity(context.Context) ([]store.CountActiveAnnouncementsBySeverityRow, error) {
	return []store.CountActiveAnnouncementsBySeverityRow{{Severity: "warning", N: 1}}, nil
}
func (f fakeGauges) CountFavoritesByServiceAndRole(_ context.Context, roles []string) ([]store.CountFavoritesByServiceAndRoleRow, error) {
	if f.gotRoles != nil {
		*f.gotRoles = roles
	}
	return f.favorites, nil
}

// testRoles is the configured role set the metrics tests refresh against:
// student and staff, defaulting to student (which is what a stored role the
// config no longer defines folds onto).
func testRoles() config.RoleSet {
	return config.RoleMapping{
		Values:     map[string]string{"member": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
	}.RoleSet()
}

// sessionZeros is what the session query's first branch emits: a zero for
// every configured role.
func sessionZeros(roles []string) []store.CountActiveSessionsByRoleRow {
	out := make([]store.CountActiveSessionsByRoleRow, 0, len(roles))
	for _, role := range roles {
		out = append(out, store.CountActiveSessionsByRoleRow{Role: role, N: 0})
	}
	return out
}

// crossJoinZeros is what the query's first branch emits: a zero for every
// (active service x configured role) pair.
func crossJoinZeros(services []string, roles []string) []store.CountFavoritesByServiceAndRoleRow {
	var out []store.CountFavoritesByServiceAndRoleRow
	for _, svc := range services {
		for _, role := range roles {
			out = append(out, store.CountFavoritesByServiceAndRoleRow{Name: svc, Role: role, N: 0})
		}
	}
	return out
}

func TestRefreshGauges(t *testing.T) {
	m := New()
	roles := testRoles()
	var gotRoles []string
	rows := crossJoinZeros([]string{"MyShare", "Stud.IP", "Unbeliebt"}, roles.Slugs())
	rows = append(rows,
		store.CountFavoritesByServiceAndRoleRow{Name: "MyShare", Role: "student", N: 3},
		store.CountFavoritesByServiceAndRoleRow{Name: "Stud.IP", Role: "student", N: 12},
		store.CountFavoritesByServiceAndRoleRow{Name: "Stud.IP", Role: "staff", N: 4},
	)
	// Seven sessions, the number the unlabelled gauge used to report for this
	// fixture, now split 5 student / 2 staff.
	sessions := append(sessionZeros(roles.Slugs()),
		store.CountActiveSessionsByRoleRow{Role: "student", N: 5},
		store.CountActiveSessionsByRoleRow{Role: "staff", N: 2},
	)
	var gotSessionRoles []string
	src := fakeGauges{sessions: sessions, favorites: rows, gotRoles: &gotRoles, gotSessionRoles: &gotSessionRoles}
	if err := m.RefreshGauges(context.Background(), src, roles); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	if want := roles.Slugs(); !slices.Equal(gotRoles, want) {
		t.Errorf("query got roles %v, want the configured set %v", gotRoles, want)
	}
	if want := roles.Slugs(); !slices.Equal(gotSessionRoles, want) {
		t.Errorf("session query got roles %v, want the configured set %v", gotSessionRoles, want)
	}
	_, body := scrape(t, m.Handler(""), "")
	for _, want := range []string{
		`wolke_active_sessions{role="student"} 5`,
		`wolke_active_sessions{role="staff"} 2`,
		`wolke_catalog_services{state="active"} 5`,
		`wolke_catalog_services{state="inactive"} 2`,
		`wolke_announcements_active{severity="warning"} 1`,
		`wolke_service_favorites{role="student",service="MyShare"} 3`,
		`wolke_service_favorites{role="student",service="Stud.IP"} 12`,
		`wolke_service_favorites{role="staff",service="Stud.IP"} 4`,
		// No staff pinned MyShare, and nobody at all pinned Unbeliebt: both
		// stay in the scrape as explicit zeros rather than vanishing from the
		// dashboard (#128, now per role).
		`wolke_service_favorites{role="staff",service="MyShare"} 0`,
		`wolke_service_favorites{role="staff",service="Unbeliebt"} 0`,
		`wolke_service_favorites{role="student",service="Unbeliebt"} 0`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("scrape missing %q:\n%s", want, body)
		}
	}
}

// A user whose stored primary_role is no longer configured (the #100
// degradation path) is counted under the configured default, so the metric
// agrees with the role that user is actually served (withEffectiveRole).
func TestRefreshGaugesFoldsStaleRolesOntoTheDefault(t *testing.T) {
	m := New()
	roles := testRoles()
	rows := crossJoinZeros([]string{"MyShare"}, roles.Slugs())
	rows = append(rows,
		store.CountFavoritesByServiceAndRoleRow{Name: "MyShare", Role: "student", N: 3},
		store.CountFavoritesByServiceAndRoleRow{Name: "MyShare", Role: "gast", N: 2},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{favorites: rows}, roles); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	if want := `wolke_service_favorites{role="student",service="MyShare"} 5`; !strings.Contains(body, want) {
		t.Errorf("scrape missing %q (stale role not folded onto the default):\n%s", want, body)
	}
	if strings.Contains(body, `role="gast"`) {
		t.Errorf("unconfigured role minted its own series:\n%s", body)
	}
}

// A service that is soft-deleted or renamed drops out of the query, and every
// one of its per-role series must go with it rather than freezing at its last
// value.
func TestRefreshGaugesDropsVanishedFavoritesSeries(t *testing.T) {
	m := New()
	roles := testRoles()
	beforeRows := crossJoinZeros([]string{"MyShare", "Gone"}, roles.Slugs())
	beforeRows = append(beforeRows,
		store.CountFavoritesByServiceAndRoleRow{Name: "MyShare", Role: "student", N: 3},
		store.CountFavoritesByServiceAndRoleRow{Name: "Gone", Role: "student", N: 4},
		store.CountFavoritesByServiceAndRoleRow{Name: "Gone", Role: "staff", N: 1},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{favorites: beforeRows}, roles); err != nil {
		t.Fatalf("first RefreshGauges: %v", err)
	}
	if _, body := scrape(t, m.Handler(""), ""); !strings.Contains(body, `wolke_service_favorites{role="student",service="Gone"} 4`) {
		t.Fatalf("first scrape missing the series that should later drop:\n%s", body)
	}

	afterRows := crossJoinZeros([]string{"MyShare"}, roles.Slugs())
	afterRows = append(afterRows, store.CountFavoritesByServiceAndRoleRow{Name: "MyShare", Role: "student", N: 3})
	if err := m.RefreshGauges(context.Background(), fakeGauges{favorites: afterRows}, roles); err != nil {
		t.Fatalf("second RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	if strings.Contains(body, `service="Gone"`) {
		t.Errorf("stale series for the removed service survived the refresh:\n%s", body)
	}
	if !strings.Contains(body, `wolke_service_favorites{role="student",service="MyShare"} 3`) {
		t.Errorf("surviving service lost its series:\n%s", body)
	}
}

// The per-role split must still add up to what the unlabelled gauge reported
// for the same fixture: the dashboard's total panel is now
// sum(max by (role) (...)), and this is the Go-side half of that claim.
func TestRefreshGaugesSessionsSplitByRoleSumToTheTotal(t *testing.T) {
	m := New()
	roles := testRoles()
	const total = 7
	sessions := append(sessionZeros(roles.Slugs()),
		store.CountActiveSessionsByRoleRow{Role: "student", N: 5},
		store.CountActiveSessionsByRoleRow{Role: "staff", N: 2},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{sessions: sessions}, roles); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	if got := sumSessionSeries(t, m); got != total {
		t.Errorf("per-role session series sum to %v, want the fixture total %d", got, total)
	}
}

// A configured role nobody is logged in under reads 0 rather than vanishing: a
// gap in the graph cannot be told apart from a dead exporter.
func TestRefreshGaugesEmptyRoleReportsZeroNotAbsent(t *testing.T) {
	m := New()
	roles := testRoles()
	sessions := append(sessionZeros(roles.Slugs()),
		store.CountActiveSessionsByRoleRow{Role: "student", N: 4},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{sessions: sessions}, roles); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	if want := `wolke_active_sessions{role="staff"} 0`; !strings.Contains(body, want) {
		t.Errorf("scrape missing %q — a role with no sessions must read 0, not disappear:\n%s", want, body)
	}
}

// A session whose stored primary_role is no longer configured counts under the
// default, which is the role that user is actually served — the same
// config.RoleSet.Effective rule the favorites gauge applies. Not its stale
// slug, and not dropped.
func TestRefreshGaugesFoldsStaleSessionRolesOntoTheDefault(t *testing.T) {
	m := New()
	roles := testRoles()
	sessions := append(sessionZeros(roles.Slugs()),
		store.CountActiveSessionsByRoleRow{Role: "student", N: 3},
		store.CountActiveSessionsByRoleRow{Role: "visiting-scholar", N: 2},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{sessions: sessions}, roles); err != nil {
		t.Fatalf("RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	if want := `wolke_active_sessions{role="student"} 5`; !strings.Contains(body, want) {
		t.Errorf("scrape missing %q (stale role not folded onto the default):\n%s", want, body)
	}
	if strings.Contains(body, `wolke_active_sessions{role="visiting-scholar"}`) {
		t.Errorf("unconfigured role minted its own session series:\n%s", body)
	}
	if got := sumSessionSeries(t, m); got != 5 {
		t.Errorf("folding lost or duplicated sessions: series sum to %v, want 5", got)
	}
}

// A role dropped from the configuration takes its series with it at the next
// refresh instead of freezing at its last value (the Reset).
func TestRefreshGaugesDropsSeriesOfRemovedRole(t *testing.T) {
	m := New()
	roles := testRoles()
	before := append(sessionZeros(roles.Slugs()),
		store.CountActiveSessionsByRoleRow{Role: "student", N: 3},
		store.CountActiveSessionsByRoleRow{Role: "staff", N: 2},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{sessions: before}, roles); err != nil {
		t.Fatalf("first RefreshGauges: %v", err)
	}
	if _, body := scrape(t, m.Handler(""), ""); !strings.Contains(body, `wolke_active_sessions{role="staff"} 2`) {
		t.Fatalf("first scrape missing the series that should later drop:\n%s", body)
	}

	// staff is gone from the configuration; the sessions that were counted
	// under it now fold onto the default, as they do for any stored role the
	// config does not define.
	shrunk := config.RoleMapping{
		Values:  map[string]string{"member": "student"},
		Default: "student",
	}.RoleSet()
	after := append(sessionZeros(shrunk.Slugs()),
		store.CountActiveSessionsByRoleRow{Role: "student", N: 3},
		store.CountActiveSessionsByRoleRow{Role: "staff", N: 2},
	)
	if err := m.RefreshGauges(context.Background(), fakeGauges{sessions: after}, shrunk); err != nil {
		t.Fatalf("second RefreshGauges: %v", err)
	}
	_, body := scrape(t, m.Handler(""), "")
	if strings.Contains(body, `wolke_active_sessions{role="staff"}`) {
		t.Errorf("series for the removed role survived the refresh:\n%s", body)
	}
	if want := `wolke_active_sessions{role="student"} 5`; !strings.Contains(body, want) {
		t.Errorf("scrape missing %q — the removed role's sessions fold onto the default:\n%s", want, body)
	}
}

// sumSessionSeries adds up every wolke_active_sessions series in the scrape,
// which is what the dashboard's total panel computes in PromQL.
func sumSessionSeries(t *testing.T, m *Metrics) float64 {
	t.Helper()
	_, body := scrape(t, m.Handler(""), "")
	var total float64
	for _, line := range strings.Split(body, "\n") {
		if !strings.HasPrefix(line, "wolke_active_sessions{") {
			continue
		}
		v, err := strconv.ParseFloat(line[strings.LastIndex(line, " ")+1:], 64)
		if err != nil {
			t.Fatalf("parsing %q: %v", line, err)
		}
		total += v
	}
	return total
}
