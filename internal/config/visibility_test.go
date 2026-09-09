package config

import (
	"reflect"
	"strings"
	"testing"
)

func group(slug string) VisibilityEntry {
	return VisibilityEntry{
		Slug: slug, Claim: "groups", Match: slug + "-admins",
		Label: map[string]string{"de": "IT-Infrastruktur", "en": "IT infrastructure"},
	}
}

// Validation runs at startup like oidc.role (docs/specs/service-visibility.md §2.2).
func TestValidateVisibility(t *testing.T) {
	cfg := Defaults()
	roles := cfg.Roles() // teacher, staff, student
	tests := []struct {
		name    string
		entries []VisibilityEntry
		wantErr string // "" = valid
	}{
		{"no entries is valid", nil, ""},
		{"two groups", []VisibilityEntry{group("it-infra"), group("net-ops")}, ""},
		{"bad slug", []VisibilityEntry{group("IT-Infra!")}, "invalid"},
		{"too long", []VisibilityEntry{group(strings.Repeat("a", 33))}, "invalid"},
		{"reserved all", []VisibilityEntry{group("all")}, "reserved"},
		{"collides with a role", []VisibilityEntry{group("staff")}, "collides with a role"},
		{"duplicate", []VisibilityEntry{group("x"), group("x")}, "listed twice"},
		{"without claim path", []VisibilityEntry{{Slug: "x", Match: "g"}}, "requires claim and match"},
		{"without match", []VisibilityEntry{{Slug: "x", Claim: "groups"}}, "requires claim and match"},
		{"blank claim", []VisibilityEntry{{Slug: "x", Claim: "  ", Match: "g"}}, "requires claim and match"},
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
    claim: groups
    match: it-service-admins
  - slug: net-ops
    label: { de: "Netzbetrieb" }
    claim: realm_access.roles
    match: network
`)
	cfg, err := load(good, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	vis := cfg.Visibility()
	if got := vis.Slugs(); !reflect.DeepEqual(got, []string{"it-infra", "net-ops"}) {
		t.Fatalf("slugs = %v, want config order", got)
	}
	list := vis.List()
	if list[1].Label["en"] != "Netzbetrieb" {
		t.Errorf("missing en label should fall back to de, got %q", list[1].Label["en"])
	}
	if list[1].Claim != "realm_access.roles" || list[1].Match != "network" {
		t.Errorf("claim mapping not carried through: %+v", list[1])
	}

	bad := writeTemp(t, `
visibility:
  - slug: it-infra
    label: { de: "IT-Infrastruktur" }
`)
	if _, err := load(bad, envMap(nil)); err == nil {
		t.Fatal("load: want startup error for an entry without claim/match, got nil")
	}
	collides := writeTemp(t, `
visibility:
  - slug: student
    claim: groups
    match: x
`)
	if _, err := load(collides, envMap(nil)); err == nil {
		t.Fatal("load: want startup error for a slug colliding with a role, got nil")
	}
}

// A slug with no label renders as the capitalized slug in both languages —
// the label is optional and plays no part in the claim mapping.
func TestVisibilityLabelDefaultsToTheSlug(t *testing.T) {
	set := newVisibilitySet([]VisibilityEntry{{Slug: "infra", Claim: "groups", Match: "g"}})
	if got := set.List()[0].Label; got["de"] != "Infra" || got["en"] != "Infra" {
		t.Errorf("label = %v, want the capitalized slug in both languages", got)
	}
}

// The zero value / an unconfigured deployment: nothing is held, nothing exists.
func TestEmptyVisibilitySet(t *testing.T) {
	var s VisibilitySet
	if s.Has("it-infra") || s.Len() != 0 || len(s.List()) != 0 {
		t.Error("zero VisibilitySet must be empty")
	}
	if held := s.Held([]string{"it-infra"}); len(held) != 0 {
		t.Errorf("held = %v, want nothing: unconfigured slugs grant nothing", held)
	}
	cfg := Defaults()
	if cfg.Visibility().Len() != 0 {
		t.Error("defaults must configure no visibility entries")
	}
}

// Held filters the stored claim-granted slugs to what config still defines, in
// config order (spec §2.2).
func TestHeldFiltersToConfiguredSlugs(t *testing.T) {
	set := newVisibilitySet([]VisibilityEntry{group("it-infra"), group("net-ops")})

	tests := []struct {
		name   string
		claims []string
		want   []string
	}{
		{"nothing held", nil, []string{}},
		{"one slug", []string{"it-infra"}, []string{"it-infra"}},
		{"config order, not claim order", []string{"net-ops", "it-infra"}, []string{"it-infra", "net-ops"}},
		{"a slug removed from config grants nothing", []string{"gone"}, []string{}},
		{"duplicates collapse", []string{"it-infra", "it-infra"}, []string{"it-infra"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := set.Held(tt.claims)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Held(%v) = %v, want %v", tt.claims, got, tt.want)
			}
		})
	}
}

// List() hands out copies: a handler mutating a label must not reach the config.
func TestVisibilityListIsACopy(t *testing.T) {
	set := newVisibilitySet([]VisibilityEntry{group("it-infra")})
	set.List()[0].Label["de"] = "mutated"
	if set.List()[0].Label["de"] == "mutated" {
		t.Error("List() must deep-copy labels")
	}
}
