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
		"primary", "primary_hover", "accent",
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

// TestBrandingAllowlistServesEveryKnownAsset asserts each of the seven
// referenced asset filenames (README "Branding assets", docs/02 §11.1) serves
// with a sane Content-Type when present in the mounted dir.
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
