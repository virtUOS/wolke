package config

// The role set is deployment data, not code (docs/specs/configurable-roles.md).
// It is derived from the OIDC claim mapping that already exists — the distinct
// values of role.values ∪ role.precedence ∪ {role.default} — so there is no
// second list to keep in sync, and a deployment that can only tell students
// from employees simply configures two roles.

import (
	"fmt"
	"log/slog"
	"maps"
	"regexp"
	"slices"
	"strings"
	"unicode"
)

// softMaxRoles is where the product's UX (per-role default views, the
// announcement audience picker) stops being comfortable. Above it we warn at
// startup — more roles still work, they just crowd those screens.
const softMaxRoles = 5

// AudienceAll is the announcement audience meaning "everyone". It is reserved:
// no role slug may take this value, which is what lets an audience be either
// AudienceAll or a role slug with no ambiguity.
const AudienceAll = "all"

// roleSlugPattern is what a role slug may look like. It travels in URL paths
// (/api/admin/role-defaults/{role}) and in the announcement audience column, so
// it stays short and boring.
var roleSlugPattern = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

// Role is one configured role: the slug stored in the database and the display
// labels the admin UI renders. The json tags are the GET /api/roles shape.
type Role struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
}

// RoleSet is the configured role set in precedence order. The zero value is an
// empty set (Has reports false for everything), which is what a Config built in
// a test without a claim mapping gets.
type RoleSet struct {
	roles []Role
	index map[string]struct{}
	def   string
}

// Roles returns the configured role set.
func (c *Config) Roles() RoleSet { return c.OIDC.Role.RoleSet() }

// RoleSet derives the role set from the claim mapping. It is lenient by design —
// invalid slugs are dropped rather than panicking — because validateRoles has
// already refused such a mapping at startup (see Config.validate).
func (m RoleMapping) RoleSet() RoleSet {
	set := RoleSet{index: map[string]struct{}{}, def: m.Default}
	for _, slug := range m.orderedSlugs() {
		if !roleSlugPattern.MatchString(slug) || slug == AudienceAll {
			continue
		}
		if _, dup := set.index[slug]; dup {
			continue
		}
		set.index[slug] = struct{}{}
		set.roles = append(set.roles, Role{Slug: slug, Label: m.label(slug)})
	}
	return set
}

// orderedSlugs lists every slug the mapping mentions, in the order the role set
// presents them: precedence first (it is the order the admin UI and /api/roles
// use), then whatever the claim values add — sorted, because map iteration
// order is random and the API response must be stable — and finally the
// fallback role, which belongs to the set even if nothing maps to it.
func (m RoleMapping) orderedSlugs() []string {
	fromValues := make([]string, 0, len(m.Values))
	for _, slug := range m.Values {
		fromValues = append(fromValues, slug)
	}
	slices.Sort(fromValues)

	all := make([]string, 0, len(m.Precedence)+len(fromValues)+1)
	all = append(all, m.Precedence...)
	all = append(all, fromValues...)
	return append(all, m.Default)
}

// label resolves a role's display labels, falling back to the capitalized slug
// per language so an unlabelled deployment still renders something sensible.
func (m RoleMapping) label(slug string) map[string]string {
	out := map[string]string{"de": capitalize(slug), "en": capitalize(slug)}
	for lang, text := range m.Labels[slug] {
		if strings.TrimSpace(text) != "" {
			out[lang] = text
		}
	}
	return out
}

// validateRoles refuses a mapping whose role set could not work: a malformed
// slug (it travels in URLs and in the audience column), the reserved audience
// value, or no default at all. Called from Config.validate, so a violation is a
// startup failure rather than a runtime surprise.
func (m RoleMapping) validateRoles() error {
	if strings.TrimSpace(m.Default) == "" {
		return fmt.Errorf("config: oidc.role.default must name the fallback role")
	}
	// One traversal of the same ordered union the set is built from, so the
	// error a deployer sees names the first offending slug deterministically.
	for _, slug := range m.orderedSlugs() {
		if err := validateRoleSlug(slug); err != nil {
			return err
		}
	}
	return nil
}

func validateRoleSlug(slug string) error {
	if slug == AudienceAll {
		return fmt.Errorf("config: role slug %q is reserved (it is the announcement audience meaning everyone)", slug)
	}
	if !roleSlugPattern.MatchString(slug) {
		return fmt.Errorf("config: role slug %q is invalid: must match [a-z0-9-]{1,32}", slug)
	}
	return nil
}

// List returns the roles in precedence order. The result is a deep copy: it is
// handed to request handlers that must not be able to corrupt the config.
func (s RoleSet) List() []Role {
	out := make([]Role, 0, len(s.roles))
	for _, r := range s.roles {
		out = append(out, Role{Slug: r.Slug, Label: maps.Clone(r.Label)})
	}
	return out
}

// Slugs returns the role slugs in precedence order.
func (s RoleSet) Slugs() []string {
	out := make([]string, 0, len(s.roles))
	for _, r := range s.roles {
		out = append(out, r.Slug)
	}
	return out
}

// Has reports whether slug is a configured role.
func (s RoleSet) Has(slug string) bool {
	_, ok := s.index[slug]
	return ok
}

// Default is the fallback role (oidc.role.default).
func (s RoleSet) Default() string { return s.def }

// Len is the number of configured roles.
func (s RoleSet) Len() int { return len(s.roles) }

// Effective maps a stored role onto the configured set: a row written under a
// role this deployment no longer configures reads as the default rather than
// erroring, and self-heals at the user's next login (spec §2.2).
func (s RoleSet) Effective(role string) string {
	if s.Has(role) {
		return role
	}
	return s.def
}

// LogSummary spells out the effective role set at startup — a deployment whose
// config file failed to mount silently falls back to the built-in example, and
// this is where that shows. Above softMaxRoles it warns: more roles work, but
// the per-role screens were designed for a handful.
func (s RoleSet) LogSummary(log *slog.Logger) {
	log.Info("role set configured", "roles", s.Slugs(), "default", s.def)
	if s.Len() > softMaxRoles {
		log.Warn("configured role set is larger than the admin UI is designed for; the role default-view editor and the announcement audience picker get crowded",
			"roles", s.Len(), "designed_for", softMaxRoles)
	}
}

// capitalize upper-cases the first rune, leaving the rest alone ("staff" →
// "Staff"). Good enough for a fallback label; a deployment that cares supplies
// oidc.role.labels.
func capitalize(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}
