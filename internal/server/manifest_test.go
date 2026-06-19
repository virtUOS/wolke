package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

func TestManifest(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("manifest = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("Content-Type = %q, want application/manifest+json", ct)
	}
	body := rec.Body.String()
	// White-label: name comes from branding; icons point at the overridable
	// branding dir; standalone display makes it installable.
	for _, want := range []string{
		`"name":"` + cfg.Branding.ProductName + `"`,
		`"display":"standalone"`,
		`/branding/icon-512.png`,
		`"purpose":"maskable"`,
		`"start_url":"/"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("manifest missing %q in %s", want, body)
		}
	}
}
