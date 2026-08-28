// Package web embeds the built React SPA and serves it as static assets with
// SPA-fallback routing, from the single Go binary (docs/02 §2).
package web

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// FS returns the embedded SPA rooted at dist/. The directory always compiles
// (a tracked .gitkeep satisfies go:embed's all:dist pattern on a fresh clone),
// but it only holds a real app after `make web-build && make embed` (or the
// Docker/CI build, which always runs both) — see SPAHandler for the fallback
// when it doesn't.
func FS() (fs.FS, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("sub dist fs: %w", err)
	}
	return sub, nil
}

// notBuiltHTML is served for every path when the embedded dist/ has no
// index.html — a fresh clone that hasn't run `make web-build`/`make embed` (or
// the equivalent Docker build stage) yet. It never panics or fails router
// construction; it degrades to a plain, explanatory response instead.
const notBuiltHTML = `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><title>wolke</title></head>
<body>
<h1>SPA not built</h1>
<p>The embedded frontend hasn't been built into this binary yet. Run
<code>make web-build &amp;&amp; make embed</code> (or <code>make build</code>,
which does both) and restart the server.</p>
</body>
</html>
`

func notBuiltHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(notBuiltHTML))
	})
}

// SPAHandler serves files from fsys and falls back to index.html for unknown
// paths, so client-side routes deep-link correctly. Unknown /api/ paths return
// 404 rather than index.html, so a missing API endpoint never masquerades as the
// app shell. If fsys has no index.html (the SPA hasn't been built into this
// binary), it returns a handler that serves a graceful "not built" response
// instead of failing — this keeps `go build`/`go test` and router construction
// working on a fresh clone with no npm step.
func SPAHandler(fsys fs.FS) (http.Handler, error) {
	index, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return notBuiltHandler(), nil
		}
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
			// The service worker must be revalidated every load so a new deploy is
			// picked up promptly; hashed assets under assets/ stay immutably cached.
			if upath == "sw.js" {
				w.Header().Set("Cache-Control", "no-cache")
			}
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
