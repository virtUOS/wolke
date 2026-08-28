package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
)

// healthz is liveness: the process is up and serving. It must not depend on the
// database or any downstream — that is what readyz is for (docs/02 §12).
func healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// readyz is readiness: the app can serve real traffic. The ready probe (e.g. a
// DB ping, wired in step 0.5) returning an error yields 503 so a load balancer
// stops sending traffic. A nil probe means "always ready".
func readyz(ready func(context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ready != nil {
			if err := ready(r.Context()); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write json response", "error", err)
	}
}
