package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

func twoRoleSet() config.RoleSet {
	return config.RoleMapping{
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
		Labels: map[string]map[string]string{
			"staff":   {"de": "Mitarbeitende", "en": "Staff"},
			"student": {"de": "Studierende", "en": "Students"},
		},
	}.RoleSet()
}

// GET /api/roles is what the admin screens render from, so it must be the
// configured set, in precedence order, with resolved labels (spec §2.3).
func TestRoleListHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	roleList(twoRoleSet())(rec, httptest.NewRequest(http.MethodGet, "/api/roles", nil))

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

// An announcement whose audience is no longer a configured role reaches nobody,
// but the admin list still shows it — flagged, never an error (spec §2.2).
func TestFlagUnknownAudiences(t *testing.T) {
	roles := twoRoleSet()
	list := []announce.Announcement{
		{ID: "1", Audience: "all"},
		{ID: "2", Audience: "staff"},
		{ID: "3", Audience: "teacher"},
	}
	flagUnknownAudiences(list, roles)
	if list[0].AudienceUnknown || list[1].AudienceUnknown {
		t.Error("configured audiences must not be flagged")
	}
	if !list[2].AudienceUnknown {
		t.Error("an audience outside the configured set must be flagged for the admin view")
	}
}
