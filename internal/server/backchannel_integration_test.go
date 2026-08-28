package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/virtuos/wolke/internal/auth"
	"github.com/virtuos/wolke/internal/auth/authtest"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// End-to-end shape of IdP-initiated logout (docs/specs/m3-backchannel-logout.md
// §3, issue #44), through the real router against a real Postgres: a session
// cookie works, a back-channel logout token lands, and the old cookie is 401
// afterwards — while unrelated sessions keep working. Skipped without
// DATABASE_URL; the IdP is the authtest JWKS double.
func TestBackchannelLogoutEndToEnd(t *testing.T) {
	dburl := os.Getenv("DATABASE_URL")
	if dburl == "" {
		t.Skip("DATABASE_URL not set; skipping Postgres integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, dburl)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		// cascade removes the session rows too
		_, _ = db.Pool.Exec(context.Background(),
			"delete from users where oidc_sub in ('bcl-e2e-alice', 'bcl-e2e-bob')")
		db.Close()
	})

	idp := authtest.New(t)
	cfg := config.Defaults()
	cfg.PublicURL = "http://wolke.test"
	cfg.SessionSecret = "integration-test-secret"
	cfg.OIDC.IssuerURL = idp.Issuer()
	cfg.OIDC.ClientID = "wolke"
	authn, err := auth.NewAuthenticator(ctx, &cfg)
	if err != nil {
		t.Fatalf("authenticator: %v", err)
	}
	sessions := auth.NewSessionStore(db, time.Hour)
	svc := auth.NewService(authn, sessions, db, &cfg, discardLogger())
	h, err := New(&cfg, Deps{Logger: discardLogger(), Auth: svc, Users: db, SPA: fakeBuiltSPA()})
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)

	newUser := func(sub string) store.User {
		u, err := db.UpsertUser(ctx, store.UpsertUserParams{
			OidcSub: sub, DisplayName: sub, PrimaryRole: "student",
		})
		if err != nil {
			t.Fatalf("UpsertUser(%q): %v", sub, err)
		}
		return u
	}
	alice, bob := newUser("bcl-e2e-alice"), newUser("bcl-e2e-bob")

	// Login-shaped sessions, minted the way Callback does.
	newSession := func(u store.User, sid string) string {
		token, _, err := sessions.New(ctx, u.ID, sid)
		if err != nil {
			t.Fatalf("session for %s: %v", u.OidcSub, err)
		}
		return token
	}
	aliceTok := newSession(alice, "idp-sid-alice-1")
	aliceTok2 := newSession(alice, "idp-sid-alice-2")
	bobTok := newSession(bob, "idp-sid-bob-1")

	me := func(token string) int {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/me", nil)
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatalf("GET /api/me: %v", err)
		}
		defer func() { _ = resp.Body.Close() }()
		return resp.StatusCode
	}
	postLogout := func(claims map[string]any) int {
		form := url.Values{"logout_token": {idp.Sign(t, claims)}}
		resp, err := srv.Client().Post(srv.URL+"/auth/backchannel-logout",
			"application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
		if err != nil {
			t.Fatalf("POST backchannel-logout: %v", err)
		}
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	logoutClaims := func(jti string) map[string]any {
		return map[string]any{
			"iss": idp.Issuer(),
			"aud": "wolke",
			"iat": time.Now().Unix(),
			"exp": time.Now().Add(2 * time.Minute).Unix(),
			"jti": jti,
			"events": map[string]any{
				"http://schemas.openid.net/event/backchannel-logout": map[string]any{},
			},
		}
	}

	// The session cookies work.
	for name, tok := range map[string]string{"alice": aliceTok, "alice2": aliceTok2, "bob": bobTok} {
		if code := me(tok); code != http.StatusOK {
			t.Fatalf("%s: /api/me before logout = %d, want 200", name, code)
		}
	}

	// sid-targeted logout ends exactly alice's first session.
	claims := logoutClaims("e2e-jti-1")
	claims["sid"] = "idp-sid-alice-1"
	if code := postLogout(claims); code != http.StatusOK {
		t.Fatalf("backchannel logout (sid) = %d, want 200", code)
	}
	if code := me(aliceTok); code != http.StatusUnauthorized {
		t.Errorf("/api/me with logged-out cookie = %d, want 401", code)
	}
	if code := me(aliceTok2); code != http.StatusOK {
		t.Errorf("alice's other session broke: /api/me = %d, want 200", code)
	}
	if code := me(bobTok); code != http.StatusOK {
		t.Errorf("bob's session broke: /api/me = %d, want 200", code)
	}

	// sub-only logout ends all of bob's sessions.
	claims = logoutClaims("e2e-jti-2")
	claims["sub"] = "bcl-e2e-bob"
	if code := postLogout(claims); code != http.StatusOK {
		t.Fatalf("backchannel logout (sub) = %d, want 200", code)
	}
	if code := me(bobTok); code != http.StatusUnauthorized {
		t.Errorf("/api/me for sub-logged-out bob = %d, want 401", code)
	}
	if code := me(aliceTok2); code != http.StatusOK {
		t.Errorf("alice's session ended by bob's sub logout: /api/me = %d, want 200", code)
	}
}
