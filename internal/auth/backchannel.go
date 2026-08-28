package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"time"
)

// OIDC Back-Channel Logout 1.0 (docs/specs/m3-backchannel-logout.md): the IdP
// POSTs a signed logout token server-to-server when a user's IdP session ends
// (e.g. logout at the SSO or the Keycloak account console), and we end the
// matching wolke sessions. This is the reverse direction of the RP-initiated
// logout in Logout; it needs no browser cooperation, so it works with the BFF
// pattern and shared/pool computers get logged out for real (#44).

// logoutEventName is the required member of the events claim (spec §2.4).
const logoutEventName = "http://schemas.openid.net/event/backchannel-logout"

const (
	// logoutTokenMaxAge rejects stale tokens: iat older than this is refused
	// (spec §2.6 step 9 leaves the window to the RP; logout tokens are sent
	// immediately, so minutes is generous).
	logoutTokenMaxAge = 5 * time.Minute
	// logoutClockSkew tolerates clock drift between the IdP and us for the
	// iat/exp comparisons.
	logoutClockSkew = 2 * time.Minute
	// jtiCacheTTL bounds the replay cache; it must cover the acceptance window
	// (max age + skew), after which a replayed token is stale anyway.
	jtiCacheTTL = logoutTokenMaxAge + 2*logoutClockSkew
)

// logoutToken is the validated content of a back-channel logout token.
type logoutToken struct {
	SID string // IdP session to end; may be empty
	Sub string // subject whose sessions to end; may be empty (never both)
	JTI string
}

// jtiCache remembers recently seen logout-token jti values to refuse replays
// (spec §2.6 step 8). In-process only: wolke runs as a single instance
// (docs/02 §9) — running multiple instances would move this to shared storage
// (e.g. an unlogged Postgres table), since a replay must be refused on every
// instance.
type jtiCache struct {
	mu   sync.Mutex
	ttl  time.Duration
	seen map[string]time.Time // jti -> entry expiry
}

func newJTICache(ttl time.Duration) *jtiCache {
	return &jtiCache{ttl: ttl, seen: map[string]time.Time{}}
}

// contains reports whether the jti was already processed. Expired entries are
// pruned in passing (the map stays tiny at logout rates).
func (c *jtiCache) contains(jti string, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, exp := range c.seen {
		if now.After(exp) {
			delete(c.seen, k)
		}
	}
	_, dup := c.seen[jti]
	return dup
}

// remember marks the jti as processed. Deliberately separate from contains:
// only a logout that actually revoked sessions consumes its jti — a failed
// attempt (answered 504) must leave the IdP's retry of the same token able to
// pass. The check/mark pair is not atomic; two concurrent copies of one token
// at worst both delete the same rows, which is idempotent.
func (c *jtiCache) remember(jti string, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seen[jti] = now.Add(c.ttl)
}

// verifyLogoutToken runs the full logout-token validation (spec §2.4–2.6):
// signature against the provider JWKS, iss, aud, iat freshness, exp if
// present, the events member, nonce absence, sid-or-sub, and jti replay. It
// returns the identifiers to revoke by, or the reason for rejection (safe to
// log — it never contains the token).
func (a *Authenticator) verifyLogoutToken(ctx context.Context, raw string, now time.Time, seen *jtiCache) (logoutToken, error) {
	var lt logoutToken
	// The verifier checks the JWS signature against the discovered JWKS and
	// the issuer. aud and exp are checked by hand below: aud because logout
	// tokens share the ID-token audience rules but we want a precise error,
	// exp because the spec makes it optional (SkipExpiryCheck would otherwise
	// reject tokens without one).
	idt, err := a.logoutVerifier.Verify(ctx, raw)
	if err != nil {
		return lt, fmt.Errorf("signature/issuer rejected: %w", err)
	}
	if !slices.Contains(idt.Audience, a.clientID) {
		return lt, fmt.Errorf("audience %q does not contain our client_id", idt.Audience)
	}

	var claims map[string]any
	if err := idt.Claims(&claims); err != nil {
		return lt, fmt.Errorf("decode claims: %w", err)
	}
	// A nonce marks an ID token; its presence means this is not a logout token
	// (spec §2.4 — prevents an ID token being replayed as a logout token).
	if _, ok := claims["nonce"]; ok {
		return lt, fmt.Errorf("nonce present")
	}
	events, ok := claims["events"].(map[string]any)
	if !ok {
		return lt, fmt.Errorf("events claim missing or not an object")
	}
	if _, ok := events[logoutEventName]; !ok {
		return lt, fmt.Errorf("events claim lacks the back-channel logout member")
	}
	if _, ok := claims["iat"]; !ok || idt.IssuedAt.IsZero() {
		return lt, fmt.Errorf("iat claim missing")
	}
	if age := now.Sub(idt.IssuedAt); age > logoutTokenMaxAge {
		return lt, fmt.Errorf("stale iat: issued %s ago", age.Round(time.Second))
	}
	if idt.IssuedAt.After(now.Add(logoutClockSkew)) {
		return lt, fmt.Errorf("iat is in the future")
	}
	if _, ok := claims["exp"]; ok && now.After(idt.Expiry.Add(logoutClockSkew)) {
		return lt, fmt.Errorf("exp passed")
	}

	lt.SID, _ = claims["sid"].(string)
	lt.Sub = idt.Subject
	if lt.SID == "" && lt.Sub == "" {
		return lt, fmt.Errorf("neither sid nor sub present")
	}
	jti, _ := claims["jti"].(string)
	if jti == "" {
		return lt, fmt.Errorf("jti claim missing")
	}
	if seen.contains(jti, now) {
		return lt, fmt.Errorf("replayed jti")
	}
	lt.JTI = jti
	return lt, nil
}

