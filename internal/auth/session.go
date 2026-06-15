package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// DefaultSessionTTL is how long a server-side session stays valid.
const DefaultSessionTTL = 12 * time.Hour

// SessionDB is the slice of the store the session layer needs (narrow, so it is
// easy to fake in tests). *store.DB satisfies it via its embedded Queries.
type SessionDB interface {
	CreateSession(ctx context.Context, arg store.CreateSessionParams) error
	GetSession(ctx context.Context, id string) (store.Session, error)
	DeleteSession(ctx context.Context, id string) error
}

// SessionStore issues and validates server-side sessions (BFF pattern, docs/02
// §6). The cookie carries a high-entropy random token; the DB stores only its
// SHA-256, so a database read never yields a usable session credential.
type SessionStore struct {
	db  SessionDB
	ttl time.Duration
}

// NewSessionStore builds a session store over the given DB with the given TTL.
func NewSessionStore(db SessionDB, ttl time.Duration) *SessionStore {
	return &SessionStore{db: db, ttl: ttl}
}

// New creates a session for the user and returns the raw token to set in the
// cookie, plus its expiry.
func (s *SessionStore) New(ctx context.Context, userID pgtype.UUID) (token string, expires time.Time, err error) {
	token, err = newSessionToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expires = time.Now().Add(s.ttl)
	err = s.db.CreateSession(ctx, store.CreateSessionParams{
		ID:        hashToken(token),
		UserID:    userID,
		ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create session: %w", err)
	}
	return token, expires, nil
}

// Lookup returns the unexpired session for a raw cookie token.
func (s *SessionStore) Lookup(ctx context.Context, token string) (store.Session, error) {
	return s.db.GetSession(ctx, hashToken(token))
}

// Delete invalidates the session for a raw cookie token (logout).
func (s *SessionStore) Delete(ctx context.Context, token string) error {
	return s.db.DeleteSession(ctx, hashToken(token))
}

func newSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// pgText maps a Go string to a nullable Postgres text (empty → NULL).
func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}
