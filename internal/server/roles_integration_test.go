package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// A deployment configured with exactly two roles must work end to end: login
// resolves into that set, /api/roles reports it, the admin writes accept only
// it, and rows left behind by a *different* configuration degrade instead of
// breaking (docs/specs/configurable-roles.md §2.2, §4). This also covers
// migration 00016: every "stale row" below is one the dropped check
// constraints would have refused to let the test write.
//
// Needs the mock IdP and a migrated database:
//
//	OIDC_TEST_ISSUER=http://127.0.0.1:8455/default \
//	DATABASE_URL=postgres://wolke:devpass@localhost:5432/wolke?sslmode=disable \
//	go test ./internal/server -run TestTwoRoleDeployment -v
func TestTwoRoleDeployment(t *testing.T) {
	issuer := os.Getenv("OIDC_TEST_ISSUER")
	dburl := os.Getenv("DATABASE_URL")
	if issuer == "" || dburl == "" {
		t.Skip("set OIDC_TEST_ISSUER and DATABASE_URL to run the configurable-roles integration test")
	}

	ctx := context.Background()
	db, err := store.Open(ctx, dburl)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from announcements where title->>'de' like 'Rollen-Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from role_defaults where role = 'phd'")
		db.Close()
	})
	// (The mock IdP always logs in as stud-1; that row may already exist from an
	// earlier run and is referenced by audit rows, so it is never deleted here.)

	// The launch deployment's mapping: the IdM distinguishes students from
	// employees, nothing else. 'teacher' is not a role here.
	cfg := startIntegrationServer(t, db, issuer, func(c *config.Config) {
		c.OIDC.Role = twoRoleMapping()
	}, Deps{Defaults: db, Announce: db})
	base := cfg.PublicURL
	roles := cfg.Roles()

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 15 * time.Second}

	// 1. Login through the mock IdP (eduPersonAffiliation=student).
	resp, err := client.Get(base + "/auth/login")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	_ = resp.Body.Close()

	// 2. /api/roles is the configured set, in precedence order, with labels.
	var got []config.Role
	getJSONInto(t, client, base+"/api/roles", &got)
	if len(got) != 2 || got[0].Slug != "staff" || got[1].Slug != "student" {
		t.Fatalf("/api/roles = %+v, want [staff student]", got)
	}
	if got[0].Label["de"] != "Mitarbeitende" {
		t.Errorf("staff label = %v, want the configured German label", got[0].Label)
	}

	// 3. The login resolved into the configured set.
	var me meResponse
	getJSONInto(t, client, base+"/api/me", &me)
	if me.PrimaryRole != "student" {
		t.Fatalf("primary_role = %q, want student", me.PrimaryRole)
	}
	user, err := db.GetUserByID(ctx, mustUUID(t, me.ID))
	if err != nil {
		t.Fatalf("load user: %v", err)
	}

	admin := user
	admin.IsAdmin = true
	call := func(h http.HandlerFunc, method, target, body, idParam, roleParam string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		c := context.WithValue(r.Context(), userCtxKey{}, admin)
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", idParam)
		rctx.URLParams.Add("role", roleParam)
		c = context.WithValue(c, chi.RouteCtxKey, rctx)
		rec := httptest.NewRecorder()
		h(rec, r.WithContext(c))
		return rec
	}
	d := AdminDeps{Roles: roles, Store: db, Invalidate: func() {}, Audit: db}

	// The dev database is seeded (and the e2e suite reads those seeds), so
	// capture the role lists this test overwrites and put them back afterwards.
	restoreRoleDefaults(t, db, "staff", "student")

	// 4. Writes accept the configured roles and refuse the others — the check
	// constraints are gone, so this is the service layer doing the work.
	if rec := call(adminSetRoleDefaults(d), http.MethodPut, "/x", `{"service_ids":[]}`, "", "staff"); rec.Code != http.StatusNoContent {
		t.Fatalf("set defaults for staff = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}
	if rec := call(adminSetRoleDefaults(d), http.MethodPut, "/x", `{"service_ids":[]}`, "", "teacher"); rec.Code != http.StatusBadRequest {
		t.Errorf("set defaults for an unconfigured role = %d, want 400", rec.Code)
	}
	body := func(audience string) string {
		return `{"title":{"de":"Rollen-Test","en":"Roles test"},"body":{"de":"Text.","en":"Text."},"severity":"info","audience":"` + audience + `","dismissible":true}`
	}
	if rec := call(adminCreateAnnouncement(d), http.MethodPost, "/x", body("staff"), "", ""); rec.Code != http.StatusCreated {
		t.Fatalf("announcement for staff = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	if rec := call(adminCreateAnnouncement(d), http.MethodPost, "/x", body("teacher"), "", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("announcement for an unconfigured audience = %d, want 400", rec.Code)
	}

	// 5. Stale rows written under a previous configuration.
	if _, err := db.Pool.Exec(ctx, "update users set primary_role = 'teacher' where id = $1", user.ID); err != nil {
		t.Fatalf("write a stale primary_role (did migration 00016 run?): %v", err)
	}
	if _, err := db.Pool.Exec(ctx,
		`insert into announcements (title, body, severity, audience, starts_at, dismissible)
		 values ('{"de":"Rollen-Test alt","en":"Roles test old"}', '{"de":"Alt.","en":"Old."}', 'info', 'teacher', now(), true)`); err != nil {
		t.Fatalf("write a stale audience (did migration 00016 run?): %v", err)
	}
	if _, err := db.Pool.Exec(ctx,
		`insert into role_defaults (role, service_id, sort) select 'phd', id, 0 from services limit 1`); err != nil {
		t.Fatalf("write a stale role_defaults row (did migration 00016 run?): %v", err)
	}

	// 5a. The user's stale role reads as the configured default.
	getJSONInto(t, client, base+"/api/me", &me)
	if me.PrimaryRole != "student" {
		t.Errorf("stale primary_role read as %q, want the configured default (student)", me.PrimaryRole)
	}

	// 5b. The stale announcement reaches nobody...
	var userList struct {
		Announcements []announce.Announcement `json:"announcements"`
	}
	getJSONInto(t, client, base+"/api/announcements", &userList)
	for _, a := range userList.Announcements {
		if a.Audience == "teacher" {
			t.Errorf("an announcement for an unconfigured role was shown to a user: %+v", a)
		}
	}
	// ...but is listed, flagged, for an admin.
	rec := call(adminListAnnouncements(d), http.MethodGet, "/x", "", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("admin announcements = %d, want 200", rec.Code)
	}
	var adminList struct {
		Announcements []announce.Announcement `json:"announcements"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &adminList); err != nil {
		t.Fatalf("decode admin announcements: %v", err)
	}
	var flagged, listed bool
	for _, a := range adminList.Announcements {
		if a.Audience == "teacher" {
			listed = true
			flagged = a.AudienceUnknown
		}
	}
	if !listed || !flagged {
		t.Errorf("stale announcement listed=%v flagged=%v, want both true", listed, flagged)
	}

	// 5c. Stale role_defaults rows are invisible, and the next write purges them.
	if rec := call(adminSetRoleDefaults(d), http.MethodPut, "/x", `{"service_ids":[]}`, "", "student"); rec.Code != http.StatusNoContent {
		t.Fatalf("set defaults for student = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}
	var left int
	if err := db.Pool.QueryRow(ctx, "select count(*) from role_defaults where role = 'phd'").Scan(&left); err != nil {
		t.Fatalf("count stale defaults: %v", err)
	}
	if left != 0 {
		t.Errorf("%d stale role_defaults rows left, want them purged by the next write", left)
	}

	// 5d. The stale user role heals at the next login.
	resp, err = client.Get(base + "/auth/login")
	if err != nil {
		t.Fatalf("re-login: %v", err)
	}
	_ = resp.Body.Close()
	var stored string
	if err := db.Pool.QueryRow(ctx, "select primary_role from users where id = $1", user.ID).Scan(&stored); err != nil {
		t.Fatalf("read primary_role: %v", err)
	}
	if stored != "student" {
		t.Errorf("primary_role after re-login = %q, want it re-resolved to student", stored)
	}
}

// restoreRoleDefaults snapshots the given roles' default lists and restores
// them when the test ends, so a test that rewrites them leaves the seeded dev
// data as it found it.
func restoreRoleDefaults(t *testing.T, db *store.DB, roles ...string) {
	t.Helper()
	ctx := context.Background()
	for _, role := range roles {
		ids, err := db.GetRoleDefaults(ctx, role)
		if err != nil {
			t.Fatalf("snapshot role defaults for %q: %v", role, err)
		}
		t.Cleanup(func() {
			_, _ = db.Pool.Exec(ctx, "delete from role_defaults where role = $1", role)
			for i, id := range ids {
				_, _ = db.Pool.Exec(ctx, "insert into role_defaults (role, service_id, sort) values ($1, $2, $3)", role, id, i)
			}
		})
	}
}

func getJSONInto(t *testing.T, client *http.Client, url string, dst any) {
	t.Helper()
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200", url, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
}

func mustUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	id, ok := parseUUID(s)
	if !ok {
		t.Fatalf("not a uuid: %q", s)
	}
	return id
}
