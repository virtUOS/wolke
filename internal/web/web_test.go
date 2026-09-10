package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>shell</title>")},
		"assets/app-abc123.js": {Data: []byte("console.log('app')")},
		"sw.js":                {Data: []byte("/* service worker */")},
	}
}

func TestEmbeddedFSCompilesAndDegradesGracefully(t *testing.T) {
	// The tracked internal/web/dist/.gitkeep guarantees go:embed's all:dist
	// pattern always compiles, even on a fresh clone with no npm step — build
	// output (index.html, hashed assets) is never committed (CLAUDE.md
	// "Commits and CI"). Depending on whether this checkout has run
	// `make web-build && make embed` (CI and Docker always do; a bare local
	// clone hasn't), SPAHandler must either serve the real app or degrade
	// gracefully — it must never fail to construct.
	fsys, err := FS()
	if err != nil {
		t.Fatalf("FS: %v", err)
	}
	h, err := SPAHandler(fsys)
	if err != nil {
		t.Fatalf("SPAHandler must degrade gracefully instead of erroring: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK && rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 200 (SPA built) or 503 (not built)", rec.Code)
	}
}

func TestSPAHandlerNotBuiltIsGraceful(t *testing.T) {
	// An empty dist/ (fresh clone, no `make web-build`/`make embed` yet) must
	// not fail SPAHandler construction or panic — it serves an explanatory
	// response instead, so the server still starts.
	h, err := SPAHandler(fstest.MapFS{})
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	for _, p := range []string{"/", "/favorites", "/assets/app.js"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("path %s: status = %d, want 503", p, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "make web-build") {
			t.Errorf("path %s: body should explain how to build the SPA, got %q", p, rec.Body.String())
		}
	}
}

func TestSPAServesRealAsset(t *testing.T) {
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "console.log('app')" {
		t.Errorf("body = %q, want the asset contents", rec.Body.String())
	}
}

func TestSPAFallsBackToIndexForClientRoute(t *testing.T) {
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	for _, p := range []string{"/", "/favorites", "/services/deep/link"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("path %s: status = %d, want 200 (SPA fallback)", p, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct == "" || ct[:9] != "text/html" {
			t.Errorf("path %s: content-type = %q, want text/html", p, ct)
		}
	}
}

func TestSPAUnknownAPIPathIs404(t *testing.T) {
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (API must not fall back to SPA)", rec.Code)
	}
}

// The caching contract (issue #152) is asserted here rather than in the
// Caddyfile, so a deployment fronted by something other than Caddy behaves
// identically (golden rule 8). Nothing else in the suite would catch a
// regression: a wrong header still serves the right bytes.

func TestSPAShellIsNeverCached(t *testing.T) {
	// The shell names hashed chunks a later deploy removes. With no directive
	// and no validator (serveIndex writes bytes; embed has a zero modtime),
	// browsers invent a freshness lifetime and can hold a shell whose chunks
	// are gone — the cause of issue #150. no-store removes the guesswork.
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	for _, p := range []string{"/", "/favorites", "/services/deep/link"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("path %s: Cache-Control = %q, want no-store (the shell must never be served from cache)", p, got)
		}
	}
}

func TestSPAHashedAssetIsImmutablyCached(t *testing.T) {
	// Content-hashed filenames exist to make this safe: a changed file has a
	// changed URL, so the old one can be cached for as long as the client likes.
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q, want public, max-age=31536000, immutable", got)
	}
}

func TestSPAServiceWorkerIsRevalidated(t *testing.T) {
	// sw.js keeps no-cache: it is the one file whose URL never changes, so a
	// deploy only lands if the browser revalidates it.
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sw.js", nil))
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache (a new deploy must be picked up)", got)
	}
}

func TestSPAUnknownAPIPathCarriesNoCacheHeader(t *testing.T) {
	// /api, /auth, /branding and /metrics own their own caching; the SPA
	// handler must not reach into them, not even on the 404 it does answer.
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil))
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Errorf("Cache-Control = %q, want none (API responses are not the SPA handler's business)", got)
	}
}

// A static file the build does not contain must be a 404, never the shell
// (issue #156). Serving index.html for /assets/<gone-chunk>.js answered a module
// request with text/html: the browser could not parse it as an ES module, the
// failure was an uncaught rejection rather than a React render error, and the
// page blanked. On a real 404, Vite emits vite:preloadError and lib/pwa-update
// reloads once onto the current shell — the recovery #150/#151 built.

func TestSPAMissingAssetIs404NotShell(t *testing.T) {
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	for _, p := range []string{
		"/assets/does-not-exist.js",
		"/assets/icon-set-Cdv2Vew-.js",
		"/assets/fonts/gone.woff2",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("path %s: status = %d, want 404 (a missing asset must never masquerade as the shell)", p, rec.Code)
		}
		// The property that actually broke: a module request answered with HTML.
		if ct := rec.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/html") {
			t.Errorf("path %s: content-type = %q, must not be text/html", p, ct)
		}
		if body := rec.Body.String(); strings.Contains(body, "<title>shell</title>") {
			t.Errorf("path %s: body is the SPA shell, want a plain 404", p)
		}
		if got := rec.Header().Get("Cache-Control"); got != "" {
			t.Errorf("path %s: Cache-Control = %q, want none on a 404", p, got)
		}
	}
}

func TestSPAMissingFileWithExtensionIs404(t *testing.T) {
	// Client routes never carry a file extension, so any path whose final
	// segment has one is a request for a static file — a missing one is a 404
	// wherever it lives, not only under assets/.
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	for _, p := range []string{
		"/favicon.ico",
		"/robots.txt",
		"/workbox-deadbeef.js",
		"/some/deep/file.png",
		"/services/deep/link.html",
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("path %s: status = %d, want 404 (a path with a file extension is not a client route)", p, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/html") {
			t.Errorf("path %s: content-type = %q, must not be text/html", p, ct)
		}
	}
}

func TestSPAClientRoutesStillGetShellAfterAssetGuard(t *testing.T) {
	// The guard is by extension, so extension-less client routes — including
	// ones with a dot elsewhere in the path or a trailing slash — keep the
	// shell, and the shell keeps its no-store contract from #152.
	h, err := SPAHandler(testFS())
	if err != nil {
		t.Fatalf("SPAHandler: %v", err)
	}
	for _, p := range []string{"/favorites", "/favorites/", "/admin/services", "/v1.2/route"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("path %s: status = %d, want 200 (SPA fallback)", p, rec.Code)
		}
		if body := rec.Body.String(); !strings.Contains(body, "<title>shell</title>") {
			t.Errorf("path %s: body = %q, want the SPA shell", p, body)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("path %s: Cache-Control = %q, want no-store", p, got)
		}
	}
}
