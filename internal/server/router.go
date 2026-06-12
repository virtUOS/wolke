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

	"github.com/virtUOS/service-hub/internal/auth"
	"github.com/virtUOS/service-hub/internal/catalog"
	"github.com/virtUOS/service-hub/internal/config"
	"github.com/virtUOS/service-hub/internal/service"
	"github.com/virtUOS/service-hub/internal/usage"
	"github.com/virtUOS/service-hub/internal/web"
)

// Deps are the runtime dependencies the router needs from main.
type Deps struct {
	Logger *slog.Logger
	// Ready is the readiness probe for /readyz; nil means always ready.
	Ready func(context.Context) error
	// Auth and Users enable the real OIDC BFF + session-gated routes. When Auth
	// is nil (e.g. local dev with no IdP configured), the Phase 0 login stub is
	// used instead, so the app still runs.
	Auth  *auth.Service
	Users UserStore
	// Catalog and Defaults back the read API; mounted when present (DB configured).
	Catalog   *catalog.Cache
	Defaults  RoleDefaultsStore
	Search    SearchStore
	Prefs     service.PrefsStore
	Favorites service.FavoritesStore
	Usage     usage.Store
}

// New builds the HTTP handler for the app: middleware stack, operational
// endpoints, auth, and the session-gated API + embedded SPA.
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

	// Public, session-free routes.
	r.Get("/healthz", healthz)
	r.Get("/readyz", readyz(deps.Ready))
	r.Get("/api/branding", branding(cfg.Branding))
	mountBranding(r, cfg.BrandingDir)

	spaHandler, err := buildSPA()
	if err != nil {
		return nil, err
	}

	if deps.Auth != nil {
		mountAuthenticated(r, deps, spaHandler)
	} else {
		mountStub(r, cfg, spaHandler)
	}

	return r, nil
}

func buildSPA() (http.Handler, error) {
	spa, err := web.FS()
	if err != nil {
		return nil, err
	}
	return web.SPAHandler(spa)
}

// mountAuthenticated wires the real OIDC BFF and the session-gated routes: the
// API returns 401 without a session; the SPA redirects to login (docs/01 §6).
func mountAuthenticated(r chi.Router, deps Deps, spaHandler http.Handler) {
	r.Get("/auth/login", deps.Auth.Login)
	r.Get("/auth/callback", deps.Auth.Callback)
	r.Post("/auth/logout", deps.Auth.Logout)

	r.Group(func(pr chi.Router) {
		pr.Use(loadSession(deps.Auth, deps.Users))
		pr.With(requireUserJSON).Get("/api/me", me)
		if deps.Prefs != nil {
			pr.With(requireUserJSON).Patch("/api/me/prefs", updatePrefs(deps.Prefs))
		}
		if deps.Favorites != nil {
			pr.With(requireUserJSON).Get("/api/favorites", listFavorites(deps.Favorites))
			pr.With(requireUserJSON).Post("/api/favorites/lists", createList(deps.Favorites))
			pr.With(requireUserJSON).Patch("/api/favorites/lists/{id}", patchList(deps.Favorites))
			pr.With(requireUserJSON).Delete("/api/favorites/lists/{id}", deleteList(deps.Favorites))
			pr.With(requireUserJSON).Post("/api/favorites/items", addItem(deps.Favorites))
			pr.With(requireUserJSON).Delete("/api/favorites/items", removeItem(deps.Favorites))
		}
		if deps.Usage != nil {
			pr.With(requireUserJSON).Post("/api/events/click", recordClick(deps.Usage))
			if deps.Catalog != nil {
				pr.With(requireUserJSON).Get("/api/usage/frequent", frequent(deps.Catalog, deps.Usage))
			}
		}
		if deps.Catalog != nil {
			pr.With(requireUserJSON).Get("/api/catalog", catalogList(deps.Catalog))
			pr.With(requireUserJSON).Get("/api/catalog/defaults", catalogDefaults(deps.Catalog, deps.Defaults))
			pr.With(requireUserJSON).Get("/api/search", search(deps.Catalog, deps.Search))
		}
		pr.With(requireUserRedirect).Handle("/*", spaHandler)
	})
}

// mountStub is the Phase 0 fallback for running without an IdP configured.
func mountStub(r chi.Router, cfg *config.Config, spaHandler http.Handler) {
	r.Get("/auth/login", loginStub(cfg))
	r.Group(func(pr chi.Router) {
		pr.Use(authStub)
		pr.Handle("/*", spaHandler)
	})
}
