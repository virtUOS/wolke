package server

import (
	"encoding/json"
	"net/http"

	"github.com/virtuos/wolke/internal/config"
)

// manifest serves the Web App Manifest built from the runtime branding, so the
// installable PWA is white-label like the rest of the app (CLAUDE.md rule 8;
// mirrors /api/branding). Icons live in the branding dir (/branding/*) so a
// deployment overrides them exactly like the logo. Public + session-free: the
// browser fetches it before login.
func manifest(b config.Branding) http.HandlerFunc {
	lang := b.DefaultLocale
	if lang == "" {
		lang = "de"
	}
	doc := map[string]any{
		"id":               "/",
		"name":             b.ProductName,
		"short_name":       b.ProductName,
		"description":      b.OrgName,
		"lang":             lang,
		"start_url":        "/",
		"scope":            "/",
		"display":          "standalone",
		"theme_color":      themeValue(b.Theme.Light, "primary", "#A6093D"),
		"background_color": themeValue(b.Theme.Light, "surface", "#ffffff"),
		"icons": []map[string]any{
			{"src": "/branding/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
			{"src": "/branding/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
			{"src": "/branding/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
		},
	}
	body, _ := json.Marshal(doc) // built once; branding is fixed for the process
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")
		_, _ = w.Write(body)
	}
}

func themeValue(m map[string]string, key, fallback string) string {
	if v, ok := m[key]; ok && v != "" {
		return v
	}
	return fallback
}
