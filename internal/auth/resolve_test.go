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

// visibilitySet builds a configured visibility set the way a deployment's
// config.yaml would (config.Config.Visibility is the only public constructor).
func visibilitySet(entries ...config.VisibilityEntry) config.VisibilitySet {
	c := &config.Config{VisibilityEntries: entries}
	return c.Visibility()
}

func claimEntry(slug, claim, match string) config.VisibilityEntry {
	return config.VisibilityEntry{Slug: slug, Claim: claim, Match: match}
}

func TestResolveVisibilityClaims(t *testing.T) {
	tests := []struct {
		name   string
		set    config.VisibilitySet
		claims map[string]any
		want   []string
	}{
		{
			name:   "nothing configured grants nothing",
			set:    visibilitySet(),
			claims: map[string]any{"groups": []any{"it-service-admins"}},
			want:   []string{},
		},
		{
			name:   "single match on a flat claim",
			set:    visibilitySet(claimEntry("it-infra", "groups", "it-service-admins")),
			claims: map[string]any{"groups": []any{"students", "it-service-admins"}},
			want:   []string{"it-infra"},
		},
		{
			name:   "nested claim path, like the admin mapping",
			set:    visibilitySet(claimEntry("it-infra", "realm_access.roles", "wolke-it-infra")),
			claims: map[string]any{"realm_access": map[string]any{"roles": []any{"wolke-it-infra"}}},
			want:   []string{"it-infra"},
		},
		{
			name: "several entries at once, in config order",
			set: visibilitySet(
				claimEntry("it-infra", "groups", "it-service-admins"),
				claimEntry("net-ops", "realm_access.roles", "network"),
			),
			claims: map[string]any{
				"groups":       "it-service-admins",
				"realm_access": map[string]any{"roles": []string{"network", "other"}},
			},
			want: []string{"it-infra", "net-ops"},
		},
		{
			name:   "claim present but no value matches",
			set:    visibilitySet(claimEntry("it-infra", "groups", "it-service-admins")),
			claims: map[string]any{"groups": []any{"students", "dashboard-admins"}},
			want:   []string{},
		},
		{
			name:   "claim absent entirely",
			set:    visibilitySet(claimEntry("it-infra", "groups", "it-service-admins")),
			claims: map[string]any{"eduPersonAffiliation": "student"},
			want:   []string{},
		},
		{
			// An entry the config loader dropped (no claim/match) grants
			// nothing, whatever the token says.
			name:   "an entry without a claim mapping grants nothing",
			set:    visibilitySet(config.VisibilityEntry{Slug: "half-configured", Match: "some-group"}),
			claims: map[string]any{"groups": []any{"some-group"}},
			want:   []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveVisibilityClaims(tt.claims, tt.set)
			if len(got) != len(tt.want) {
				t.Fatalf("ResolveVisibilityClaims = %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("ResolveVisibilityClaims = %v, want %v", got, tt.want)
				}
			}
		})
	}
}
