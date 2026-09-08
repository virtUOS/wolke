package config

// Service visibility slugs are deployment data, not code
// (docs/specs/service-visibility.md §2). A slug marks a service as non-public;
// a user's visible set is {public} ∪ {slugs the user holds}. A slug is held
// either because an IdP claim granted it (grant: claim) or because the user
// opted in (grant: opt-in) — that is the only difference between the two
// flavours, and the reason there is one mechanism rather than two.
//
// No configured entries means no behaviour change at all: every service is
// public and no visibility UI renders anywhere.

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

// Grant types: who decides that a user holds a slug.
const (
	GrantClaim = "claim"  // membership comes from the IdP (Stage 2 of the spec)
	GrantOptIn = "opt-in" // the user enables it in the account menu (Stage 1)
)

// VisibilityEntry is one configured visibility slug, as it appears in the
// `visibility:` list of the config file.
type VisibilityEntry struct {
	Slug  string            `yaml:"slug"`
	Label map[string]string `yaml:"label"`
	Grant string            `yaml:"grant"`
	// Claim/Match apply to grant: claim — a (possibly nested) claim path and the
	// value that grants the slug, like oidc.admin.
	Claim string `yaml:"claim"`
	Match string `yaml:"match"`
	// Warning applies to grant: opt-in — the text shown in the confirm dialog
	// before the user enables it ("data may vanish, no migration").
	Warning map[string]string `yaml:"warning"`
}

// Visibility is one configured slug as the read paths and the API see it: the
// slug, its display labels, its grant type, and — for opt-in slugs — the
// warning. Labels and warning are complete (both languages filled) even when
// the file supplied only one. The json tags are the /api/me shape.
type Visibility struct {
	Slug    string            `json:"slug"`
	Label   map[string]string `json:"label"`
	Grant   string            `json:"grant"`
	Claim   string            `json:"-"`
	Match   string            `json:"-"`
	Warning map[string]string `json:"warning,omitempty"`
}

// VisibilitySet is the configured visibility slugs in config order. The zero
// value is the empty set: Has reports false for everything and Held returns
// nothing, which is what an unconfigured deployment gets.
type VisibilitySet struct {
	entries []Visibility
	index   map[string]int
}

// Visibility returns the configured visibility set.
func (c *Config) Visibility() VisibilitySet { return newVisibilitySet(c.VisibilityEntries) }

// newVisibilitySet builds the set leniently — invalid or duplicate slugs are
// dropped rather than panicking — because validateVisibility has already
// refused such a config at startup (Config.validate).
func newVisibilitySet(entries []VisibilityEntry) VisibilitySet {
	set := VisibilitySet{index: map[string]int{}}
	for _, e := range entries {
		if !roleSlugPattern.MatchString(e.Slug) || e.Slug == AudienceAll {
			continue
		}
		if _, dup := set.index[e.Slug]; dup {
			continue
		}
		if e.Grant != GrantClaim && e.Grant != GrantOptIn {
			continue
		}
		v := Visibility{
			Slug:  e.Slug,
			Label: fillLanguages(e.Label, capitalize(e.Slug)),
			Grant: e.Grant,
			Claim: e.Claim,
			Match: e.Match,
		}
		if e.Grant == GrantOptIn {
			v.Warning = fillLanguages(e.Warning, "")
		}
		set.index[e.Slug] = len(set.entries)
		set.entries = append(set.entries, v)
	}
	return set
}

// fillLanguages returns a de/en map with both keys present: a language missing
// from the file falls back to the other one, and if neither is set to fallback
// (the capitalized slug for labels). Never returns nil so the JSON is stable.
func fillLanguages(in map[string]string, fallback string) map[string]string {
	de := strings.TrimSpace(in["de"])
	en := strings.TrimSpace(in["en"])
	switch {
	case de == "" && en == "":
		de, en = fallback, fallback
	case de == "":
		de = en
	case en == "":
		en = de
	}
	out := map[string]string{"de": de, "en": en}
	// Keep any further languages the file supplied.
	for lang, text := range in {
		if lang != "de" && lang != "en" && strings.TrimSpace(text) != "" {
			out[lang] = text
		}
	}
	return out
}

