package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB owns the pgx connection pool and embeds the sqlc-generated Queries, so the
// rest of the app calls type-safe query methods directly on *DB (docs/02 §2).
type DB struct {
	*Queries
	Pool *pgxpool.Pool
}

// Open creates a connection pool from a libpq/pgx connection string and verifies
// connectivity once before returning.
func Open(ctx context.Context, url string) (*DB, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("create pgx pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &DB{Queries: New(pool), Pool: pool}, nil
}

// Ping reports whether the database is reachable; it backs the /readyz probe.
func (db *DB) Ping(ctx context.Context) error {
	return db.Pool.Ping(ctx)
}

// Begin starts a transaction (used by multi-statement writes in the service layer).
func (db *DB) Begin(ctx context.Context) (pgx.Tx, error) {
	return db.Pool.Begin(ctx)
}

// Close releases the pool.
func (db *DB) Close() {
	db.Pool.Close()
}
