package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/auth/authtest"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

const testClientID = "wolke"

func testAuthenticator(t *testing.T, idp *authtest.IDP) *Authenticator {
	t.Helper()
	cfg := config.Defaults()
	cfg.PublicURL = "https://wolke.example.edu"
	cfg.OIDC.IssuerURL = idp.Issuer()
	cfg.OIDC.ClientID = testClientID
	a, err := NewAuthenticator(context.Background(), &cfg)
	if err != nil {
		t.Fatalf("NewAuthenticator against test IdP: %v", err)
	}
	return a
}

// logoutClaims returns a fully valid logout token claim set (sid variant) that
// each table case then mutates.
func logoutClaims(idp *authtest.IDP, now time.Time, jti string) map[string]any {
	return map[string]any{
		"iss": idp.Issuer(),
		"aud": testClientID,
		"iat": now.Unix(),
		"exp": now.Add(2 * time.Minute).Unix(),
		"jti": jti,
		"sid": "idp-session-1",
		"events": map[string]any{
			"http://schemas.openid.net/event/backchannel-logout": map[string]any{},
		},
	}
}

// The §2.4–2.6 validation table from OIDC Back-Channel Logout 1.0
// (docs/specs/m3-backchannel-logout.md §3), against the JWKS test double.
func TestVerifyLogoutToken(t *testing.T) {
	idp := authtest.New(t)
	a := testAuthenticator(t, idp)
	now := time.Now()

	cases := []struct {
		name     string
		mutate   func(c map[string]any)
		wrongKey bool
		wantSID  string
		wantSub  string
		wantErr  string // substring of the rejection reason; "" = accept
	}{
		{
			name:    "happy path with sid",
			mutate:  func(map[string]any) {},
			wantSID: "idp-session-1",
		},
		{
			name: "happy path with sub only",
			mutate: func(c map[string]any) {
				delete(c, "sid")
				c["sub"] = "user-42"
			},
			wantSub: "user-42",
		},
		{
			name:    "wrong issuer",
			mutate:  func(c map[string]any) { c["iss"] = "https://evil.example" },
			wantErr: "issuer",
		},
		{
			name:    "wrong audience",
			mutate:  func(c map[string]any) { c["aud"] = "someone-else" },
			wantErr: "audience",
		},
		{
			name:     "bad signature",
			mutate:   func(map[string]any) {},
			wrongKey: true,
			wantErr:  "signature",
		},
		{
			name:    "missing events claim",
			mutate:  func(c map[string]any) { delete(c, "events") },
			wantErr: "events",
		},
		{
			name: "wrong events key",
			mutate: func(c map[string]any) {
				c["events"] = map[string]any{"http://schemas.openid.net/event/other": map[string]any{}}
			},
			wantErr: "events",
		},
		{
			name:    "nonce present",
			mutate:  func(c map[string]any) { c["nonce"] = "n-123" },
			wantErr: "nonce",
		},
		{
			name:    "neither sid nor sub",
			mutate:  func(c map[string]any) { delete(c, "sid") },
			wantErr: "sid",
		},
		{
			name: "stale iat",
			mutate: func(c map[string]any) {
				c["iat"] = now.Add(-10 * time.Minute).Unix()
				delete(c, "exp") // isolate the iat check from exp
			},
			wantErr: "iat",
		},
		{
			name:    "missing iat",
			mutate:  func(c map[string]any) { delete(c, "iat") },
			wantErr: "iat",
		},
		{
			name:    "expired exp",
			mutate:  func(c map[string]any) { c["exp"] = now.Add(-3 * time.Minute).Unix() },
			wantErr: "exp",
		},
		{
			name:    "missing jti",
			mutate:  func(c map[string]any) { delete(c, "jti") },
			wantErr: "jti",
		},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims := logoutClaims(idp, now, "jti-"+tc.name)
			tc.mutate(claims)
			var raw string
			if tc.wrongKey {
				raw = idp.SignWithWrongKey(t, claims)
			} else {
				raw = idp.Sign(t, claims)
			}
			seen := newJTICache(10 * time.Minute)
			lt, err := a.verifyLogoutToken(context.Background(), raw, now, seen)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("verifyLogoutToken: unexpected reject: %v", err)
				}
				if lt.SID != tc.wantSID || lt.Sub != tc.wantSub {
					t.Errorf("got sid=%q sub=%q, want sid=%q sub=%q", lt.SID, lt.Sub, tc.wantSID, tc.wantSub)
				}
				return
			}
			if err == nil {
				t.Fatalf("case %d accepted, want rejection mentioning %q", i, tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("reject reason = %q, want it to mention %q", err, tc.wantErr)
			}
		})
	}
}

