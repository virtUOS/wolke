package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/virtuos/wolke/internal/service"
)

// captureLogs installs a JSON logger over the default for the duration of a
// test and hands back the buffer it wrote to.
func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func logRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line is not JSON: %s", line)
		}
		out = append(out, rec)
	}
	return out
}

// An error the service layer does not type is ours, not the caller's: it must
// reach the client as a bare 500 AND reach the operator as a log line naming
// what failed. Half of that — the 500 with nothing logged — is what left a live
// 500 undiagnosable.
func TestWriteServiceErrorLogsAnUntypedError(t *testing.T) {
	buf := captureLogs(t)

	// A wrapped error, the way internal/service produces them.
	inner := errors.New("connection refused")
	err := fmt.Errorf("create service: %w", inner)

	// Through a chi router, so the route pattern is the real one.
	r := chi.NewRouter()
	r.Post("/api/admin/services", func(w http.ResponseWriter, r *http.Request) {
		writeServiceError(w, r, err)
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/admin/services", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	// The body is unchanged, and says nothing about the cause.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["detail"] != "Unexpected error." || body["code"] != "internal" {
		t.Fatalf("body = %v, want the generic internal problem", body)
	}
	if strings.Contains(rec.Body.String(), "connection refused") ||
		strings.Contains(rec.Body.String(), "create service") {
		t.Fatalf("the cause leaked to the caller: %s", rec.Body.String())
	}

	// …and the operator gets it, with enough context to find the request.
	records := logRecords(t, buf)
	if len(records) != 1 {
		t.Fatalf("log records = %d, want exactly 1: %v", len(records), records)
	}
	got := records[0]
	if got["level"] != "ERROR" {
		t.Errorf("level = %v, want ERROR", got["level"])
	}
	if got["msg"] != "request failed" {
		t.Errorf("msg = %v", got["msg"])
	}
	// The wrapped chain names the service-layer operation.
	if s, _ := got["error"].(string); s != "create service: connection refused" {
		t.Errorf("error = %v, want the whole wrapped chain", got["error"])
	}
	if got["method"] != http.MethodPost {
		t.Errorf("method = %v, want POST", got["method"])
	}
	if got["route"] != "/api/admin/services" {
		t.Errorf("route = %v, want the chi route pattern", got["route"])
	}
	if got["code"] != "internal" {
		t.Errorf("code = %v", got["code"])
	}
}

// The typed errors are the caller's fault, answered from the body they carry —
// nothing to diagnose, so nothing is logged. (A 400 per bad request would be
// noise, and the access log already records it.)
func TestWriteServiceErrorDoesNotLogTypedErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"validation", &service.ValidationError{Field: "name", Msg: "must not be empty"}, http.StatusBadRequest},
		{"not found", &service.NotFoundError{What: "service"}, http.StatusNotFound},
		{"conflict", &service.ConflictError{Msg: "still in use"}, http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			buf := captureLogs(t)
			rec := httptest.NewRecorder()
			writeServiceError(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil), tc.err)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d", rec.Code, tc.want)
			}
			if n := len(logRecords(t, buf)); n != 0 {
				t.Fatalf("log records = %d, want none for a caller error", n)
			}
		})
	}
}

// Every other 5xx goes through the same helper, so none of them can be silent
// either. This is the shape of all of them: a dependency failed, the caller
// gets the generic sentence, the operator gets the cause.
func TestServerErrorLogsAndHidesTheCause(t *testing.T) {
	buf := captureLogs(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	serverError(rec, req, "catalog_unavailable", "Could not load the catalog.", errors.New("load catalog: dial tcp: refused"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "dial tcp") {
		t.Fatalf("the cause leaked to the caller: %s", rec.Body.String())
	}
	records := logRecords(t, buf)
	if len(records) != 1 {
		t.Fatalf("log records = %d, want 1", len(records))
	}
	if s, _ := records[0]["error"].(string); !strings.Contains(s, "dial tcp") {
		t.Errorf("error = %v, want the cause", records[0]["error"])
	}
	// No chi router here — the label falls back to the path rather than panicking.
	if records[0]["route"] != "/api/catalog" {
		t.Errorf("route = %v", records[0]["route"])
	}
}
