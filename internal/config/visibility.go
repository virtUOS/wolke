package config

// Visibility slugs are deployment data, not code
// (docs/specs/service-visibility.md §2.2). A slug restricts a *category* — and
// every service in it — to the users who hold that slug, and a slug is held
// exactly one way: an IdP claim granted it at login. There is no self-service
// flavour here; "show me the experimental stuff" is the beta tag plus a user
// pref, which needs no configuration at all (§2.1).
//
// Config carries only the claim mapping, because there is no way to guess which
// IdP group grants membership. No configured entries means no behaviour change:
// every category is public, and a category cannot be restricted at all.

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

// VisibilityEntry is one configured visibility slug, as it appears in the
// `visibility:` list of the config file.
type VisibilityEntry struct {
	Slug  string            `yaml:"slug"`
	Label map[string]string `yaml:"label"`
	// Claim is a (possibly nested) claim path and Match the value in it that
	// grants the slug — exactly the shape of oidc.admin.
	Claim string `yaml:"claim"`
	Match string `yaml:"match"`
}

// Visibility is one configured slug as the read paths and the API see it: the
// slug and its display labels. Labels are complete (both languages filled) even
// when the file supplied only one. Claim and Match are login-side detail and
// never leave the server. The json tags are the /api/me shape.
type Visibility struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
	Claim string            `json:"-"`
	Match string            `json:"-"`
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
		if strings.TrimSpace(e.Claim) == "" || strings.TrimSpace(e.Match) == "" {
			continue
		}
		v := Visibility{
			Slug:  e.Slug,
			Label: fillLanguages(e.Label, capitalize(e.Slug)),
			Claim: e.Claim,
			Match: e.Match,
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
// features unambiguous), a duplicate, or an entry without the claim path and
// value that would grant it. Called from Config.validate, so a violation is a
// startup failure.
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
		if strings.TrimSpace(e.Claim) == "" || strings.TrimSpace(e.Match) == "" {
			return fmt.Errorf("config: visibility %q requires claim and match (the IdP claim granting it)", e.Slug)
		}
	}
	return nil
}

// List returns the configured slugs in config order. A deep copy: it is handed
// to request handlers that must not be able to corrupt the config.
func (s VisibilitySet) List() []Visibility {
	out := make([]Visibility, 0, len(s.entries))
	for _, v := range s.entries {
		out = append(out, Visibility{
			Slug: v.Slug, Label: maps.Clone(v.Label), Claim: v.Claim, Match: v.Match,
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

// Len is the number of configured slugs.
func (s VisibilitySet) Len() int { return len(s.entries) }

// Held filters a user's stored visibility_claims to the slugs config still
// defines, so a slug removed from config grants nothing to anyone. The result
// is in config order, deduplicated, never nil.
func (s VisibilitySet) Held(claims []string) []string {
	held := make([]string, 0, len(s.entries))
	for _, v := range s.entries {
		if slices.Contains(claims, v.Slug) {
			held = append(held, v.Slug)
		}
	}
	return held
}
