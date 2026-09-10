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
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(notBuiltHTML))
	})
}

// SPAHandler serves files from fsys and falls back to index.html for unknown
// extension-less paths, so client-side routes deep-link correctly. Unknown /api/
// paths and missing static files (assets/, or any path with a file extension)
// return 404 rather than index.html, so neither a missing API endpoint nor a
// gone build artifact ever masquerades as the app shell. If fsys has no index.html (the SPA hasn't been built into this
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
		// The shell is written straight from memory, and embed's zero modtime
		// leaves http.FileServer no validator to offer either, so without a
		// directive a browser invents a freshness lifetime (RFC 9111 §4.2.2)
		// and can keep serving a shell whose hashed chunks a later deploy has
		// removed — the cause behind issue #150. no-store, not no-cache: the
		// shell is a couple of kB and has nothing to revalidate against.
		w.Header().Set("Cache-Control", "no-store")
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
			// The service worker's URL never changes, so it must be revalidated
			// every load for a new deploy to land. Everything under assets/ carries
			// a content hash in its name — a changed file is a changed URL — which
			// is exactly what makes a year of immutable caching safe (issue #152).
			switch {
			case upath == "sw.js":
				w.Header().Set("Cache-Control", "no-cache")
			case strings.HasPrefix(upath, "assets/"):
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		// Not a real file. An unknown API path is a 404, and so is a missing
		// static file: anything under assets/, and any path whose final segment
		// carries a file extension, since a client route never does. Serving the
		// shell for a hashed chunk the build no longer has answered a module
		// request with text/html — the browser cannot parse that as an ES module,
		// the failure is an uncaught rejection rather than a render error, and
		// the page blanks (issue #156). A real 404 is what Vite's preload helper
		// turns into vite:preloadError, which lib/pwa-update reloads on. Only an
		// extension-less path is a client route and falls back to the SPA shell.
		if strings.HasPrefix(upath, "api/") || isStaticFilePath(upath) {
			http.NotFound(w, r)
			return
		}
		serveIndex(w)
	}), nil
}

// isStaticFilePath reports whether a request path names a static file rather
// than a client route: everything under assets/ (hashed build output), and any
// path whose final segment has a file extension. Client routes never carry one,
// so a missing file here is a 404 and never the shell.
func isStaticFilePath(upath string) bool {
	return strings.HasPrefix(upath, "assets/") || path.Ext(upath) != ""
}
