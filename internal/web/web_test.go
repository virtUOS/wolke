package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>shell</title>")},
		"assets/app-abc123.js": {Data: []byte("console.log('app')")},
	}
}

func TestEmbeddedFSHasIndex(t *testing.T) {
	// The committed placeholder guarantees go:embed always has an index.html.
	fsys, err := FS()
	if err != nil {
		t.Fatalf("FS: %v", err)
	}
	if _, err := fsys.Open("index.html"); err != nil {
		t.Fatalf("embedded index.html missing: %v", err)
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
