package auth

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

// A callback hit without a session or handshake (e.g. a stale bookmark) still
// fails — but the response must be uncacheable so browsers never replay it
// from history/bfcache (issue #29).
func TestCallbackWithoutHandshakeFails(t *testing.T) {
	cfg := config.Defaults()
	cfg.SessionSecret = "test-secret"
	s := NewService(nil, nil, nil, &cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))

	rec := httptest.NewRecorder()
	s.Callback(rec, httptest.NewRequest(http.MethodGet, "/auth/callback?code=used&state=x", nil))

	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "authentication failed") {
		t.Errorf("body = %q, want it to contain %q", rec.Body.String(), "authentication failed")
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store (auth responses must never be cached)", got)
	}
}
