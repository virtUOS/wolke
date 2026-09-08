package config

import (
	"reflect"
	"strings"
	"testing"
)

func optIn(slug string) VisibilityEntry {
	return VisibilityEntry{
		Slug: slug, Grant: GrantOptIn,
		Label:   map[string]string{"de": "Experimentell", "en": "Experimental"},
		Warning: map[string]string{"de": "Kann verschwinden.", "en": "May vanish."},
	}
}

func claim(slug string) VisibilityEntry {
	return VisibilityEntry{
		Slug: slug, Grant: GrantClaim, Claim: "groups", Match: "it-service-admins",
		Label: map[string]string{"de": "IT-Infrastruktur", "en": "IT infrastructure"},
	}
}

// Validation runs at startup like oidc.role (docs/specs/service-visibility.md §2).
func TestValidateVisibility(t *testing.T) {
	cfg := Defaults()
	roles := cfg.Roles() // teacher, staff, student
	tests := []struct {
		name    string
		entries []VisibilityEntry
		wantErr string // "" = valid
	}{
		{"no entries is valid", nil, ""},
		{"one opt-in and one claim", []VisibilityEntry{optIn("experimental"), claim("it-infra")}, ""},
		{"bad slug", []VisibilityEntry{optIn("Experimental!")}, "invalid"},
		{"too long", []VisibilityEntry{optIn(strings.Repeat("a", 33))}, "invalid"},
		{"reserved all", []VisibilityEntry{optIn("all")}, "reserved"},
		{"collides with a role", []VisibilityEntry{optIn("staff")}, "collides with a role"},
		{"duplicate", []VisibilityEntry{optIn("x"), claim("x")}, "listed twice"},
		{"unknown grant", []VisibilityEntry{{Slug: "x", Grant: "magic"}}, "grant must be"},
		{"empty grant", []VisibilityEntry{{Slug: "x"}}, "grant must be"},
		{"opt-in without warning", []VisibilityEntry{{Slug: "x", Grant: GrantOptIn}}, "requires a warning"},
		{"opt-in with blank warning", []VisibilityEntry{{Slug: "x", Grant: GrantOptIn, Warning: map[string]string{"de": "  "}}}, "requires a warning"},
		{"claim without claim path", []VisibilityEntry{{Slug: "x", Grant: GrantClaim, Match: "g"}}, "requires claim and match"},
		{"claim without match", []VisibilityEntry{{Slug: "x", Grant: GrantClaim, Claim: "groups"}}, "requires claim and match"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVisibility(tt.entries, roles)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("want valid, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("err = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

// The file is the only source of the block (env cannot set nested lists), and a
// violation fails load — the same contract as the role mapping.
func TestVisibilityLoadsFromFileAndFailsStartupWhenInvalid(t *testing.T) {
	good := writeTemp(t, `
visibility:
  - slug: it-infra
    label: { de: "IT-Infrastruktur", en: "IT infrastructure" }
    grant: claim
    claim: groups
    match: it-service-admins
  - slug: experimental
    label: { de: "Experimentell" }
    grant: opt-in
    warning: { de: "Kann jederzeit verschwinden." }
`)
	cfg, err := load(good, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	vis := cfg.Visibility()
	if got := vis.Slugs(); !reflect.DeepEqual(got, []string{"it-infra", "experimental"}) {
		t.Fatalf("slugs = %v, want config order", got)
	}
	list := vis.List()
	if list[1].Label["en"] != "Experimentell" {
		t.Errorf("missing en label should fall back to de, got %q", list[1].Label["en"])
	}
	if list[1].Warning["en"] != "Kann jederzeit verschwinden." {
		t.Errorf("missing en warning should fall back to de, got %q", list[1].Warning["en"])
	}
	if list[0].Warning != nil {
		t.Errorf("claim entry must carry no warning, got %v", list[0].Warning)
	}
	if vis.Grant("it-infra") != GrantClaim || vis.Grant("experimental") != GrantOptIn || vis.Grant("nope") != "" {
		t.Error("Grant() does not report the configured grant types")
	}

	bad := writeTemp(t, `
visibility:
  - slug: experimental
    grant: opt-in
`)
	if _, err := load(bad, envMap(nil)); err == nil {
		t.Fatal("load: want startup error for an opt-in entry without a warning, got nil")
	}
	collides := writeTemp(t, `
visibility:
  - slug: student
    grant: claim
    claim: groups
    match: x
`)
	if _, err := load(collides, envMap(nil)); err == nil {
		t.Fatal("load: want startup error for a slug colliding with a role, got nil")
	}
}

// The zero value / an unconfigured deployment: nothing is held, nothing exists.
func TestEmptyVisibilitySet(t *testing.T) {
	var s VisibilitySet
	if s.Has("experimental") || s.Len() != 0 || len(s.List()) != 0 {
		t.Error("zero VisibilitySet must be empty")
	}
	if held := s.Held([]string{"experimental"}, []string{"experimental"}); len(held) != 0 {
		t.Errorf("held = %v, want nothing: unconfigured slugs grant nothing", held)
	}
	cfg := Defaults()
	if cfg.Visibility().Len() != 0 {
		t.Error("defaults must configure no visibility entries")
	}
}

// The effective held set is claims ∪ opt-in, each filtered to configured slugs
// whose grant type matches the source (spec §4). Flipping a slug from opt-in to
// claim in config must not leave self-granted access behind.
func TestHeldFiltersBySourceAndGrantType(t *testing.T) {
	set := newVisibilitySet([]VisibilityEntry{claim("it-infra"), optIn("experimental"), optIn("beta-tools")})

	tests := []struct {
		name   string
		claims []string
		optin  []string
		want   []string
	}{
		{"nothing held", nil, nil, []string{}},
		{"opt-in grants an opt-in slug", nil, []string{"experimental"}, []string{"experimental"}},
		{"claim grants a claim slug", []string{"it-infra"}, nil, []string{"it-infra"}},
		{"union, in config order", []string{"it-infra"}, []string{"beta-tools", "experimental"}, []string{"it-infra", "experimental", "beta-tools"}},
		// The mismatch cases: a source can only grant slugs of its own type.
		{"opt-in cannot grant a claim slug", nil, []string{"it-infra"}, []string{}},
		{"a claim cannot grant an opt-in slug", []string{"experimental"}, nil, []string{}},
		{"unconfigured slugs are dropped", []string{"gone"}, []string{"gone", "experimental"}, []string{"experimental"}},
		{"duplicates collapse", nil, []string{"experimental", "experimental"}, []string{"experimental"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := set.Held(tt.claims, tt.optin)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Held(%v, %v) = %v, want %v", tt.claims, tt.optin, got, tt.want)
			}
		})
	}

	// Flipping experimental to a claim grant: the user's stored opt-in no longer counts.
	flipped := newVisibilitySet([]VisibilityEntry{claim("experimental")})
	if got := flipped.Held(nil, []string{"experimental"}); len(got) != 0 {
		t.Errorf("after flipping to claim, stored opt-in still grants %v", got)
	}
	if got := set.OptInSlugs(); !reflect.DeepEqual(got, []string{"experimental", "beta-tools"}) {
		t.Errorf("OptInSlugs = %v", got)
	}
}

// List() hands out copies: a handler mutating a label must not reach the config.
func TestVisibilityListIsACopy(t *testing.T) {
	set := newVisibilitySet([]VisibilityEntry{optIn("experimental")})
	set.List()[0].Label["de"] = "mutated"
	set.List()[0].Warning["de"] = "mutated"
	if set.List()[0].Label["de"] == "mutated" || set.List()[0].Warning["de"] == "mutated" {
		t.Error("List() must deep-copy labels and warnings")
	}
}
