// Command server runs the HTTP API and serves the embedded React SPA from a
// single binary (docs/02 §2). It loads config (env > file > defaults), builds
// the proxy-aware chi router, and serves with graceful shutdown. The OIDC BFF,
// catalog API, and embedded SPA are wired in later steps/phases.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/virtUOS/service-hub/internal/auth"
	"github.com/virtUOS/service-hub/internal/catalog"
	"github.com/virtUOS/service-hub/internal/config"
	"github.com/virtUOS/service-hub/internal/server"
	"github.com/virtUOS/service-hub/internal/store"
)

// catalogCacheTTL bounds how long the in-process catalog snapshot is served
// before a refresh; admin writes also invalidate it explicitly (Phase 3).
const catalogCacheTTL = 60 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel(cfg.LogLevel)}))
	slog.SetDefault(logger)

	// The DB is optional in local dev: with no DATABASE_URL the server still
	// serves the shell and /readyz reports always-ready. When configured,
	// /readyz pings the pool so a load balancer can gate on real readiness.
	var (
		ready func(context.Context) error
		db    *store.DB
	)
	if cfg.DatabaseURL != "" {
		var err error
		db, err = store.Open(context.Background(), cfg.DatabaseURL)
		if err != nil {
			return err
		}
		defer db.Close()
		ready = db.Ping
		logger.Info("database connected")
	} else {
		logger.Warn("DATABASE_URL not set; running without a database (dev shell)")
	}

	deps := server.Deps{Logger: logger, Ready: ready}

	// Catalog read model: an in-process cache over the DB, invalidated on admin
	// writes (Phase 3). Reads serve from cache (docs/02 §9).
	if db != nil {
		dbForCatalog := db
		deps.Catalog = catalog.NewCache(catalogCacheTTL, func(ctx context.Context) (*catalog.Snapshot, error) {
			return catalog.Load(ctx, dbForCatalog)
		})
		deps.Defaults = db
		deps.Search = db
	}

	// Wire the real OIDC BFF when an issuer is configured and the DB is present;
	// otherwise the server falls back to the Phase 0 login stub.
	if cfg.OIDC.IssuerURL != "" && cfg.OIDC.ClientID != "" && db != nil {
		authn, err := auth.NewAuthenticator(context.Background(), cfg)
		if err != nil {
			return err
		}
		sessions := auth.NewSessionStore(db, auth.DefaultSessionTTL)
		deps.Auth = auth.NewService(authn, sessions, db, cfg, logger)
		deps.Users = db
		deps.Prefs = db
		logger.Info("OIDC auth enabled", "issuer", cfg.OIDC.IssuerURL)
	} else {
		logger.Warn("OIDC not configured; using the login stub (no real authentication)")
	}

	handler, err := server.New(cfg, deps)
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server listening", "addr", cfg.HTTPAddr, "public_url", cfg.PublicURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

func logLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
