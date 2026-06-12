package server

import (
	"context"
	"net/http"
	"net/url"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/auth"
	"github.com/virtUOS/service-hub/internal/store"
)

type userCtxKey struct{}

// UserStore is the user-loading capability the session middleware needs.
type UserStore interface {
	GetUserByID(ctx context.Context, id pgtype.UUID) (store.User, error)
}

// loadSession resolves the session cookie to a user and stashes it in the
// context when valid. It never rejects — the requireUser* guards do that — so
// public routes that happen to run through it are unaffected.
func loadSession(a *auth.Service, users UserStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c, err := r.Cookie(auth.SessionCookieName); err == nil {
				if sess, err := a.Sessions().Lookup(r.Context(), c.Value); err == nil {
					if user, err := users.GetUserByID(r.Context(), sess.UserID); err == nil {
						r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, user))
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// userFromContext returns the authenticated user, if loadSession found one.
func userFromContext(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(userCtxKey{}).(store.User)
	return u, ok
}

// requireUserJSON guards API routes: no session → 401 problem+json.
func requireUserJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := userFromContext(r.Context()); !ok {
			writeProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireUserRedirect guards browser routes: no session → 302 to login.
func requireUserRedirect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := userFromContext(r.Context()); !ok {
			dest := "/auth/login"
			if r.Method == http.MethodGet && safeReturnTo(r.URL.Path) {
				dest += "?return_to=" + url.QueryEscape(r.URL.Path)
			}
			http.Redirect(w, r, dest, http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}
