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
