// Package httpx holds tiny HTTP response helpers shared by the API layer and
// the auth endpoints, so error shapes stay identical across both.
package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// WriteProblem emits an RFC-7807-style problem+json with a stable code and a
// human-readable message (docs/02 §10).
func WriteProblem(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/problem+json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"code":   code,
		"detail": detail,
		"status": status,
	}); err != nil {
		slog.Error("write problem response", "error", err)
	}
}
