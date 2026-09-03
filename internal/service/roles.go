package service

// Role validation for the write paths. The role set is deployment config
// (docs/specs/configurable-roles.md), so it cannot be a schema-time check
// constraint — migrations/00001_init.sql has none, and the rules live here
// instead, shared by the HTTP handlers and the MCP tools (CLAUDE.md rule 3).

import (
	"strings"

	"github.com/virtuos/wolke/internal/config"
)

// ValidateRole rejects a role this deployment does not configure. Exported for
// the read paths that take a role from the URL (the write paths go through the
// use cases below, which validate on their own).
func ValidateRole(roles config.RoleSet, role string) error {
	if roles.Has(role) {
		return nil
	}
	return &ValidationError{Field: "role", Msg: "must be one of " + strings.Join(roles.Slugs(), ", ")}
}

// validateAudience rejects an announcement audience that is neither "all" nor a
// configured role.
func validateAudience(roles config.RoleSet, audience string) error {
	if audience == config.AudienceAll || roles.Has(audience) {
		return nil
	}
	return &ValidationError{Field: "audience", Msg: "must be one of " + strings.Join(append([]string{config.AudienceAll}, roles.Slugs()...), ", ")}
}
