package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/virtuos/wolke/internal/metrics"
)

// metricsMiddleware records each request's duration by matched route, method,
// and status code (docs/02 §7). The route pattern (not the raw path) keeps
// label cardinality bounded.
func metricsMiddleware(m *metrics.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)

			route := chi.RouteContext(r.Context()).RoutePattern()
			if route == "" {
				route = "unmatched"
			}
			code := ww.Status()
			if code == 0 {
				code = http.StatusOK
			}
			m.ObserveRequest(route, r.Method, code, time.Since(start).Seconds())
		})
	}
}
