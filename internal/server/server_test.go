package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/virtUOS/service-hub/internal/config"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func newTestRouter(t *testing.T, cfg *config.Config, deps Deps) http.Handler {
	t.Helper()
	if deps.Logger == nil {
		deps.Logger = discardLogger()
	}
	h, err := New(cfg, deps)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return h
}

func TestHealthzAlwaysOK(t *testing.T) {
	h := newTestRouter(t, &config.Config{}, Deps{})
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status field = %q, want ok", body["status"])
	}
}

func TestReadyzReflectsProbe(t *testing.T) {
	tests := []struct {
		name  string
		probe func(context.Context) error
		want  int
	}{
		{"nil probe ready", nil, http.StatusOK},
		{"probe ok", func(context.Context) error { return nil }, http.StatusOK},
		{"probe fails", func(context.Context) error { return errors.New("db down") }, http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestRouter(t, &config.Config{}, Deps{Ready: tt.probe})
			req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Errorf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}

// echoForwarded mounts a handler that reports the effective origin so tests can
// assert how X-Forwarded-* was (or was not) applied.
func echoForwarded(t *testing.T, cfg *config.Config) http.Handler {
	t.Helper()
	tp, err := NewTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		t.Fatalf("NewTrustedProxies: %v", err)
	}
	final := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, ForwardedFromContext(r.Context()))
	})
	return tp.Forwarded()(final)
}

func TestForwardedHonoredFromTrustedProxy(t *testing.T) {
	h := echoForwarded(t, &config.Config{TrustedProxies: []string{"10.0.0.0/8"}})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.1.2.3:54321"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "hub.example.edu")
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.1.2.3")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var fwd Forwarded
	if err := json.Unmarshal(rec.Body.Bytes(), &fwd); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if fwd.Scheme != "https" {
		t.Errorf("scheme = %q, want https", fwd.Scheme)
	}
	if fwd.Host != "hub.example.edu" {
		t.Errorf("host = %q, want hub.example.edu", fwd.Host)
	}
	if fwd.ClientIP != "203.0.113.7" {
		t.Errorf("client_ip = %q, want first XFF hop 203.0.113.7", fwd.ClientIP)
	}
}

func TestForwardedIgnoredFromUntrustedPeer(t *testing.T) {
	// No trusted proxies configured (local-dev default): spoofed headers ignored.
	h := echoForwarded(t, &config.Config{})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.99:40000"
	req.Host = "real-host.local"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "evil.example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var fwd Forwarded
	if err := json.Unmarshal(rec.Body.Bytes(), &fwd); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if fwd.Scheme != "http" {
		t.Errorf("scheme = %q, want http (header must be ignored)", fwd.Scheme)
	}
	if fwd.Host != "real-host.local" {
		t.Errorf("host = %q, want real-host.local (header must be ignored)", fwd.Host)
	}
	if fwd.ClientIP != "203.0.113.99" {
		t.Errorf("client_ip = %q, want direct peer 203.0.113.99", fwd.ClientIP)
	}
}

func TestInvalidTrustedProxyRejected(t *testing.T) {
	if _, err := New(&config.Config{TrustedProxies: []string{"not-an-ip"}}, Deps{Logger: discardLogger()}); err == nil {
		t.Fatal("New: want error for invalid trusted proxy, got nil")
	}
}

// The request log line must carry a non-empty request_id (docs/02 §10).
func TestRequestLogCarriesRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	h := newTestRouter(t, &config.Config{}, Deps{Logger: logger})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	var line map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &line); err != nil {
		t.Fatalf("decode log line %q: %v", buf.String(), err)
	}
	if rid, _ := line["request_id"].(string); rid == "" {
		t.Errorf("request_id is empty in log line: %v", line)
	}
	if got := line["status"]; got != float64(http.StatusOK) {
		t.Errorf("logged status = %v, want 200", got)
	}
}
