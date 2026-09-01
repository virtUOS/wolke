package service

// Role validation for the write paths. The role set is deployment config
// (docs/specs/configurable-roles.md), so it cannot be a schema-time check
// constraint — migration 00016 dropped those and the rules live here instead,
// shared by the HTTP handlers and the MCP tools (CLAUDE.md rule 3).

import (
	"strings"

	"github.com/virtuos/wolke/internal/config"
)

// validateRole rejects a role this deployment does not configure.
func validateRole(roles config.RoleSet, role string) error {
	if roles.Has(role) {
		return nil
	}
	return &ValidationError{Field: "role", Msg: "must be one of " + strings.Join(roles.Slugs(), ", ")}
}

// validateAudience rejects an announcement audience that is neither "all" nor a
// configured role.
func validateAudience(roles config.RoleSet, audience string) error {
	if audience == AudienceAll || roles.Has(audience) {
		return nil
	}
	return &ValidationError{Field: "audience", Msg: "must be one of " + strings.Join(append([]string{AudienceAll}, roles.Slugs()...), ", ")}
}

// AudienceAll is the announcement audience meaning "everyone"; it is reserved,
// so no role may use it as a slug (config.RoleSet enforces that at startup).
const AudienceAll = "all"

// staleRoles returns the stored roles that the configured set no longer knows,
// in the order they were stored. Rows under such a role are already invisible
// (nobody reads with a role outside the set); this is what lets a write clean
// them up (spec §2.2).
func staleRoles(roles config.RoleSet, stored []string) []string {
	var out []string
	for _, role := range stored {
		if !roles.Has(role) {
			out = append(out, role)
		}
	}
	return out
}
