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

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/auth"
	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/metrics"
	"github.com/virtuos/wolke/internal/server"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
	"github.com/virtuos/wolke/internal/usage"
)

// catalogCacheTTL bounds how long the in-process catalog snapshot is served
// before a refresh; admin writes also invalidate it explicitly (Phase 3).
const catalogCacheTTL = 60 * time.Second

const (
	gaugeRefreshInterval = 30 * time.Second
	usageRollupInterval  = time.Hour
	usageRetention       = 90 * 24 * time.Hour // raw click_events retention (docs/01 §8.9)

	searchPruneInterval  = 24 * time.Hour
	searchEventRetention = 180 * 24 * time.Hour // aggregate search_events retention (docs/02 §5)

	announcementPurgeInterval = 24 * time.Hour // how often the history retention sweep runs
)

// refreshGauges periodically updates the metric gauges from the database.
func refreshGauges(ctx context.Context, log *slog.Logger, m *metrics.Metrics, src metrics.GaugeSource) {
	t := time.NewTicker(gaugeRefreshInterval)
	defer t.Stop()
	for {
		if err := m.RefreshGauges(ctx, src); err != nil {
			log.Debug("refresh gauges", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// runUsageRollup periodically rolls click_events into usage_daily and purges
// raw events past the retention window (docs/04 maintenance).
func runUsageRollup(ctx context.Context, log *slog.Logger, db *store.DB) {
	t := time.NewTicker(usageRollupInterval)
	defer t.Stop()
	for {
		if err := usage.Rollup(ctx, db, usageRetention); err != nil {
			log.Warn("usage rollup", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// runSearchEventPrune periodically deletes search_events past the retention
// window so the aggregate search log stays bounded (docs/02 §5).
func runSearchEventPrune(ctx context.Context, log *slog.Logger, db *store.DB) {
	t := time.NewTicker(searchPruneInterval)
	defer t.Stop()
	for {
		if n, err := service.PruneSearchEvents(ctx, db, searchEventRetention); err != nil {
			log.Warn("search event prune", "error", err)
		} else if n > 0 {
			log.Info("pruned old search events", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// runAnnouncementPurge periodically deletes expired announcements older than the
// configured retention window (docs/01 §4.7). retentionDays <= 0 disables it.
func runAnnouncementPurge(ctx context.Context, log *slog.Logger, db *store.DB, retentionDays int) {
	if retentionDays <= 0 {
		log.Info("announcement history retention disabled (keep forever)")
		return
	}
	window := time.Duration(retentionDays) * 24 * time.Hour
	t := time.NewTicker(announcementPurgeInterval)
	defer t.Stop()
	for {
		n, err := announce.Purge(ctx, db, time.Now().Add(-window))
		if err != nil {
			log.Warn("announcement purge", "error", err)
		} else if n > 0 {
			log.Info("purged expired announcements", "count", n, "retention_days", retentionDays)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func main() {
	// `server healthcheck` is the container probe (distroless has no shell/curl,
	// so the binary probes itself). It must run before run() loads full config.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			slog.Error("healthcheck failed", "error", err)
			os.Exit(1)
		}
		return
	}
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
		// Auto-migrate on startup (forward-only, advisory-locked). Set
		// AUTO_MIGRATE=false to manage migrations out of band (e.g. the goose CLI).
		if os.Getenv("AUTO_MIGRATE") != "false" {
			migCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			err := migrateUp(migCtx, cfg.DatabaseURL, logger)
			cancel()
			if err != nil {
				return err
			}
		}
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

	m := metrics.New()
	deps := server.Deps{Logger: logger, Ready: ready, Metrics: m}

	// Catalog read model: an in-process cache over the DB, invalidated on admin
	// writes (Phase 3). Reads serve from cache (docs/02 §9).
	if db != nil {
		dbForCatalog := db
		cache := catalog.NewCache(catalogCacheTTL, func(ctx context.Context) (*catalog.Snapshot, error) {
			return catalog.Load(ctx, dbForCatalog)
		})
		deps.Catalog = cache
		deps.Defaults = db
		deps.Search = db
		deps.Favorites = db
		deps.Usage = db
		deps.Announce = db
		deps.AnnounceDismiss = db
		deps.Admin = &server.AdminDeps{Store: db, Invalidate: cache.Invalidate, Audit: db}
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

	// Background workers: refresh the metric gauges and roll up click events.
	if db != nil {
		go refreshGauges(ctx, logger, m, db)
		go runUsageRollup(ctx, logger, db)
		go runSearchEventPrune(ctx, logger, db)
		go runAnnouncementPurge(ctx, logger, db, cfg.AnnouncementRetentionDays)
	}

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
