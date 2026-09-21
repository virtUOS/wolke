package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

func TestBrandingReturnsDefaultSkin(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.ProductName != "wolke" {
		t.Errorf("product_name = %q, want wolke", b.ProductName)
	}
	if got := b.Theme.Light["primary"]; got != "#A6093D" {
		t.Errorf("theme.light.primary = %q, want #A6093D", got)
	}
	if b.DefaultLocale != "de" {
		t.Errorf("default_locale = %q, want de", b.DefaultLocale)
	}
}

func TestBrandingDefaultPaletteComplete(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// The full brand-overridable palette (docs/03 §2) must ship in both maps so a
	// skin can recolour every semantic role without falling back to a CSS default.
	want := []string{
		"primary", "primary_hover", "accent", "favorite",
		"surface", "surface_2", "border",
		"text", "text_muted",
		"info", "warning", "success", "danger",
	}
	for _, key := range want {
		if v, ok := b.Theme.Light[key]; !ok || v == "" {
			t.Errorf("theme.light missing token %q", key)
		}
		if v, ok := b.Theme.Dark[key]; !ok || v == "" {
			t.Errorf("theme.dark missing token %q", key)
		}
	}
}

// Issue #214: typography is branding too. The payload carries the font roles
// so the SPA can set --font-body / --font-display from config; they sit beside
// the theme rather than inside it, because a face is not per-theme.
func TestBrandingShipsFontRoles(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, role := range []string{"body", "display"} {
		v, ok := b.Fonts[role]
		if !ok || v == "" {
			t.Errorf("fonts missing the %q role", role)
			continue
		}
		// Every served stack ends in a generic family, so a client that cannot
		// load the named face still renders text (issue #214, rule 5).
		if !strings.Contains(v, "sans-serif") && !strings.Contains(v, "serif") && !strings.Contains(v, "monospace") {
			t.Errorf("fonts.%s = %q, want a generic family at the end of the stack", role, v)
		}
	}
}

func TestBrandingReflectsOverride(t *testing.T) {
	cfg := config.Defaults()
	cfg.Branding.ProductName = "Campus Apps"
	cfg.Branding.Theme.Light["primary"] = "#0055FF"
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.ProductName != "Campus Apps" {
		t.Errorf("product_name = %q, want override", b.ProductName)
	}
	if got := b.Theme.Light["primary"]; got != "#0055FF" {
		t.Errorf("theme.light.primary = %q, want override", got)
	}
}

// news_url reaches the SPA through /api/branding like every other optional
// link, and is absent (empty) by default so the panel's link stays hidden.
func TestBrandingServesNewsURL(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})
	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.NewsURL != "" {
		t.Errorf("news_url = %q, want empty by default", b.NewsURL)
	}

	cfg.Branding.NewsURL = "https://news.example.edu"
	h = newTestRouter(t, &cfg, Deps{})
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/branding", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.NewsURL != "https://news.example.edu" {
		t.Errorf("news_url = %q, want the configured value", b.NewsURL)
	}
}

func TestBrandingAssetServedWhenDirPresent(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "logo-light.svg"), []byte("<svg/>"), 0o600); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	cfg := config.Defaults()
	cfg.BrandingDir = dir
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/branding/logo-light.svg", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "<svg/>" {
		t.Errorf("body = %q, want asset contents", rec.Body.String())
	}
}

func TestBrandingAssetRouteAbsentWhenNoDir(t *testing.T) {
	cfg := config.Defaults()
	cfg.BrandingDir = filepath.Join(t.TempDir(), "does-not-exist")
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/branding/logo-light.svg", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 when no branding dir", rec.Code)
	}
}

// TestBrandingAllowlistServesEveryKnownAsset asserts each referenced asset
// filename (README "Branding assets", docs/02 §11.1) serves with a sane
// Content-Type when present in the mounted dir. Seven of them are the bundled
// set every mount must provide; watermark.svg (issue #174) is the optional
// eighth, served when a deployment drops it in.
func TestBrandingAllowlistServesEveryKnownAsset(t *testing.T) {
	dir := t.TempDir()
	assets := map[string]string{
		"logo-light.svg":        "<svg/>",
		"logo-dark.svg":         "<svg/>",
		"favicon.svg":           "<svg/>",
		"icon-192.png":          "fake-png-192",
		"icon-512.png":          "fake-png-512",
		"icon-maskable-512.png": "fake-png-maskable",
		"apple-touch-icon.png":  "fake-png-apple",
		"watermark.svg":         "<svg/>",
	}
	for name, body := range assets {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write asset %s: %v", name, err)
		}
	}
	cfg := config.Defaults()
	cfg.BrandingDir = dir
	h := newTestRouter(t, &cfg, Deps{})

	wantContentType := map[string]string{
		".svg": "image/svg+xml",
		".png": "image/png",
	}

	for name, body := range assets {
		req := httptest.NewRequest(http.MethodGet, "/branding/"+name, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200", name, rec.Code)
			continue
		}
		if rec.Body.String() != body {
			t.Errorf("%s: body = %q, want %q", name, rec.Body.String(), body)
		}
		ext := filepath.Ext(name)
		if want := wantContentType[ext]; want != "" {
			if got := rec.Header().Get("Content-Type"); got != want {
				t.Errorf("%s: content-type = %q, want %q", name, got, want)
			}
		}
	}
}

