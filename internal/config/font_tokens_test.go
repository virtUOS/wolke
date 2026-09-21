package config

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Issue #214: typography joins the branding payload. `--font-body` and
// `--font-display` become real tokens a deployment can set, so a skin can
// choose a family without a code change.
//
// The shape decision the issue asked for: fonts are NOT per-theme. A skin
// re-colours across light and dark; it does not re-face. So they live in their
// own `branding.fonts` map rather than being copied into Theme.Light and
// Theme.Dark, where the two copies could drift apart and neither name would say
// which one wins.

func TestFontDefaultsCoverBothRoles(t *testing.T) {
	fonts := Defaults().Branding.Fonts
	for _, role := range []string{"body", "display"} {
		if v := fonts[role]; v == "" {
			t.Errorf("branding.fonts is missing the %q role", role)
		}
	}
	// Issue #213 settled the display role on the body family: the greeting is
	// told apart by weight and size, not a second face. Merging #214 must not
	// change a pixel, so the two defaults start equal.
	if fonts["display"] != fonts["body"] {
		t.Errorf("display = %q, want the body family %q — the default must stay a visual no-op",
			fonts["display"], fonts["body"])
	}
	// …and they must match the first-paint fallbacks in web-ui/src/index.css.
	// That is asserted on the CSS side (web-ui/src/__tests__/font-tokens.test.ts),
	// which can read the stylesheet; here we only pin that the stack is real.
	if !strings.Contains(fonts["body"], "Hanken Grotesk") {
		t.Errorf("body = %q, want the bundled face", fonts["body"])
	}
}

// Rule 5 of the issue: a skin naming a face the client cannot load must degrade
// to a system face, never to nothing. The stack is the deployer's to write, so
// the guarantee has to be a startup check — there is no runtime place to add a
// fallback that would not also silently rewrite what they asked for.
func TestFontsMustEndInAGenericFamily(t *testing.T) {
	_, err := load(writeTemp(t, `
public_url: https://hub.example.edu
branding:
  fonts:
    body: "'Corporate Sans'"
`), envMap(nil))
	if err == nil {
		t.Fatal("load: want an error for a stack with no generic fallback, got nil")
	}
	if !strings.Contains(err.Error(), "fonts.body") {
		t.Errorf("error = %q, want it to name the setting", err)
	}
}

func TestFontsAcceptASystemStack(t *testing.T) {
	cfg, err := load(writeTemp(t, `
public_url: https://hub.example.edu
branding:
  fonts:
    body: "'Corporate Sans', system-ui, sans-serif"
`), envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.Branding.Fonts["body"]; got != "'Corporate Sans', system-ui, sans-serif" {
		t.Errorf("fonts.body = %q, want the override", got)
	}
	// One role at a time: the map merges onto the defaults like theme tokens do,
	// so a skin that only re-faces headings keeps the bundled body face.
	if got, want := cfg.Branding.Fonts["display"], Defaults().Branding.Fonts["display"]; got != want {
		t.Errorf("fonts.display = %q, want the untouched default %q", got, want)
	}
}

func TestFontsRejectAnUnknownRole(t *testing.T) {
	_, err := load(writeTemp(t, `
public_url: https://hub.example.edu
branding:
  fonts:
    heading: "system-ui, sans-serif"
`), envMap(nil))
	// A typo'd role would otherwise define a variable nothing reads, and the
	// deployer would see the bundled face and no explanation.
	if err == nil {
		t.Fatal("load: want an error for an unknown font role, got nil")
	}
	if !strings.Contains(err.Error(), "heading") {
		t.Errorf("error = %q, want it to name the unknown role", err)
	}
}

func TestFontsRejectACSSTerminator(t *testing.T) {
	// The value is interpolated into a stylesheet by applyBrandingTokens, so a
	// `;` or `}` in it would end the declaration (or the rule) and let the rest
	// of the value become CSS of its own.
	for _, bad := range []string{
		"system-ui; color: red", "system-ui } :root { --primary: red",
	} {
		if _, err := load(writeTemp(t, `
public_url: https://hub.example.edu
branding:
  fonts:
    display: "`+bad+`"
`), envMap(nil)); err == nil {
			t.Errorf("load(%q): want an error, got nil", bad)
		}
	}
}

// Fonts are not colours: they must not appear in the per-theme maps, or a skin
// would have to set the same family twice and could set it differently.
func TestFontsAreNotThemeTokens(t *testing.T) {
	theme := Defaults().Branding.Theme
	for _, m := range []map[string]string{theme.Light, theme.Dark} {
		for key := range m {
			if strings.HasPrefix(key, "font") {
				t.Errorf("theme map carries %q — fonts belong in branding.fonts, not per theme", key)
			}
		}
	}
}

// The bundled default and the stylesheet's first-paint fallback are two copies
// of one stack: the SPA renders with the CSS value until GET /api/branding
// resolves, and then with this one. If they drift, every first paint flashes a
// different face — a bug nobody would think to look for in Go.
//
// This is the only place a Go test reads a frontend file, and it is worth the
// oddity: the duplication is real and unavoidable (the stylesheet has to work
// before any request has been made), so something has to hold the two together,
// and the authoritative value is the one here.
func TestBundledSansMatchesTheStylesheetFallback(t *testing.T) {
	css, err := os.ReadFile(filepath.Join("..", "..", "web-ui", "src", "index.css"))
	if err != nil {
		t.Fatalf("read index.css: %v", err)
	}
	root := regexp.MustCompile(`(?ms)^:root \{(.*?)^\}`).FindSubmatch(css)
	if root == nil {
		t.Fatal("index.css has no :root block")
	}
	for _, role := range []string{"body", "display"} {
		m := regexp.MustCompile(`--font-` + role + `:\s*([^;]+);`).FindSubmatch(root[1])
		if m == nil {
			t.Errorf("index.css :root has no --font-%s fallback", role)
			continue
		}
		if got, want := string(m[1]), Defaults().Branding.Fonts[role]; got != want {
			t.Errorf("index.css --font-%s = %q, want the bundled default %q", role, got, want)
		}
	}
}