// validateVisibility refuses a visibility list that could not work: a malformed
// or reserved slug, a slug that collides with a role (the two live in different
// columns today, but a shared namespace keeps future audience/visibility
// features unambiguous), a duplicate, an unknown grant type, an opt-in entry
// without the warning the stakeholder requirement demands, or a claim entry
// without the claim path and value that would grant it. Called from
// Config.validate, so a violation is a startup failure.
func validateVisibility(entries []VisibilityEntry, roles RoleSet) error {
	seen := map[string]bool{}
	for _, e := range entries {
		if e.Slug == AudienceAll {
			return fmt.Errorf("config: visibility slug %q is reserved", e.Slug)
		}
		if !roleSlugPattern.MatchString(e.Slug) {
			return fmt.Errorf("config: visibility slug %q is invalid: must match [a-z0-9-]{1,32}", e.Slug)
		}
		if roles.Has(e.Slug) {
			return fmt.Errorf("config: visibility slug %q collides with a role slug", e.Slug)
		}
		if seen[e.Slug] {
			return fmt.Errorf("config: visibility slug %q is listed twice", e.Slug)
		}
		seen[e.Slug] = true
		switch e.Grant {
		case GrantOptIn:
			if !hasText(e.Warning) {
				return fmt.Errorf("config: visibility %q: grant opt-in requires a warning {de,en}", e.Slug)
			}
		case GrantClaim:
			if strings.TrimSpace(e.Claim) == "" || strings.TrimSpace(e.Match) == "" {
				return fmt.Errorf("config: visibility %q: grant claim requires claim and match", e.Slug)
			}
		default:
			return fmt.Errorf("config: visibility %q: grant must be %q or %q", e.Slug, GrantClaim, GrantOptIn)
		}
	}
	return nil
}

func hasText(m map[string]string) bool {
	for _, v := range m {
		if strings.TrimSpace(v) != "" {
			return true
		}
	}
	return false
}

// List returns the configured slugs in config order. A deep copy: it is handed
// to request handlers that must not be able to corrupt the config.
func (s VisibilitySet) List() []Visibility {
	out := make([]Visibility, 0, len(s.entries))
	for _, v := range s.entries {
		out = append(out, Visibility{
			Slug: v.Slug, Label: maps.Clone(v.Label), Grant: v.Grant,
			Claim: v.Claim, Match: v.Match, Warning: maps.Clone(v.Warning),
		})
	}
	return out
}

// Slugs returns the configured slugs in config order.
func (s VisibilitySet) Slugs() []string {
	out := make([]string, 0, len(s.entries))
	for _, v := range s.entries {
		out = append(out, v.Slug)
	}
	return out
}

// Has reports whether slug is a configured visibility slug.
func (s VisibilitySet) Has(slug string) bool {
	_, ok := s.index[slug]
	return ok
}

// Grant returns the grant type of a configured slug, or "" if unknown.
func (s VisibilitySet) Grant(slug string) string {
	i, ok := s.index[slug]
	if !ok {
		return ""
	}
	return s.entries[i].Grant
}

// Len is the number of configured slugs.
func (s VisibilitySet) Len() int { return len(s.entries) }

// Held computes a user's effective held set from the two stored sources
// (spec §4): visibility_claims ∪ visibility_optin, each filtered to slugs that
// still exist in config AND whose grant type matches the source. So a slug
// flipped from opt-in to claim in config cannot leave self-granted access
// behind, and a slug removed from config grants nothing to anyone. The result
// is in config order, deduplicated, never nil.
func (s VisibilitySet) Held(claims, optin []string) []string {
	held := make([]string, 0, len(s.entries))
	for _, v := range s.entries {
		switch v.Grant {
		case GrantClaim:
			if slices.Contains(claims, v.Slug) {
				held = append(held, v.Slug)
			}
		case GrantOptIn:
			if slices.Contains(optin, v.Slug) {
				held = append(held, v.Slug)
			}
		}
	}
	return held
}

// OptInSlugs returns the slugs a user may enable themselves (grant: opt-in).
func (s VisibilitySet) OptInSlugs() []string {
	out := make([]string, 0, len(s.entries))
	for _, v := range s.entries {
		if v.Grant == GrantOptIn {
			out = append(out, v.Slug)
		}
	}
	return out
}
