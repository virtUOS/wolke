package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/virtUOS/service-hub/internal/config"
)

// Authenticator wraps the provider-agnostic OIDC client: discovery, the OAuth2
// code-flow config, and ID-token verification (docs/02 §6). Nothing here is
// provider-specific — it is built entirely from the discovery document.
type Authenticator struct {
	provider     *oidc.Provider
	verifier     *oidc.IDTokenVerifier
	oauth        *oauth2.Config
	endSessionEP string
}

// NewAuthenticator discovers the issuer and builds the code-flow client. The
// redirect URI is derived from PUBLIC_URL so it is correct behind the proxy.
func NewAuthenticator(ctx context.Context, cfg *config.Config) (*Authenticator, error) {
	provider, err := oidc.NewProvider(ctx, cfg.OIDC.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery for %q: %w", cfg.OIDC.IssuerURL, err)
	}
	var extra struct {
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	_ = provider.Claims(&extra)

	// Send client credentials in the request body (client_secret_post) rather
	// than relying on auto-detection; broadly compatible across IdPs.
	endpoint := provider.Endpoint()
	endpoint.AuthStyle = oauth2.AuthStyleInParams

	return &Authenticator{
		provider:     provider,
		verifier:     provider.Verifier(&oidc.Config{ClientID: cfg.OIDC.ClientID}),
		endSessionEP: extra.EndSessionEndpoint,
		oauth: &oauth2.Config{
			ClientID:     cfg.OIDC.ClientID,
			ClientSecret: cfg.OIDC.ClientSecret,
			Endpoint:     endpoint,
			RedirectURL:  strings.TrimRight(cfg.PublicURL, "/") + "/auth/callback",
			Scopes:       cfg.OIDC.Scopes,
		},
	}, nil
}

// handshake is the state carried (signed) across login → callback, so the flow
// is stateless: no server storage for in-flight logins.
type handshake struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	ReturnTo string `json:"r"`
}

// authCodeURL builds the IdP redirect for a fresh handshake (state + nonce +
// PKCE S256 challenge).
func (a *Authenticator) authCodeURL(h handshake) string {
	return a.oauth.AuthCodeURL(h.State,
		oidc.Nonce(h.Nonce),
		oauth2.S256ChallengeOption(h.Verifier),
	)
}

// exchange swaps the code for tokens (PKCE verifier) and verifies the ID token,
// returning the validated claims. It checks the nonce binds the token to this
// handshake.
func (a *Authenticator) exchange(ctx context.Context, code string, h handshake) (map[string]any, error) {
	tok, err := a.oauth.Exchange(ctx, code, oauth2.VerifierOption(h.Verifier))
	if err != nil {
		return nil, fmt.Errorf("code exchange: %w", err)
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		return nil, fmt.Errorf("no id_token in token response")
	}
	idToken, err := a.verifier.Verify(ctx, rawID)
	if err != nil {
		return nil, fmt.Errorf("verify id_token: %w", err)
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(h.Nonce)) != 1 {
		return nil, fmt.Errorf("id_token nonce mismatch")
	}
	var claims map[string]any
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("decode claims: %w", err)
	}
	return claims, nil
}

func newRandomToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// oauthVerifier returns a fresh PKCE code verifier.
func oauthVerifier() string {
	return oauth2.GenerateVerifier()
}

// signValue serializes and HMAC-signs the handshake with SESSION_SECRET, so a
// tampered or forged handshake cookie is rejected at the callback.
func signValue(secret string, h handshake) (string, error) {
	payload, err := json.Marshal(h)
	if err != nil {
		return "", err
	}
	b64 := base64.RawURLEncoding.EncodeToString(payload)
	return b64 + "." + mac(secret, b64), nil
}

func verifyValue(secret, value string) (handshake, error) {
	var h handshake
	b64, sig, ok := strings.Cut(value, ".")
	if !ok {
		return h, fmt.Errorf("malformed handshake cookie")
	}
	if subtle.ConstantTimeCompare([]byte(sig), []byte(mac(secret, b64))) != 1 {
		return h, fmt.Errorf("bad handshake signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		return h, fmt.Errorf("decode handshake: %w", err)
	}
	if err := json.Unmarshal(payload, &h); err != nil {
		return h, fmt.Errorf("unmarshal handshake: %w", err)
	}
	return h, nil
}

func mac(secret, msg string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}
