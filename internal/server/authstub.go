package server

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/virtUOS/service-hub/internal/config"
)

// sessionCookieName is the BFF session cookie. In Phase 0 it carries a stub
// value; Phase 1 replaces the value with a real server-side session id and the
// login stub with the OIDC code flow (docs/02 §6).
const sessionCookieName = "sh_session"

// authStub enforces "login is always required" (docs/01 §6 non-goals): a request
// without a session cookie is redirected to the login stub. It guards only the
// routes it wraps — public endpoints (/healthz, /readyz, /api/branding,
// /branding/*, /auth/login) are registered outside the guarded group.
func authStub(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie(sessionCookieName); err == nil {
			next.ServeHTTP(w, r)
			return
		}
		dest := "/auth/login"
		if r.Method == http.MethodGet && safeReturnTo(r.URL.Path) {
			dest += "?return_to=" + url.QueryEscape(r.URL.Path)
		}
		http.Redirect(w, r, dest, http.StatusFound)
	})
}

// loginStub stands in for the OIDC code flow: it sets the session cookie and
// bounces back to the originally requested path. Replaced wholesale in Phase 1.
func loginStub(cfg *config.Config) http.HandlerFunc {
	secure := strings.HasPrefix(cfg.PublicURL, "https://")
	return func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{
			Name:     sessionCookieName,
			Value:    "stub",
			Path:     "/",
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
		returnTo := r.URL.Query().Get("return_to")
		if !safeReturnTo(returnTo) {
			returnTo = "/"
		}
		http.Redirect(w, r, returnTo, http.StatusFound)
	}
}

// safeReturnTo permits only local, single-slash paths, blocking open redirects
// to other hosts ("//evil.com" or "/\evil.com").
func safeReturnTo(p string) bool {
	return strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//") && !strings.HasPrefix(p, "/\\")
}
