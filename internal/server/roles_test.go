package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// twoRoleMapping is the launch deployment's claim mapping: an IdM that can only
// tell students from employees. Shared by the unit and integration tests so
// "what a two-role deployment looks like" is written down once.
func twoRoleMapping() config.RoleMapping {
	return config.RoleMapping{
		Claim:      "eduPersonAffiliation",
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
		Labels: map[string]map[string]string{
			"staff":   {"de": "Mitarbeitende", "en": "Staff"},
			"student": {"de": "Studierende", "en": "Students"},
		},
	}
}

func twoRoleSet() config.RoleSet { return twoRoleMapping().RoleSet() }

// GET /api/roles is what the admin screens render from, so it must be the
// configured set, in precedence order, with resolved labels (spec §2.3).
func TestRoleListHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	roleList(mustRolesJSON(twoRoleSet()))(rec, httptest.NewRequest(http.MethodGet, "/api/roles", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []config.Role
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if len(got) != 2 {
		t.Fatalf("roles = %+v, want exactly the two configured roles", got)
	}
	if got[0].Slug != "staff" || got[1].Slug != "student" {
		t.Errorf("order = %q, %q, want precedence order (staff, student)", got[0].Slug, got[1].Slug)
	}
	if got[0].Label["de"] != "Mitarbeitende" || got[1].Label["en"] != "Students" {
		t.Errorf("labels = %+v, want the configured ones", got)
	}
}

// A user row written under a role this deployment no longer configures reads as
// the default; it self-heals at the user's next login (spec §2.2). Everything
// downstream (/api/me, the default view, announcement scoping) sees the
// corrected role because the correction happens where the session is loaded.
func TestEffectiveRoleDegradesStaleUsers(t *testing.T) {
	roles := twoRoleSet()
	tests := []struct {
		stored string
		want   string
	}{
		{"staff", "staff"},
		{"student", "student"},
		{"teacher", "student"}, // a role from a previous configuration
		{"", "student"},
	}
	for _, tt := range tests {
		got := withEffectiveRole(store.User{PrimaryRole: tt.stored}, roles)
		if got.PrimaryRole != tt.want {
			t.Errorf("stored %q → %q, want %q", tt.stored, got.PrimaryRole, tt.want)
		}
	}
}

// Reading a role's defaults must validate the role too: an unconfigured role is
// a client error, not an empty list that reads as "this role has no defaults".
// It also keeps the URL path from being a free-text lookup key.
func TestAdminGetRoleDefaultsRejectsAnUnconfiguredRole(t *testing.T) {
	d := AdminDeps{Roles: twoRoleSet()}
	r := httptest.NewRequest(http.MethodGet, "/api/admin/role-defaults/teacher", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("role", "teacher")
	rec := httptest.NewRecorder()

	adminGetRoleDefaults(d)(rec, r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx)))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "staff") {
		t.Errorf("body = %s, want it to name the configured roles", rec.Body.String())
	}
}
