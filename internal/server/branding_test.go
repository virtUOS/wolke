package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	if b.ProductName != "IT Service" {
		t.Errorf("product_name = %q, want IT Service", b.ProductName)
	}
	if got := b.Theme.Light["primary"]; got != "#A6093D" {
		t.Errorf("theme.light.primary = %q, want #A6093D", got)
	}
	if b.DefaultLocale != "de" {
		t.Errorf("default_locale = %q, want de", b.DefaultLocale)
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
