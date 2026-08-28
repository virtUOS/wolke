// Package authtest provides a minimal OIDC issuer double for tests: an
// httptest server answering discovery and JWKS, plus RS256 signing with the
// matching test key. It exists so both the auth unit tests (logout-token
// validation table) and the server integration tests can mint IdP-signed
// tokens without a real IdP — the same pattern go-oidc uses in its own tests.
package authtest

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
)

// IDP is a fake OIDC issuer. Issuer() is the httptest base URL; tokens signed
// with Sign verify against its JWKS.
type IDP struct {
	srv *httptest.Server
	key *rsa.PrivateKey
	kid string
}

// New starts the issuer double; it is shut down via t.Cleanup.
func New(t *testing.T) *IDP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test RSA key: %v", err)
	}
	idp := &IDP{key: key, kid: "test-key-1"}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]any{
			"issuer":                 idp.Issuer(),
			"authorization_endpoint": idp.Issuer() + "/authorize",
			"token_endpoint":         idp.Issuer() + "/token",
			"jwks_uri":               idp.Issuer() + "/jwks",
			"end_session_endpoint":   idp.Issuer() + "/logout",
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA",
				"alg": "RS256",
				"use": "sig",
				"kid": idp.kid,
				"n":   base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
			}},
		})
	})
	idp.srv = httptest.NewServer(mux)
	t.Cleanup(idp.srv.Close)
	return idp
}

// Issuer returns the issuer URL discovery is served under.
func (i *IDP) Issuer() string { return i.srv.URL }

// Sign returns a compact RS256 JWS over the claims, signed with the IdP's key
// (kid matching the served JWKS, typ per the back-channel logout spec).
func (i *IDP) Sign(t *testing.T, claims map[string]any) string {
	t.Helper()
	return signRS256(t, i.key, i.kid, claims)
}

// SignWithWrongKey signs with a fresh key the JWKS does not serve, for
// bad-signature cases.
func (i *IDP) SignWithWrongKey(t *testing.T, claims map[string]any) string {
	t.Helper()
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate wrong-signer key: %v", err)
	}
	return signRS256(t, other, i.kid, claims)
}

func signRS256(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header, err := json.Marshal(map[string]any{"alg": "RS256", "typ": "logout+jwt", "kid": kid})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func writeJSON(t *testing.T, w http.ResponseWriter, body any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		t.Errorf("idp double: write response: %v", err)
	}
}
