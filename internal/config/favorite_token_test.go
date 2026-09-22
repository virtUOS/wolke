package config

import "testing"

// Issue #211: the favourites star gets its own token so a skin can retint it
// without dragging the segmented pill, the tile hover wash and the light canvas
// tint along with it.
//
// The *default* is deliberately the accent value in both themes: that is what
// makes the split a visual no-op on merge, and it is the half a later palette
// edit is most likely to break by touching one line and not the other.
func TestFavoriteDefaultsToAccent(t *testing.T) {
	theme := Defaults().Branding.Theme
	for _, m := range []struct {
		name   string
		tokens map[string]string
	}{{"light", theme.Light}, {"dark", theme.Dark}} {
		accent, ok := m.tokens["accent"]
		if !ok {
			t.Fatalf("theme.%s has no accent token", m.name)
		}
		if got := m.tokens["favorite"]; got != accent {
			t.Errorf("theme.%s favorite = %q, want the accent value %q — the split must merge as a no-op",
				m.name, got, accent)
		}
	}
}

// …and it is overridable on its own, like every other colour: a deployer setting
// `favorite` in branding.yaml moves the star and leaves the warm wash alone.
func TestFavoriteOverrideLeavesAccentAlone(t *testing.T) {
	path := writeTemp(t, `
public_url: https://hub.example.edu
branding:
  theme:
    light:
      favorite: "#1D4ED8"
`)
	cfg, err := load(path, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	light := cfg.Branding.Theme.Light
	if got := light["favorite"]; got != "#1D4ED8" {
		t.Errorf("light favorite = %q, want the override #1D4ED8", got)
	}
	if got, want := light["accent"], Defaults().Branding.Theme.Light["accent"]; got != want {
		t.Errorf("light accent = %q, want the default %q — retinting the star must not move the wash", got, want)
	}
}
