// Package server assembles the chi router, the proxy-aware and logging
// middleware stack, and the operational endpoints. Domain APIs (catalog,
// favorites, …) are mounted here in later phases via internal/service.
package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/virtUOS/service-hub/internal/config"
	"github.com/virtUOS/service-hub/internal/web"
)

// Deps are the runtime dependencies the router needs from main.
type Deps struct {
	Logger *slog.Logger
	// Ready is the readiness probe for /readyz; nil means always ready.
	Ready func(context.Context) error
}

// New builds the HTTP handler for the app: middleware stack plus the
// operational endpoints (/healthz, /readyz). Returns an error if the trusted
// proxy configuration is invalid.
func New(cfg *config.Config, deps Deps) (http.Handler, error) {
	tp, err := NewTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		return nil, err
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(tp.Forwarded())
	r.Use(requestLogger(deps.Logger))
	r.Use(recoverer(deps.Logger))

	r.Get("/healthz", healthz)
	r.Get("/readyz", readyz(deps.Ready))

	// Public, session-free runtime theming (docs/02 §11–§12).
	r.Get("/api/branding", branding(cfg.Branding))
	mountBranding(r, cfg.BrandingDir)

	// Login stub (public): replaced by the OIDC code flow in Phase 1.
	r.Get("/auth/login", loginStub(cfg))

	// The embedded SPA sits behind the auth stub: cookieless requests are
	// redirected to login (docs/01 §6 — no unauthenticated view).
	spa, err := web.FS()
	if err != nil {
		return nil, err
	}
	spaHandler, err := web.SPAHandler(spa)
	if err != nil {
		return nil, err
	}
	r.Group(func(pr chi.Router) {
		pr.Use(authStub)
		pr.Handle("/*", spaHandler)
	})

	return r, nil
}
