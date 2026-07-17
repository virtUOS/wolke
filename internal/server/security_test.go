package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

func TestSecurityHeaders(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	hdr := rec.Header()
	if hdr.Get("Content-Security-Policy") == "" {
		t.Error("missing Content-Security-Policy")
	}
	if hdr.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", hdr.Get("X-Content-Type-Options"))
	}
	if hdr.Get("X-Frame-Options") != "DENY" {
		t.Errorf("X-Frame-Options = %q, want DENY", hdr.Get("X-Frame-Options"))
	}
	// Plain HTTP: no HSTS.
	if hdr.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS must not be set on plain HTTP")
	}
}

// Without an assistant widget configured the CSP stays fully same-origin.
func TestCSPSameOriginByDefault(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	csp := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self';") {
		t.Errorf("CSP script-src not same-origin only: %q", csp)
	}
	if !strings.Contains(csp, "connect-src 'self';") {
		t.Errorf("CSP connect-src not same-origin only: %q", csp)
	}
}

// A configured assistant widget widens exactly script-src (load widget.js) and
// connect-src (the SSE chat stream) to the assistant origin — nothing else.
func TestCSPIncludesAssistantOrigin(t *testing.T) {
	cfg := config.Defaults()
	cfg.Branding.AssistantWidgetURL = "https://assistant.example.edu/widget.js"
	cfg.Branding.AssistantBotID = "echo"
	h := newTestRouter(t, &cfg, Deps{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	csp := rec.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self' https://assistant.example.edu;") {
		t.Errorf("CSP script-src missing assistant origin: %q", csp)
	}
	if !strings.Contains(csp, "connect-src 'self' https://assistant.example.edu;") {
		t.Errorf("CSP connect-src missing assistant origin: %q", csp)
	}
	// The origin is scheme://host only (no /widget.js path), and no other
	// directive is widened.
	if strings.Contains(csp, "/widget.js") {
		t.Errorf("CSP must carry the origin, not the full script URL: %q", csp)
	}
	if n := strings.Count(csp, "https://assistant.example.edu"); n != 2 {
		t.Errorf("assistant origin appears %d times in CSP, want exactly 2 (script-src, connect-src): %q", n, csp)
	}
}

func TestHSTSWhenForwardedHTTPS(t *testing.T) {
	cfg := config.Defaults()
	cfg.TrustedProxies = []string{"10.0.0.0/8"}
	h := newTestRouter(t, &cfg, Deps{})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.RemoteAddr = "10.1.2.3:5000"
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Strict-Transport-Security") == "" {
		t.Error("HSTS should be set when the forwarded scheme is https")
	}
}

func TestCSRFGuard(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	// httptest requests default to Host "example.com" over http.
	tests := []struct {
		name   string
		method string
		origin string
		want   int // 403 if blocked, else not 403
	}{
		{"GET ignores origin", http.MethodGet, "http://evil.com", 0},
		{"POST matching origin allowed", http.MethodPost, "http://example.com", 0},
		{"POST missing origin allowed", http.MethodPost, "", 0},
		{"POST cross origin blocked", http.MethodPost, "http://evil.com", http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/events/click", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if tt.want == http.StatusForbidden && rec.Code != http.StatusForbidden {
				t.Errorf("status = %d, want 403", rec.Code)
			}
			if tt.want == 0 && rec.Code == http.StatusForbidden {
				t.Errorf("status = 403, want it not blocked")
			}
		})
	}
}

// TestCSRFGuardPublicURL covers the proxy-chain case: the request reaches the
// app as plain http with some internal host, but the browser's Origin is the
// real external https origin. Matching against PUBLIC_URL must allow it even
// though the forwarded-derived origin doesn't match.
func TestCSRFGuardPublicURL(t *testing.T) {
	cfg := config.Defaults()
	cfg.PublicURL = "https://wolke.example.edu"
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodPost, "/api/events/click", nil)
	req.Header.Set("Origin", "https://wolke.example.edu") // matches PUBLIC_URL, not the test host
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Errorf("status = 403, want it allowed (Origin matches PUBLIC_URL)")
	}

	// A genuinely foreign origin is still blocked.
	req = httptest.NewRequest(http.MethodPost, "/api/events/click", nil)
	req.Header.Set("Origin", "https://evil.example.edu")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 for a foreign origin", rec.Code)
	}
}

func TestKeyedLimiter(t *testing.T) {
	k := newKeyedLimiter(2) // burst 2
	if !k.allow("a") {
		t.Fatal("first should be allowed")
	}
	if !k.allow("a") {
		t.Fatal("second should be allowed")
	}
	if k.allow("a") {
		t.Error("third should be denied")
	}
	if !k.allow("b") {
		t.Error("a different key has its own bucket")
	}
}

func TestWriteRateLimitSkipsReads(t *testing.T) {
	mw := writeRateLimit(newKeyedLimiter(1))
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := mw(ok)

	// Many GETs are never limited.
	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/catalog", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %d = %d, want 200", i, rec.Code)
		}
	}
	// Writes are limited after the burst.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/favorites/items", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("first POST = %d, want 200", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/favorites/items", nil))
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("second POST = %d, want 429", rec.Code)
	}
}
