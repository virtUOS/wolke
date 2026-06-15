package server

import (
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/virtuos/wolke/internal/config"
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
// from the configured directory. The route is always registered and always
// public, so brand assets never fall through to the auth stub or the SPA shell:
// with no asset dir (or a missing file) it simply 404s.
func mountBranding(r chi.Router, dir string) {
	if dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			fs := http.StripPrefix("/branding/", http.FileServer(http.Dir(dir)))
			r.Handle("/branding/*", fs)
			return
		}
	}
	r.Handle("/branding/*", http.HandlerFunc(http.NotFound))
}
