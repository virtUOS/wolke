package auth

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// Cookie names shared with the HTTP layer.
const (
	SessionCookieName   = "sh_session"
	handshakeCookieName = "sh_auth"
)

// UserUpserter is the store capability the auth flow needs (narrow for testing).
type UserUpserter interface {
	UpsertUser(ctx context.Context, arg store.UpsertUserParams) (store.User, error)
}

// Service implements the BFF login/callback/logout handlers. HTTP handlers are
// thin; the OIDC mechanics live in Authenticator and the session in SessionStore.
type Service struct {
	auth     *Authenticator
	sessions *SessionStore
	users    UserUpserter
	cfg      *config.Config
	log      *slog.Logger
	secure   bool
}

// NewService assembles the BFF auth handlers from the authenticator, session
// store, user upserter, config, and logger.
func NewService(a *Authenticator, sessions *SessionStore, users UserUpserter, cfg *config.Config, log *slog.Logger) *Service {
	return &Service{
		auth:     a,
		sessions: sessions,
		users:    users,
		cfg:      cfg,
		log:      log,
		secure:   strings.HasPrefix(cfg.PublicURL, "https://"),
	}
}

// noStore marks an auth response uncacheable: /auth/* URLs land in browser
// history, and a cached (or bfcache-replayed) response there would replay a
// consumed code or leak a redirect (issue #29).
func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

// Login starts the code flow: it mints a signed handshake (state + nonce + PKCE)
// and redirects to the IdP.
func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	h := handshake{
		State:    newRandomToken(),
		Nonce:    newRandomToken(),
		Verifier: oauthVerifier(),
		ReturnTo: sanitizeReturnTo(r.URL.Query().Get("return_to")),
	}
	signed, err := signValue(s.cfg.SessionSecret, h)
	if err != nil {
		s.fail(w, r, "sign handshake", err)
		return
	}
	http.SetCookie(w, s.cookie(handshakeCookieName, signed, "/auth", 600))
	http.Redirect(w, r, s.auth.authCodeURL(h), http.StatusFound)
}

// Callback completes the flow: verify handshake + state, exchange the code,
// resolve identity from claims, upsert the user, create a session, set the
// cookie, and bounce back to where the user started.
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	// A revisit of the callback URL with a live session — typically the browser
	// Back button after login (issue #29) — must not replay the consumed code
	// into an error page. The user is signed in; send them home.
	if c, err := r.Cookie(SessionCookieName); err == nil {
		if _, err := s.sessions.Lookup(r.Context(), c.Value); err == nil {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
	}

	c, err := r.Cookie(handshakeCookieName)
	if err != nil {
		s.fail(w, r, "missing handshake cookie", err)
		return
	}
	h, err := verifyValue(s.cfg.SessionSecret, c.Value)
	if err != nil {
		s.fail(w, r, "verify handshake", err)
		return
	}
	if r.URL.Query().Get("state") != h.State {
		s.fail(w, r, "state mismatch", nil)
		return
	}

	claims, err := s.auth.exchange(r.Context(), r.URL.Query().Get("code"), h)
	if err != nil {
		s.fail(w, r, "exchange", err)
		return
	}
	id := buildIdentity(claims, s.cfg.OIDC)
	if id.Subject == "" {
		s.fail(w, r, "no subject in claims", nil)
		return
	}

	user, err := s.users.UpsertUser(r.Context(), store.UpsertUserParams{
		OidcSub:     id.Subject,
		DisplayName: id.DisplayName,
		Email:       pgText(id.Email),
		PrimaryRole: id.Role,
		IsAdmin:     id.IsAdmin,
	})
	if err != nil {
		s.fail(w, r, "upsert user", err)
		return
	}

	token, expires, err := s.sessions.New(r.Context(), user.ID)
	if err != nil {
		s.fail(w, r, "create session", err)
		return
	}

	// Clear the handshake; set the session cookie until session expiry.
	http.SetCookie(w, s.cookie(handshakeCookieName, "", "/auth", -1))
	sc := s.cookie(SessionCookieName, token, "/", int(time.Until(expires).Seconds()))
	http.SetCookie(w, sc)

	s.log.Info("login", "sub", id.Subject, "role", id.Role, "admin", id.IsAdmin)
	http.Redirect(w, r, h.ReturnTo, http.StatusFound)
}

// Logout invalidates the session and, if the IdP advertises one, ends the IdP
// session too (docs/02 §6).
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if c, err := r.Cookie(SessionCookieName); err == nil {
		if err := s.sessions.Delete(r.Context(), c.Value); err != nil {
			s.log.Warn("delete session on logout", "error", err)
		}
	}
	http.SetCookie(w, s.cookie(SessionCookieName, "", "/", -1))

	dest := "/"
	if s.auth.endSessionEP != "" {
		u, _ := url.Parse(s.auth.endSessionEP)
		q := u.Query()
		// RP-Initiated Logout: an IdP only honors post_logout_redirect_uri when
		// the client is identified. We don't retain the ID token, so pass
		// client_id (the spec-sanctioned alternative to id_token_hint) — without
		// it Keycloak rejects the request with "Missing parameter: id_token_hint".
		q.Set("client_id", s.cfg.OIDC.ClientID)
		q.Set("post_logout_redirect_uri", s.cfg.PublicURL)
		u.RawQuery = q.Encode()
		dest = u.String()
	}
	http.Redirect(w, r, dest, http.StatusFound)
}

// Sessions exposes the session store so the HTTP middleware can resolve a cookie
// token to its session.
func (s *Service) Sessions() *SessionStore { return s.sessions }

func (s *Service) fail(w http.ResponseWriter, _ *http.Request, msg string, err error) {
	s.log.Error("auth flow error", "stage", msg, "error", err)
	http.Error(w, "authentication failed", http.StatusBadGateway)
}

func (s *Service) cookie(name, value, path string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
	}
}

// buildIdentity maps verified claims to our domain identity.
func buildIdentity(claims map[string]any, oidcCfg config.OIDC) Identity {
	sub, _ := claims["sub"].(string)
	return Identity{
		Subject:     sub,
		DisplayName: firstString(claims, "name", "preferred_username", "email", "sub"),
		Email:       stringClaim(claims, "email"),
		Role:        ResolveRole(claims, oidcCfg.Role),
		IsAdmin:     ResolveAdmin(claims, oidcCfg.Admin),
	}
}

func firstString(claims map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := claims[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func stringClaim(claims map[string]any, key string) string {
	v, _ := claims[key].(string)
	return v
}

// sanitizeReturnTo blocks open redirects: only local single-slash paths pass.
func sanitizeReturnTo(p string) string {
	if strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "//") && !strings.HasPrefix(p, "/\\") {
		return p
	}
	return "/"
}
