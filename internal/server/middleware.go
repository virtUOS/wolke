package server

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// requestLogger emits one structured slog line per request after it completes,
// carrying the request ID, effective client/scheme/host, route, status, and
// duration (docs/02 §10 — structured JSON logs).
func requestLogger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			defer func() {
				fwd := ForwardedFromContext(r.Context())
				log.LogAttrs(r.Context(), slog.LevelInfo, "http request",
					slog.String("request_id", middleware.GetReqID(r.Context())),
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Int("status", ww.Status()),
					slog.Int("bytes", ww.BytesWritten()),
					slog.Int64("duration_ms", time.Since(start).Milliseconds()),
					slog.String("client_ip", fwd.ClientIP),
					slog.String("scheme", fwd.Scheme),
					slog.String("host", fwd.Host),
				)
			}()
			next.ServeHTTP(ww, r)
		})
	}
}

// recoverer turns a panic in any downstream handler into a 500 and a logged
// error rather than a crashed process (CLAUDE.md: no panics escape handlers).
func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil && rec != http.ErrAbortHandler {
					log.LogAttrs(r.Context(), slog.LevelError, "panic recovered",
						slog.String("request_id", middleware.GetReqID(r.Context())),
						slog.Any("panic", rec),
					)
					writeJSON(w, http.StatusInternalServerError, map[string]string{"status": "error"})
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
