package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

// twoRoles is the launch deployment's shape: an IdM that can only tell students
// from employees (docs/specs/configurable-roles.md §2.1).
func twoRoles() config.RoleSet {
	return config.RoleMapping{
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
	}.RoleSet()
}

// exampleRoles is the bundled example set (the three-role university in
// config.Defaults) — what the dev database is seeded for, so DB-backed tests
// use it and leave the seeded rows alone.
func exampleRoles() config.RoleSet {
	cfg := config.Defaults()
	return cfg.Roles()
}

// The DB check constraints are gone (migration 00016): the configured role set
// is what the write paths validate against, in this one shared layer, so the
// HTTP handlers and the MCP tools cannot disagree (CLAUDE.md rule 3).
func TestValidateRoleAgainstTheConfiguredSet(t *testing.T) {
	roles := twoRoles()
	for _, role := range []string{"staff", "student"} {
		if err := validateRole(roles, role); err != nil {
			t.Errorf("validateRole(%q) = %v, want nil", role, err)
		}
	}
	for _, role := range []string{"teacher", "", "all", "Staff", "../etc"} {
		err := validateRole(roles, role)
		var ve *ValidationError
		if !errors.As(err, &ve) || ve.Field != "role" {
			t.Errorf("validateRole(%q) = %v, want a ValidationError on role", role, err)
		}
	}
	// The message names what this deployment does accept.
	err := validateRole(roles, "teacher")
	if !strings.Contains(err.Error(), "staff") || !strings.Contains(err.Error(), "student") {
		t.Errorf("error = %v, want it to list the configured roles", err)
	}
}

func TestValidateAudienceAgainstTheConfiguredSet(t *testing.T) {
	roles := twoRoles()
	in := validAnnouncement()

	for _, audience := range []string{"all", "staff", "student"} {
		in.Audience = audience
		if err := validateAnnouncement(roles, in); err != nil {
			t.Errorf("audience %q = %v, want nil", audience, err)
		}
	}
	for _, audience := range []string{"teacher", "", "everyone"} {
		in.Audience = audience
		err := validateAnnouncement(roles, in)
		var ve *ValidationError
		if !errors.As(err, &ve) || ve.Field != "audience" {
			t.Errorf("audience %q = %v, want a ValidationError on audience", audience, err)
		}
	}

	// "all" stays available whatever the roles are, and is named in the error.
	in.Audience = "teacher"
	if err := validateAnnouncement(roles, in); !strings.Contains(err.Error(), "all") {
		t.Errorf("error = %v, want it to offer the 'all' audience", err)
	}
}

// A six-role deployment is supported (it only warns at startup), and every one
// of its roles is writable.
func TestValidationScalesWithTheConfiguredSet(t *testing.T) {
	roles := config.RoleMapping{
		Precedence: []string{"staff", "student", "alumni", "guest", "faculty", "external"},
		Default:    "student",
	}.RoleSet()
	for _, role := range roles.Slugs() {
		if err := validateRole(roles, role); err != nil {
			t.Errorf("validateRole(%q) = %v, want nil", role, err)
		}
	}
}

// Stale rows for a role the deployment no longer configures are dropped when
// that admin next saves a role's list (spec §2.2).
func TestStaleRoleDefaults(t *testing.T) {
	roles := twoRoles()
	stored := []string{"staff", "student", "teacher", "guest"}
	got := staleRoles(roles, stored)
	want := []string{"teacher", "guest"}
	if len(got) != len(want) {
		t.Fatalf("staleRoles = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("staleRoles = %v, want %v", got, want)
		}
	}
	if n := staleRoles(roles, []string{"staff", "student"}); len(n) != 0 {
		t.Errorf("staleRoles = %v, want none when every row is configured", n)
	}
}
