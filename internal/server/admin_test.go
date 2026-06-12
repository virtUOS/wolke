package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/virtUOS/service-hub/internal/store"
)

func TestRequireAdmin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := requireAdmin(next)

	tests := []struct {
		name string
		ctx  func(*http.Request) *http.Request
		want int
	}{
		{"no session", func(r *http.Request) *http.Request { return r }, http.StatusUnauthorized},
		{"non-admin", func(r *http.Request) *http.Request {
			return r.WithContext(context.WithValue(r.Context(), userCtxKey{}, store.User{IsAdmin: false}))
		}, http.StatusForbidden},
		{"admin", func(r *http.Request) *http.Request {
			return r.WithContext(context.WithValue(r.Context(), userCtxKey{}, store.User{IsAdmin: true}))
		}, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := tt.ctx(httptest.NewRequest(http.MethodGet, "/api/admin/services", nil))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Errorf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}