func TestVerifyLogoutTokenReplayedJTI(t *testing.T) {
	idp := authtest.New(t)
	a := testAuthenticator(t, idp)
	now := time.Now()
	raw := idp.Sign(t, logoutClaims(idp, now, "jti-replay"))
	seen := newJTICache(10 * time.Minute)

	if _, err := a.verifyLogoutToken(context.Background(), raw, now, seen); err != nil {
		t.Fatalf("first presentation rejected: %v", err)
	}
	// Validation itself must not consume the jti — only a processed logout does
	// (the handler remembers it after revocation succeeds), so a 504-retry of
	// the same token can still pass.
	if _, err := a.verifyLogoutToken(context.Background(), raw, now, seen); err != nil {
		t.Fatalf("re-validation before processing rejected: %v", err)
	}
	seen.remember("jti-replay", now)
	if _, err := a.verifyLogoutToken(context.Background(), raw, now, seen); err == nil {
		t.Fatal("replayed jti accepted, want rejection")
	} else if !strings.Contains(err.Error(), "jti") {
		t.Errorf("reject reason = %q, want it to mention jti", err)
	}
}

// fakeSessionDB backs the handler-level tests without Postgres.
type fakeSessionDB struct {
	deletedSID string
	deletedSub string
	bySIDRows  int64
	bySubRows  int64
	// failDeletes simulates a transient DB error on the revocation calls.
	failDeletes error
}

func (f *fakeSessionDB) CreateSession(context.Context, store.CreateSessionParams) error {
	return nil
}
func (f *fakeSessionDB) GetSession(context.Context, string) (store.Session, error) {
	return store.Session{}, pgx.ErrNoRows
}
func (f *fakeSessionDB) DeleteSession(context.Context, string) error { return nil }
func (f *fakeSessionDB) DeleteSessionsBySID(_ context.Context, sid pgtype.Text) (int64, error) {
	if f.failDeletes != nil {
		return 0, f.failDeletes
	}
	f.deletedSID = sid.String
	return f.bySIDRows, nil
}
func (f *fakeSessionDB) DeleteSessionsByOIDCSub(_ context.Context, sub string) (int64, error) {
	if f.failDeletes != nil {
		return 0, f.failDeletes
	}
	f.deletedSub = sub
	return f.bySubRows, nil
}

