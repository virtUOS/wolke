package server

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/virtuos/wolke/internal/httpx"
	"github.com/virtuos/wolke/internal/service"
)

// How a handler answers when something broke on our side.
//
// The rule both helpers below exist to enforce: a 5xx is logged before it is
// written, and the client-facing body never carries the cause. Getting only
// half of that is what leaves an operator with "Unexpected error." and nothing
// to diagnose from, which is exactly what happened on a live 500.

// serverError logs the wrapped error against the request, then writes the
// problem response. `detail` is the generic sentence the caller sees; the cause
// goes to the log and only to the log, so nothing about the internals leaks to
// whoever triggered it.
//
// The wrapped error is the diagnosis: internal/service wraps as it goes
// ("create service: …", "list favorite ids: …"), so err.Error() already names
// the operation that failed. It is logged whole, alongside the route pattern
// (not the path — no ids in the label), the method, and the request id the
// access-log line carries, so the two join up.
func serverError(w http.ResponseWriter, r *http.Request, code, detail string, err error) {
	slog.LogAttrs(r.Context(), slog.LevelError, "request failed",
		slog.String("request_id", middleware.GetReqID(r.Context())),
		slog.String("method", r.Method),
		slog.String("route", routePattern(r)),
		slog.String("code", code),
		slog.String("error", errString(err)),
	)
	httpx.WriteProblem(w, http.StatusInternalServerError, code, detail)
}

// writeServiceError maps a use-case error to its status. The typed ones are the
// caller's fault and say so in the body; anything else is ours, and goes
// through serverError so it cannot be silently swallowed.
func writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *service.ValidationError
	var nf *service.NotFoundError
	var ce *service.ConflictError
	switch {
	case errors.As(err, &ve):
		httpx.WriteProblem(w, http.StatusBadRequest, "invalid", ve.Error())
	case errors.As(err, &nf):
		httpx.WriteProblem(w, http.StatusNotFound, "not_found", nf.Error())
	// A well-formed write the current state refuses (e.g. deleting a category
	// services still use). The detail says what blocks it, so it is written to
	// be shown to the admin verbatim.
	case errors.As(err, &ce):
		httpx.WriteProblem(w, http.StatusConflict, "conflict", ce.Error())
	default:
		serverError(w, r, "internal", "Unexpected error.", err)
	}
}

// routePattern is the chi route the request matched ("/api/admin/services/{id}"),
// which is the bounded label — the path would carry ids. Nil-safe: a handler
// called directly in a test has no chi route context.
func routePattern(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			return p
		}
	}
	return r.URL.Path
}

func errString(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}
