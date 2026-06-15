package auth

import (
	"fmt"
	"strings"

	"github.com/virtuos/wolke/internal/config"
)

// Identity is the result of mapping verified OIDC claims to our domain. It is
// what gets upserted into the users table and put on the session.
type Identity struct {
	Subject     string
	DisplayName string
	Email       string
	Role        string // student | teacher | staff
	IsAdmin     bool
}

// ResolveRole maps the affiliation claim's value(s) to one internal role using
// the configured mapping and precedence (docs/02 §6). The mapping is data, never
// code, so swapping IdP or claim names is a config change. If several mapped
// roles are present, precedence decides; if none match, the configured default
// is used.
func ResolveRole(claims map[string]any, m config.RoleMapping) string {
	present := map[string]bool{}
	for _, raw := range claimStrings(claimByPath(claims, m.Claim)) {
		if internal, ok := m.Values[raw]; ok {
			present[internal] = true
		}
	}
	for _, role := range m.Precedence {
		if present[role] {
			return role
		}
	}
	// A mapped role outside the precedence list still beats the default.
	for role := range present {
		return role
	}
	return m.Default
}

// ResolveAdmin reports whether the configured admin claim contains the match
// value. is_admin is re-derived on every login, so revoking the group/role at
// the IdP revokes admin at next login (docs/02 §6).
func ResolveAdmin(claims map[string]any, m config.AdminMapping) bool {
	if m.Claim == "" || m.Match == "" {
		return false
	}
	for _, v := range claimStrings(claimByPath(claims, m.Claim)) {
		if v == m.Match {
			return true
		}
	}
	return false
}

// claimByPath extracts a value from possibly-nested claims using a dot-separated
// path (e.g. "realm_access.roles"), so Keycloak-style nested claims work without
// special-casing any provider.
func claimByPath(claims map[string]any, path string) any {
	if path == "" {
		return nil
	}
	parts := strings.Split(path, ".")
	var cur any = claims
	for _, p := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur, ok = m[p]
		if !ok {
			return nil
		}
	}
	return cur
}

// claimStrings normalizes a claim value to a string slice, accepting a single
// string or an array of strings/values (claims commonly arrive either way).
func claimStrings(v any) []string {
	switch t := v.(type) {
	case nil:
		return nil
	case string:
		return []string{t}
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok {
				out = append(out, s)
			} else {
				out = append(out, fmt.Sprint(e))
			}
		}
		return out
	default:
		return []string{fmt.Sprint(t)}
	}
}