func postLogoutToken(t *testing.T, s *Service, token string) *httptest.ResponseRecorder {
	t.Helper()
	form := url.Values{}
	if token != "" {
		form.Set("logout_token", token)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/backchannel-logout",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	s.BackchannelLogout(rec, req)
	return rec
}

func newBackchannelService(t *testing.T, idp *authtest.IDP, db *fakeSessionDB) *Service {
	t.Helper()
	cfg := config.Defaults()
	cfg.PublicURL = "https://wolke.example.edu"
	cfg.SessionSecret = "test-secret"
	cfg.OIDC.IssuerURL = idp.Issuer()
	cfg.OIDC.ClientID = testClientID
	a := testAuthenticator(t, idp)
	return NewService(a, NewSessionStore(db, time.Hour), nil, &cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// A valid sid token revokes by sid and answers 200 no-store — also when
// nothing matched (an expired session is a successful logout, and a
// distinguishable answer would be a valid-sid oracle).
func TestBackchannelLogoutEndpoint(t *testing.T) {
	idp := authtest.New(t)
	db := &fakeSessionDB{bySIDRows: 0}
	s := newBackchannelService(t, idp, db)

	rec := postLogoutToken(t, s, idp.Sign(t, logoutClaims(idp, time.Now(), "jti-ep-1")))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store (spec §2.8)", got)
	}
	if db.deletedSID != "idp-session-1" {
		t.Errorf("revoked sid = %q, want idp-session-1", db.deletedSID)
	}
	if db.deletedSub != "" {
		t.Errorf("sub revocation ran (%q) although the token carried a sid", db.deletedSub)
	}
}

func TestBackchannelLogoutEndpointSubOnly(t *testing.T) {
	idp := authtest.New(t)
	db := &fakeSessionDB{bySubRows: 2}
	s := newBackchannelService(t, idp, db)

	claims := logoutClaims(idp, time.Now(), "jti-ep-2")
	delete(claims, "sid")
	claims["sub"] = "user-42"
	rec := postLogoutToken(t, s, idp.Sign(t, claims))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if db.deletedSub != "user-42" {
		t.Errorf("revoked sub = %q, want user-42", db.deletedSub)
	}
}

// A replayed logout token (same jti POSTed twice) is processed once and then
// rejected.
func TestBackchannelLogoutEndpointReplay(t *testing.T) {
	idp := authtest.New(t)
	db := &fakeSessionDB{bySIDRows: 1}
	s := newBackchannelService(t, idp, db)
	token := idp.Sign(t, logoutClaims(idp, time.Now(), "jti-ep-replay"))

	if rec := postLogoutToken(t, s, token); rec.Code != http.StatusOK {
		t.Fatalf("first POST = %d, want 200", rec.Code)
	}
	if rec := postLogoutToken(t, s, token); rec.Code != http.StatusBadRequest {
		t.Errorf("replayed POST = %d, want 400", rec.Code)
	}
}

// A transient DB failure answers 504 and must NOT consume the jti: the IdP's
// retry of the very same token has to succeed, or an IdP-initiated logout is
// silently dropped and the session survives.
func TestBackchannelLogoutEndpointRetryAfterDBFailure(t *testing.T) {
	idp := authtest.New(t)
	db := &fakeSessionDB{bySIDRows: 1, failDeletes: errors.New("db down")}
	s := newBackchannelService(t, idp, db)
	token := idp.Sign(t, logoutClaims(idp, time.Now(), "jti-ep-retry"))

	if rec := postLogoutToken(t, s, token); rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("POST during DB failure = %d, want 504", rec.Code)
	}
	db.failDeletes = nil
	if rec := postLogoutToken(t, s, token); rec.Code != http.StatusOK {
		t.Fatalf("retried POST = %d, want 200 (jti must not be consumed by a failed attempt)", rec.Code)
	}
	if db.deletedSID != "idp-session-1" {
		t.Errorf("retry did not revoke: deleted sid = %q", db.deletedSID)
	}
}

// Invalid tokens get a 400 problem+json that never echoes the token, and no
// revocation runs.
func TestBackchannelLogoutEndpointRejects(t *testing.T) {
	idp := authtest.New(t)
	db := &fakeSessionDB{}
	s := newBackchannelService(t, idp, db)

	claims := logoutClaims(idp, time.Now(), "jti-ep-3")
	claims["nonce"] = "n"
	token := idp.Sign(t, claims)
	for name, tok := range map[string]string{
		"invalid token": token,
		"missing token": "",
		"garbage":       "not-a-jwt",
	} {
		rec := postLogoutToken(t, s, tok)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
			t.Errorf("%s: Content-Type = %q, want problem+json", name, ct)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", name, got)
		}
		if tok != "" && strings.Contains(rec.Body.String(), tok) {
			t.Errorf("%s: response echoes the logout token", name)
		}
	}
	if db.deletedSID != "" || db.deletedSub != "" {
		t.Errorf("revocation ran for a rejected token (sid=%q sub=%q)", db.deletedSID, db.deletedSub)
	}
}
