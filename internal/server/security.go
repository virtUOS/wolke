package server

import (
	"net/http"
	"net/url"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/virtuos/wolke/internal/auth"
)

// Per-key rate limits (per session token, else client IP). Generous enough not
// to bother real use; they exist to blunt abuse (docs/02 §10).
const (
	writeRatePerMinute  = 60
	searchRatePerMinute = 120
)

// buildCSP returns the strict, same-origin security policy (docs/02 §10),
// computed once at wiring time. The SPA is same-origin: scripts/styles/
// connections are 'self'. style-src allows inline because the branding tokens
// are applied via an injected <style> element. The single sanctioned exception
// is a configured assistant widget (branding.assistant_widget_url): its origin
// is appended to script-src (loads widget.js) and connect-src (the SSE chat
// stream) — no other directive is widened.
func buildCSP(assistantOrigin string) string {
	scriptSrc, connectSrc := "'self'", "'self'"
	if assistantOrigin != "" {
		scriptSrc += " " + assistantOrigin
		connectSrc += " " + assistantOrigin
	}
	return "default-src 'self'; base-uri 'self'; object-src 'none'; " +
		"frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
		"script-src " + scriptSrc + "; connect-src " + connectSrc + "; form-action 'self'; " +
		// PWA: the service worker and web app manifest are same-origin. Both already
		// fall back to 'self' via default-src, but state them so a future default-src
		// tightening can't silently break install/offline.
		"worker-src 'self'; manifest-src 'self'"
}

// securityHeaders sets the security header set on every response; HSTS is sent
// only when the effective request is HTTPS (behind Caddy).
func securityHeaders(csp string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", csp)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			if ForwardedFromContext(r.Context()).Scheme == "https" {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// csrfGuard rejects cross-origin state-changing requests (docs/02 §10). Combined
// with the SameSite=Lax session cookie this defends against CSRF: browsers send
// Origin on unsafe methods, so a mismatched origin is blocked. A missing Origin
// (non-browser clients like curl/tests) is allowed.
//
// An Origin is accepted when it matches either the configured canonical origin
// (derived from PUBLIC_URL) or the origin reconstructed from trusted-proxy
// headers. The PUBLIC_URL match is what makes this robust behind proxy chains
// the app can't fully see (e.g. an external TLS-terminating load balancer in
// front of Caddy): the canonical origin is configured, not header-derived, so
// CSRF no longer depends on every hop forwarding X-Forwarded-Proto correctly.
func csrfGuard(publicOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			if origin != "" {
				fwd := ForwardedFromContext(r.Context())
				if origin != publicOrigin && origin != fwd.Scheme+"://"+fwd.Host {
					writeProblem(w, http.StatusForbidden, "csrf", "Cross-origin request rejected.")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// originOf reduces a URL (e.g. PUBLIC_URL) to its scheme://host origin, dropping
// any path/query. Returns "" if rawURL is empty or unparseable, which makes
// csrfGuard fall back to the forwarded-derived origin only.
func originOf(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// keyedLimiter rate-limits per session token (or client IP), to blunt abuse of
// writes and search (docs/02 §10). In-process; fine for a single instance.
type keyedLimiter struct {
	mu        sync.Mutex
	limiters  map[string]*limiterEntry
	limit     rate.Limit
	burst     int
	lastPrune time.Time
}

type limiterEntry struct {
	lim  *rate.Limiter
	seen time.Time
}

func newKeyedLimiter(perMinute int) *keyedLimiter {
	return &keyedLimiter{
		limiters:  map[string]*limiterEntry{},
		limit:     rate.Limit(float64(perMinute) / 60.0),
		burst:     perMinute,
		lastPrune: time.Now(),
	}
}

func (k *keyedLimiter) allow(key string) bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	now := time.Now()
	if now.Sub(k.lastPrune) > time.Minute {
		for kk, e := range k.limiters {
			if now.Sub(e.seen) > 10*time.Minute {
				delete(k.limiters, kk)
			}
		}
		k.lastPrune = now
	}
	e := k.limiters[key]
	if e == nil {
		e = &limiterEntry{lim: rate.NewLimiter(k.limit, k.burst)}
		k.limiters[key] = e
	}
	e.seen = now
	return e.lim.Allow()
}

// limiterKey buckets by session token when present, else by client IP.
func limiterKey(r *http.Request) string {
	if c, err := r.Cookie(auth.SessionCookieName); err == nil && c.Value != "" {
		return "s:" + c.Value
	}
	return "ip:" + ForwardedFromContext(r.Context()).ClientIP
}

// middleware enforces the limit on every wrapped request (used for search).
func (k *keyedLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !k.allow(limiterKey(r)) {
			writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many requests; slow down.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// writeRateLimit enforces the limit only on state-changing methods, so catalog
// reads (the bulk of traffic, cache-served) are never throttled.
func writeRateLimit(k *keyedLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if !k.allow(limiterKey(r)) {
				writeProblem(w, http.StatusTooManyRequests, "rate_limited", "Too many requests; slow down.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
