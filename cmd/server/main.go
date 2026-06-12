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

	"github.com/virtUOS/service-hub/internal/config"
	"github.com/virtUOS/service-hub/internal/server"
	"github.com/virtUOS/service-hub/internal/store"
)

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

	// The DB is optional in Phase 0 local dev: with no DATABASE_URL the server
	// still serves the shell and /readyz reports always-ready. When configured,
	// /readyz pings the pool so a load balancer can gate on real readiness.
	var ready func(context.Context) error
	if cfg.DatabaseURL != "" {
		db, err := store.Open(context.Background(), cfg.DatabaseURL)
		if err != nil {
			return err
		}
		defer db.Close()
		ready = db.Ping
		logger.Info("database connected")
	} else {
		logger.Warn("DATABASE_URL not set; running without a database (Phase 0 dev shell)")
	}

	handler, err := server.New(cfg, server.Deps{
		Logger: logger,
		Ready:  ready,
	})
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
