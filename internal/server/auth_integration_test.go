package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/virtuos/wolke/internal/auth"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// End-to-end OIDC BFF test against a real mock IdP (docs/04 §3). Skipped unless
// both a mock issuer and a database are configured. The mock is set up to issue
// eduPersonAffiliation=student and groups=[dashboard-admins] for client
// "wolke" (see the JSON_CONFIG in the README/dev notes), so this asserts
// the config-driven role/admin mapping end-to-end.
//
// Run it (IPv4 avoids a mock-oauth2-server IPv6 crash):
//
//	OIDC_TEST_ISSUER=http://127.0.0.1:8455/default \
//	DATABASE_URL=postgres://wolke:devpass@localhost:5432/wolke?sslmode=disable \
//	go test ./internal/server -run TestOIDC -v
func TestOIDCLoginFlow(t *testing.T) {
	issuer := os.Getenv("OIDC_TEST_ISSUER")
	dburl := os.Getenv("DATABASE_URL")
	if issuer == "" || dburl == "" {
		t.Skip("set OIDC_TEST_ISSUER and DATABASE_URL to run the OIDC integration test")
	}

	ctx := context.Background()
	db, err := store.Open(ctx, dburl)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		// cascade removes the session rows too
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'stud-1'")
		db.Close()
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	base := "http://" + ln.Addr().String()

	cfg := config.Defaults()
	cfg.PublicURL = base
	cfg.SessionSecret = "integration-test-secret"
	cfg.OIDC.IssuerURL = issuer
	cfg.OIDC.ClientID = "wolke"
	cfg.OIDC.ClientSecret = "any-secret-mock-accepts"
	cfg.OIDC.Scopes = []string{"openid", "profile", "email"}

	authn, err := auth.NewAuthenticator(ctx, &cfg)
	if err != nil {
		t.Fatalf("authenticator: %v", err)
	}
	svc := auth.NewService(authn, auth.NewSessionStore(db, time.Hour), db, &cfg, discardLogger())
	h, err := New(&cfg, Deps{Logger: discardLogger(), Auth: svc, Users: db})
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	srv := &http.Server{Handler: h, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	jar, _ := cookiejar.New(nil)
	// Record the /auth/callback?code=…&state=… URL the flow passes through, so
	// step 3.5 can revisit it like a browser Back button would (issue #29).
	var callbackURL string
	client := &http.Client{
		Jar:     jar,
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if req.URL.Path == "/auth/callback" {
				callbackURL = req.URL.String()
			}
			return nil
		},
	}

	// 1. /api/me before login → 401.
	if code := getStatus(t, client, base+"/api/me"); code != http.StatusUnauthorized {
		t.Fatalf("/api/me before login = %d, want 401", code)
	}

	// 2. Drive the whole flow: /auth/login → IdP → /auth/callback → "/".
	resp, err := client.Get(base + "/auth/login")
	if err != nil {
		t.Fatalf("login flow: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("end of login flow status = %d, want 200 (SPA)", resp.StatusCode)
	}
	if !hasCookie(jar, base, auth.SessionCookieName) {
		t.Fatal("no session cookie after login")
	}

	// 3. /api/me now returns the resolved identity (config-driven mapping).
	resp, err = client.Get(base + "/api/me")
	if err != nil {
		t.Fatalf("/api/me: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/api/me after login = %d, want 200", resp.StatusCode)
	}
	var me meResponse
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatalf("decode /api/me: %v", err)
	}
	if me.PrimaryRole != "student" {
		t.Errorf("primary_role = %q, want student (eduPersonAffiliation=student)", me.PrimaryRole)
	}
	if !me.IsAdmin {
		t.Errorf("is_admin = false, want true (groups contains dashboard-admins)")
	}
	if me.DisplayName != "Test Student" {
		t.Errorf("display_name = %q, want Test Student", me.DisplayName)
	}

	// 3.4 Re-login with a live session must still refresh role/admin from the
	// claims: demote the user directly in the DB, run the login flow again
	// (the mock SSO completes it silently), and expect the claims to win. This
	// is the regression guard for the issue-#29 revisit short-circuit — only a
	// handshake-less revisit may skip the exchange, never a real login.
	if _, err := db.Pool.Exec(ctx, "update users set is_admin = false where oidc_sub = 'stud-1'"); err != nil {
		t.Fatalf("demote user: %v", err)
	}
	resp, err = client.Get(base + "/auth/login")
	if err != nil {
		t.Fatalf("re-login flow: %v", err)
	}
	_ = resp.Body.Close()
	resp, err = client.Get(base + "/api/me")
	if err != nil {
		t.Fatalf("/api/me after re-login: %v", err)
	}
	var me2 meResponse
	if err := json.NewDecoder(resp.Body).Decode(&me2); err != nil {
		t.Fatalf("decode /api/me after re-login: %v", err)
	}
	_ = resp.Body.Close()
	if !me2.IsAdmin {
		t.Errorf("is_admin = false after re-login with live session, want true (claims must refresh)")
	}

	// 3.5 Back button (issue #29): re-requesting the consumed callback URL with
	// a live session must redirect home, not replay the code into a 502.
	if callbackURL == "" {
		t.Fatal("no /auth/callback URL captured during the login flow")
	}
	baseU, _ := url.Parse(base)
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	revisit, _ := http.NewRequest(http.MethodGet, callbackURL, nil)
	for _, c := range jar.Cookies(baseU) {
		revisit.AddCookie(c)
	}
	resp, err = noRedirect.Do(revisit)
	if err != nil {
		t.Fatalf("revisit callback: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("callback revisit with session = %d, want 302 (got the auth-failed page?)", resp.StatusCode)
	}
	if loc := resp.Header.Get("Location"); loc != "/" {
		t.Errorf("callback revisit Location = %q, want /", loc)
	}
	if got := resp.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("callback revisit Cache-Control = %q, want no-store", got)
	}

	// 4. Logout invalidates the session server-side. Capture the raw token, then
	// POST logout WITHOUT following redirects (the mock auto-logs-in, so
	// following would re-authenticate). Finally replay the stale token directly
	// and assert it is rejected — proving the session row was deleted, not just
	// the cookie cleared.
	u, _ := url.Parse(base)
	var token string
	for _, c := range jar.Cookies(u) {
		if c.Name == auth.SessionCookieName {
			token = c.Value
		}
	}
	noFollow := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	logoutReq, _ := http.NewRequest(http.MethodPost, base+"/auth/logout", nil)
	logoutReq.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	resp, err = noFollow.Do(logoutReq)
	if err != nil {
		t.Fatalf("logout: %v", err)
	}
	_ = resp.Body.Close()

	staleReq, _ := http.NewRequest(http.MethodGet, base+"/api/me", nil)
	staleReq.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	resp, err = noFollow.Do(staleReq)
	if err != nil {
		t.Fatalf("stale /api/me: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("/api/me with logged-out session = %d, want 401", resp.StatusCode)
	}
}

func getStatus(t *testing.T, c *http.Client, url string) int {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

func hasCookie(jar http.CookieJar, base, name string) bool {
	u, _ := url.Parse(base)
	for _, c := range jar.Cookies(u) {
		if c.Name == name {
			return true
		}
	}
	return false
}
