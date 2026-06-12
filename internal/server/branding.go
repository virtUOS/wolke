package server

import (
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/virtUOS/service-hub/internal/config"
)

// branding serves the active skin (product name, org, logo URLs, theme tokens,
// locale) at GET /api/branding. It is intentionally public — no session — so the
// SPA can theme the login screen on first paint (docs/02 §12, §11; docs/03 §2).
// The SPA applies the tokens as CSS variables at runtime, so a fork re-skins by
// editing branding.yaml and swapping assets, with no rebuild.
func branding(b config.Branding) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		// Branding is near-static; let clients cache briefly.
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, b)
	}
}

// mountBranding serves mounted brand assets (logos, favicon) under /branding/
// from the configured directory, if it exists. Paths in the branding payload
// (logo_light, …) resolve here. Absent in a deployment → the route 404s and the
// SPA falls back gracefully.
func mountBranding(r chi.Router, dir string) {
	if dir == "" {
		return
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return
	}
	fs := http.StripPrefix("/branding/", http.FileServer(http.Dir(dir)))
	r.Handle("/branding/*", fs)
}
