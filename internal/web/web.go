// Package web embeds the built React SPA and serves it as static assets with
// SPA-fallback routing, from the single Go binary (docs/02 §2).
package web

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the embedded SPA rooted at dist/.
func FS() (fs.FS, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("sub dist fs: %w", err)
	}
	return sub, nil
}

// SPAHandler serves files from fsys and falls back to index.html for unknown
// paths, so client-side routes deep-link correctly. Unknown /api/ paths return
// 404 rather than index.html, so a missing API endpoint never masquerades as the
// app shell.
func SPAHandler(fsys fs.FS) (http.Handler, error) {
	index, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		return nil, fmt.Errorf("read embedded index.html: %w", err)
	}
	fileServer := http.FileServer(http.FS(fsys))

	serveIndex := func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if upath == "" {
			serveIndex(w)
			return
		}
		if f, err := fsys.Open(upath); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// Not a real file. An unknown API path is a 404; anything else is a
		// client route and falls back to the SPA shell.
		if strings.HasPrefix(upath, "api/") {
			http.NotFound(w, r)
			return
		}
		serveIndex(w)
	}), nil
}
