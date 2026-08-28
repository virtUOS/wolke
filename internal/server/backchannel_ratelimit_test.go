package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/auth"
	"github.com/virtuos/wolke/internal/auth/authtest"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

// noopSessionDB satisfies auth.SessionDB without a database.
type noopSessionDB struct{}

func (noopSessionDB) CreateSession(context.Context, store.CreateSessionParams) error { return nil }
func (noopSessionDB) GetSession(context.Context, string) (store.Session, error) {
	return store.Session{}, pgx.ErrNoRows
}
func (noopSessionDB) DeleteSession(context.Context, string) error { return nil }
func (noopSessionDB) DeleteSessionsBySID(context.Context, pgtype.Text) (int64, error) {
	return 1, nil
}
func (noopSessionDB) DeleteSessionsByOIDCSub(context.Context, string) (int64, error) {
	return 1, nil
}

// All of an IdP's logout notifications come from one IP, and Keycloak does not
// retry 429s — so the global 60/min write limiter must not apply to
// /auth/backchannel-logout (it has its own, much higher per-IP limit). An
// IdP-side mass logout of >60 sessions in a burst has to land in full.
func TestBackchannelLogoutNotWriteRateLimited(t *testing.T) {
	idp := authtest.New(t)
	cfg := config.Defaults()
	cfg.PublicURL = "http://wolke.test"
	cfg.SessionSecret = "rate-limit-test-secret"
	cfg.OIDC.IssuerURL = idp.Issuer()
	cfg.OIDC.ClientID = "wolke"
	authn, err := auth.NewAuthenticator(context.Background(), &cfg)
	if err != nil {
		t.Fatalf("authenticator: %v", err)
	}
	svc := auth.NewService(authn, auth.NewSessionStore(noopSessionDB{}, time.Hour), nil, &cfg, discardLogger())
	h, err := New(&cfg, Deps{Logger: discardLogger(), Auth: svc})
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	// 70 distinct, valid logout tokens from the same client IP (httptest gives
	// every request the same RemoteAddr), well past the 60/min write budget.
	for i := range 70 {
		n := strconv.Itoa(i)
		token := idp.Sign(t, map[string]any{
			"iss": idp.Issuer(),
			"aud": "wolke",
			"iat": time.Now().Unix(),
			"exp": time.Now().Add(2 * time.Minute).Unix(),
			"jti": "jti-burst-" + n,
			"sid": "idp-sid-burst-" + n,
			"events": map[string]any{
				"http://schemas.openid.net/event/backchannel-logout": map[string]any{},
			},
		})
		form := url.Values{"logout_token": {token}}
		req := httptest.NewRequest(http.MethodPost, "/auth/backchannel-logout",
			strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("logout %d/70 = %d, want 200 (rate limiter dropping IdP logouts?)", i+1, rec.Code)
		}
	}
}
