package config

import "testing"

// Issue #220: the launcher greeting's trailing full stop is set in the brand
// primary, and `branding.greeting_accent` is the deployment's opt-out.
//
// The key is snake_case like every other key in the branding payload
// (product_name, logo_light, news_url, watermark) — a lone camelCase name would
// be the odd one out in the same JSON object.
//
// Unlike watermark, news_url, --favorite and the font tokens, this one defaults
// to ON: the accent uses the deployer's own --primary, so a fork gets its own
// brand colour rather than ours, and there is nothing to opt into. That makes
// the default the thing worth pinning — flipping it would change what every
// deployment renders.

func TestGreetingAccentDefaultsOn(t *testing.T) {
	if !Defaults().Branding.GreetingAccent {
		t.Error("branding.greeting_accent = false by default, want true")
	}
}

func TestGreetingAccentCanBeTurnedOff(t *testing.T) {
	cfg, err := load(writeTemp(t, `
public_url: https://hub.example.edu
branding:
  greeting_accent: false
`), envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Branding.GreetingAccent {
		t.Error("greeting_accent = true after the file set it false")
	}
}

// A file that says nothing about it keeps the default. This is the half a bool
// setting can get wrong: unmarshalling onto the defaulted struct leaves an
// absent key alone, but a `bool` also has `false` as its zero value, so a
// future refactor that rebuilds Branding from the file instead of overlaying
// would silently turn the accent off everywhere.
func TestGreetingAccentSurvivesAnUnrelatedBrandingFile(t *testing.T) {
	cfg, err := load(writeTemp(t, `
public_url: https://hub.example.edu
branding:
  product_name: Campus Apps
`), envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if !cfg.Branding.GreetingAccent {
		t.Error("greeting_accent = false after a file that never mentioned it")
	}
}