// TestBrandingDirectoryRequestNotFound: GET /branding/ must never return a
// directory listing, even when the mounted dir has files in it.
func TestBrandingDirectoryRequestNotFound(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "logo-light.svg"), []byte("<svg/>"), 0o600); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	cfg := config.Defaults()
	cfg.BrandingDir = dir
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/branding/", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for directory request", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "logo-light.svg") {
		t.Errorf("body = %q, must not list directory contents", rec.Body.String())
	}
}

// TestBrandingUnknownFilenameNotServed: a stray file in the mounted dir that
// isn't one of the allowlisted asset names must 404, not leak.
func TestBrandingUnknownFilenameNotServed(t *testing.T) {
	dir := t.TempDir()
	stray := map[string]string{
		"notes.txt":       "internal notes, not for the public",
		"logo-draft.svg":  "<svg/>",
		"logo-light.svg2": "<svg/>",
	}
	for name, body := range stray {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write stray %s: %v", name, err)
		}
	}
	cfg := config.Defaults()
	cfg.BrandingDir = dir
	h := newTestRouter(t, &cfg, Deps{})

	for name := range stray {
		req := httptest.NewRequest(http.MethodGet, "/branding/"+name, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404 (stray file must not be servable)", name, rec.Code)
		}
	}
}

// TestBrandingMissingAllowlistedFileNotFound: an allowlisted name that simply
// isn't present in the dir still 404s — no per-file fallback (README).
func TestBrandingMissingAllowlistedFileNotFound(t *testing.T) {
	dir := t.TempDir()
	// Dir exists but is otherwise empty.
	cfg := config.Defaults()
	cfg.BrandingDir = dir
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/branding/icon-512.png", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for missing allowlisted file", rec.Code)
	}
}

// TestBrandingWatermarkDefaultsOff pins issue #174's one deliberate departure
// from how every other branding asset behaves: the institution-mark watermark
// defaults to the empty string, i.e. off. A mask-image that fails to load does
// not reliably hide its box, and a deployment that mounts its own branding dir
// without a watermark.svg would get a 404 for the mask — so the SPA must have a
// config gate to render nothing at all, and the default must sit on the safe
// side of it.
func TestBrandingWatermarkDefaultsOff(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// The field must be present in the payload (so the SPA can read it without
	// an undefined check) and empty (so it renders nothing by default).
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, ok := raw["watermark"]; !ok {
		t.Fatalf("/api/branding is missing the watermark field: %s", rec.Body.String())
	}
	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.Watermark != "" {
		t.Errorf("watermark = %q, want empty (opt-in per issue #174)", b.Watermark)
	}
}

// TestBrandingWatermarkConfigured: a deployment opting in gets the path it set
// back from /api/branding verbatim — the SPA masks with that URL, never with a
// constant.
func TestBrandingWatermarkConfigured(t *testing.T) {
	cfg := config.Defaults()
	cfg.Branding.Watermark = "/branding/watermark.svg"
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/api/branding", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var b config.Branding
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b.Watermark != "/branding/watermark.svg" {
		t.Errorf("watermark = %q, want the configured path", b.Watermark)
	}
}

// TestBrandingWatermarkAssetServed: watermark.svg is on the allowlist and
// serves from a mounted dir, while a near-miss neighbour in the same dir still
// 404s — the allowlist stays a closed set, an opt-in asset doesn't loosen it.
func TestBrandingWatermarkAssetServed(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"watermark.svg":      "<svg id=\"mark\"/>",
		"watermark-alt.svg":  "<svg/>",
		"watermark.svg.orig": "<svg/>",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	cfg := config.Defaults()
	cfg.BrandingDir = dir
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/branding/watermark.svg", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("watermark.svg: status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != files["watermark.svg"] {
		t.Errorf("watermark.svg: body = %q, want asset contents", rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "image/svg+xml" {
		t.Errorf("watermark.svg: content-type = %q, want image/svg+xml", got)
	}

	for _, name := range []string{"watermark-alt.svg", "watermark.svg.orig"} {
		req := httptest.NewRequest(http.MethodGet, "/branding/"+name, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404 (not allowlisted)", name, rec.Code)
		}
	}
}
