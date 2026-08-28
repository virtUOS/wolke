package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

// jwksMinRefetch is the minimum interval between JWKS refetches triggered by
// verification cache misses. Key rotation is rare (Keycloak defaults to
// years), so a newly rotated key being picked up with up to this much delay
// is fine; what the interval prevents is a burst of garbage tokens at the
// unauthenticated back-channel endpoint driving one JWKS fetch per POST.
const jwksMinRefetch = 30 * time.Second

// logoutSigningAlgs matches the ID-token verifier's default (go-oidc falls
// back to RS256 when Config.SupportedSigningAlgs is unset).
var logoutSigningAlgs = []jose.SignatureAlgorithm{jose.RS256}

// cooldownKeySet is an oidc.KeySet over the provider JWKS with a minimum
// interval between network refetches. go-oidc's own RemoteKeySet refetches on
// every verification whose kid is not cached; this one keeps that behavior
// for the first miss and then cools down. Cached keys keep verifying
// throughout — the cooldown only delays learning about brand-new keys.
type cooldownKeySet struct {
	jwksURL  string
	client   *http.Client
	cooldown time.Duration

	mu        sync.Mutex
	keys      jose.JSONWebKeySet
	lastFetch time.Time
}

func newCooldownKeySet(jwksURL string) *cooldownKeySet {
	return &cooldownKeySet{
		jwksURL:  jwksURL,
		client:   http.DefaultClient,
		cooldown: jwksMinRefetch,
	}
}

// VerifySignature implements oidc.KeySet: it checks the compact JWS and
// returns its payload.
func (c *cooldownKeySet) VerifySignature(ctx context.Context, jwt string) ([]byte, error) {
	jws, err := jose.ParseSigned(jwt, logoutSigningAlgs)
	if err != nil {
		return nil, fmt.Errorf("malformed jwt: %w", err)
	}
	if len(jws.Signatures) != 1 {
		return nil, fmt.Errorf("jwt must have exactly one signature")
	}
	kid := jws.Signatures[0].Header.KeyID

	keys, err := c.keysFor(ctx, kid)
	if err != nil {
		return nil, err
	}
	for _, k := range keys {
		if payload, err := jws.Verify(k); err == nil {
			return payload, nil
		}
	}
	return nil, fmt.Errorf("failed to verify signature against the JWKS keys")
}

// keysFor returns the candidate keys for a kid, refetching the JWKS at most
// once per cooldown when the kid is not cached. Holding the mutex across the
// fetch also serializes concurrent misses into a single request.
func (c *cooldownKeySet) keysFor(ctx context.Context, kid string) ([]jose.JSONWebKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if keys := candidateKeys(c.keys, kid); len(keys) > 0 {
		return keys, nil
	}
	if time.Since(c.lastFetch) < c.cooldown {
		return nil, fmt.Errorf("no JWKS key for kid %q (refetch cooling down)", kid)
	}
	if err := c.fetchLocked(ctx); err != nil {
		return nil, fmt.Errorf("refetch JWKS: %w", err)
	}
	if keys := candidateKeys(c.keys, kid); len(keys) > 0 {
		return keys, nil
	}
	return nil, fmt.Errorf("no JWKS key for kid %q after refetch", kid)
}

// candidateKeys picks the keys a token's kid may verify against; a token
// without a kid may match any key in the set.
func candidateKeys(set jose.JSONWebKeySet, kid string) []jose.JSONWebKey {
	if kid == "" {
		return set.Keys
	}
	return set.Key(kid)
}

// fetchLocked replaces the cached key set from the JWKS endpoint. lastFetch
// is stamped for failures too, so an unreachable IdP is also retried at most
// once per cooldown. Callers hold c.mu.
func (c *cooldownKeySet) fetchLocked(ctx context.Context) error {
	c.lastFetch = time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.jwksURL, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks endpoint answered %s", resp.Status)
	}
	var set jose.JSONWebKeySet
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&set); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}
	c.keys = set
	return nil
}