// BackchannelLogout is POST /auth/backchannel-logout: the IdP-facing,
// unauthenticated endpoint receiving form-encoded logout tokens. Responses are
// no-store per spec §2.8. It answers 200 whether or not sessions matched — an
// already-expired session is a successful logout, and a distinguishable
// response would be an oracle for live sids.
func (s *Service) BackchannelLogout(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if err := r.ParseForm(); err != nil {
		s.log.Warn("backchannel logout: unreadable form", "error", err)
		writeProblem(w, http.StatusBadRequest, "invalid_request", "Malformed form body.")
		return
	}
	raw := r.PostForm.Get("logout_token")
	if raw == "" {
		writeProblem(w, http.StatusBadRequest, "invalid_request", "logout_token is required.")
		return
	}
	lt, err := s.auth.verifyLogoutToken(r.Context(), raw, time.Now(), s.seenJTIs)
	if err != nil {
		// Log the rejection reason, never the token itself.
		s.log.Warn("backchannel logout: token rejected", "reason", err.Error())
		writeProblem(w, http.StatusBadRequest, "invalid_logout_token", "Logout token validation failed.")
		return
	}

	var ended int64
	var derr error
	if lt.SID != "" {
		ended, derr = s.sessions.DeleteBySID(r.Context(), lt.SID)
	} else {
		ended, derr = s.sessions.DeleteByOIDCSub(r.Context(), lt.Sub)
	}
	if derr != nil {
		s.log.Error("backchannel logout: revoke sessions", "error", derr)
		// 504 asks the IdP to retry the logout later (spec §2.8). The jti is
		// not yet remembered, so the retried token passes validation again.
		writeProblem(w, http.StatusGatewayTimeout, "logout_failed", "Could not end sessions.")
		return
	}
	// Consume the jti only now that revocation succeeded, so a DB failure
	// above never turns the IdP's retry into a rejected "replay".
	s.seenJTIs.remember(lt.JTI, time.Now())

	// Security-relevant event stream (not an admin write — no audit_log row);
	// sid/sub are hashed so logs identify without recording identifiers.
	s.log.Info("backchannel logout accepted",
		slog.String("issuer", s.cfg.OIDC.IssuerURL),
		slog.String("sid_hash", shortHash(lt.SID)),
		slog.String("sub_hash", shortHash(lt.Sub)),
		slog.Int64("sessions_ended", ended))
	w.WriteHeader(http.StatusOK)
}

// shortHash identifies a value in logs without recording it; empty stays empty.
func shortHash(v string) string {
	if v == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:6])
}

// writeProblem emits an RFC-7807-style problem+json, mirroring the API layer's
// format (docs/02 §10) for the auth endpoints that answer machines.
func writeProblem(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/problem+json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"code":   code,
		"detail": detail,
		"status": status,
	}); err != nil {
		slog.Error("write problem response", "error", err)
	}
}
