package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/virtUOS/service-hub/internal/config"
)

func TestAppRouteWithoutSessionRedirectsToLogin(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/favorites", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if loc != "/auth/login?return_to=%2Ffavorites" {
		t.Errorf("Location = %q, want redirect to login preserving return_to", loc)
	}
}

func TestPublicRoutesNotRedirected(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	for _, p := range []string{"/healthz", "/readyz", "/api/branding"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code == http.StatusFound {
			t.Errorf("path %s was redirected; public routes must not require a session", p)
		}
	}
}

func TestAppRouteWithSessionServesSPA(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/favorites", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "stub"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (SPA served to a session holder)", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); len(ct) < 9 || ct[:9] != "text/html" {
		t.Errorf("content-type = %q, want text/html (SPA fallback)", ct)
	}
}

func TestLoginStubSetsCookieAndRedirects(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/auth/login?return_to=%2Ffavorites", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/favorites" {
		t.Errorf("Location = %q, want /favorites", loc)
	}
	var found bool
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName {
			found = true
			if !c.HttpOnly {
				t.Error("session cookie must be HttpOnly")
			}
		}
	}
	if !found {
		t.Error("login stub did not set the session cookie")
	}
}

func TestLoginStubRejectsOpenRedirect(t *testing.T) {
	cfg := config.Defaults()
	h := newTestRouter(t, &cfg, Deps{})

	req := httptest.NewRequest(http.MethodGet, "/auth/login?return_to=//evil.com", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if loc := rec.Header().Get("Location"); loc != "/" {
		t.Errorf("Location = %q, want / (open redirect must be rejected)", loc)
	}
}
