package auth

import (
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

// defaultRoleMapping mirrors the bundled example mapping (config.Defaults) —
// example deployment data, not a fixed role set.
func defaultRoleMapping() config.RoleMapping {
	return config.RoleMapping{
		Claim:      "eduPersonAffiliation",
		Values:     map[string]string{"faculty": "teacher", "employee": "staff", "member": "staff", "student": "student"},
		Precedence: []string{"teacher", "staff", "student"},
		Default:    "student",
	}
}

func TestResolveRole(t *testing.T) {
	m := defaultRoleMapping()
	tests := []struct {
		name   string
		claims map[string]any
		want   string
	}{
		{"single string student", map[string]any{"eduPersonAffiliation": "student"}, "student"},
		{"single string faculty -> teacher", map[string]any{"eduPersonAffiliation": "faculty"}, "teacher"},
		{"array picks by precedence (teacher>staff)", map[string]any{"eduPersonAffiliation": []any{"student", "employee", "faculty"}}, "teacher"},
		{"array staff over student", map[string]any{"eduPersonAffiliation": []any{"student", "member"}}, "staff"},
		{"unmapped value -> default", map[string]any{"eduPersonAffiliation": "alumni"}, "student"},
		{"missing claim -> default", map[string]any{}, "student"},
		{"[]string input", map[string]any{"eduPersonAffiliation": []string{"employee"}}, "staff"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveRole(tt.claims, m); got != tt.want {
				t.Errorf("ResolveRole = %q, want %q", got, tt.want)
			}
		})
	}
}

// The launch deployment's shape: an IdM that can only tell students from
// employees, so the whole role set is two roles (docs/specs/configurable-roles.md).
func TestResolveRoleTwoRoleDeployment(t *testing.T) {
	m := config.RoleMapping{
		Claim:      "eduPersonAffiliation",
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
	}
	tests := []struct {
		name   string
		claims map[string]any
		want   string
	}{
		{"student", map[string]any{"eduPersonAffiliation": "student"}, "student"},
		{"employee -> staff", map[string]any{"eduPersonAffiliation": "employee"}, "staff"},
		{"both -> precedence picks staff", map[string]any{"eduPersonAffiliation": []any{"student", "employee"}}, "staff"},
		{"a value from another deployment's set is unmapped -> default", map[string]any{"eduPersonAffiliation": "faculty"}, "student"},
		{"missing claim -> default", map[string]any{}, "student"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveRole(tt.claims, m); got != tt.want {
				t.Errorf("ResolveRole = %q, want %q", got, tt.want)
			}
		})
	}
	// The resolved role is always one this deployment configures — that is what
	// makes a stale users.primary_role self-heal at the next login (spec §2.2).
	if set := m.RoleSet(); !set.Has(ResolveRole(map[string]any{"eduPersonAffiliation": "employee"}, m)) {
		t.Error("resolved role must be a member of the configured role set")
	}
}

// A different deployment maps differently with no code change — proves the
// mapping is config-driven (docs/02 §6).
func TestResolveRoleHonorsConfiguredMapping(t *testing.T) {
	m := config.RoleMapping{
		Claim:      "realm_access.roles",
		Values:     map[string]string{"lehrende": "teacher", "studierende": "student"},
		Precedence: []string{"teacher", "student"},
		Default:    "staff",
	}
	claims := map[string]any{
		"realm_access": map[string]any{"roles": []any{"studierende", "lehrende"}},
	}
	if got := ResolveRole(claims, m); got != "teacher" {
		t.Errorf("nested claim role = %q, want teacher", got)
	}
	if got := ResolveRole(map[string]any{}, m); got != "staff" {
		t.Errorf("missing claim role = %q, want configured default staff", got)
	}
}

func TestResolveAdmin(t *testing.T) {
	flat := config.AdminMapping{Claim: "groups", Match: "dashboard-admins"}
	nested := config.AdminMapping{Claim: "realm_access.roles", Match: "dashboard-admins"}
	tests := []struct {
		name   string
		m      config.AdminMapping
		claims map[string]any
		want   bool
	}{
		{"group present", flat, map[string]any{"groups": []any{"x", "dashboard-admins"}}, true},
		{"group absent", flat, map[string]any{"groups": []any{"students"}}, false},
		{"single string match", flat, map[string]any{"groups": "dashboard-admins"}, true},
		{"missing claim", flat, map[string]any{}, false},
		{"nested path match", nested, map[string]any{"realm_access": map[string]any{"roles": []any{"dashboard-admins"}}}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveAdmin(tt.claims, tt.m); got != tt.want {
				t.Errorf("ResolveAdmin = %v, want %v", got, tt.want)
			}
		})
	}
}
