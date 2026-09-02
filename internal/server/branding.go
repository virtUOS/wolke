package server

import (
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/virtuos/wolke/internal/config"
)

// brandingAssetAllowlist is the closed set of filenames the product actually
// references (README "Branding assets", docs/02 §11.1). The mounted dir is
// public and unauthenticated, so anything not on this list 404s — a stray
// file (a draft, notes, a leftover secret) must never become downloadable
// just by matching a directory listing.
var brandingAssetAllowlist = map[string]bool{
	"logo-light.svg":        true,
	"logo-dark.svg":         true,
	"favicon.svg":           true,
	"icon-192.png":          true,
	"icon-512.png":          true,
	"icon-maskable-512.png": true,
	"apple-touch-icon.png":  true,
}

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
//
// Only the allowlisted filenames in brandingAssetAllowlist are ever served —
// http.FileServer on its own would autoindex the directory and serve any
// stray file in it, since this route is deliberately unauthenticated.
func mountBranding(r chi.Router, dir string) {
	if dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			fs := http.StripPrefix("/branding/", http.FileServer(http.Dir(dir)))
			r.Handle("/branding/*", allowlistedAssetsOnly(fs))
			return
		}
	}
	r.Handle("/branding/*", http.HandlerFunc(http.NotFound))
}

// allowlistedAssetsOnly rejects any request whose path (after stripping
// /branding/) isn't exactly one of the known asset filenames, before it
// reaches the file server. This closes off both the directory autoindex
// (the empty name) and any file present in the dir that isn't one of the
// seven referenced assets — including a subpath or a traversal attempt,
// which never matches an allowlist entry because it still contains a "/".
func allowlistedAssetsOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		name := strings.TrimPrefix(req.URL.Path, "/branding/")
		if name == "" || strings.Contains(name, "/") || !brandingAssetAllowlist[name] {
			http.NotFound(w, req)
			return
		}
		next.ServeHTTP(w, req)
	})
}
