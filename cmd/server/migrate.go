package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"github.com/virtuos/wolke/migrations"
)

// migrateUp applies pending forward-only migrations at startup, before the
// server begins serving. A Postgres session advisory lock (via goose) serializes
// concurrent instances so replicas don't race during a rolling deploy; goose Up
// is a no-op when the schema is already current. The embedded migrations are the
// same files the goose CLI applies in dev/CI.
func migrateUp(ctx context.Context, databaseURL string, log *slog.Logger) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open migration db: %w", err)
	}
	defer func() { _ = db.Close() }()
	// The advisory lock must be held on a single connection for its whole life.
	db.SetMaxOpenConns(1)

	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("create migration locker: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS, goose.WithSessionLocker(locker))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	log.Info("migrations applied", "count", len(results))
	return nil
}
