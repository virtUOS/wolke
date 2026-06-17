package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// limitRequestBody must cap how much a downstream handler can read, so an
// oversized body cannot be streamed into memory.
func TestLimitRequestBodyCapsOversizedBody(t *testing.T) {
	var readErr error
	h := limitRequestBody(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	}))

	// A body comfortably over the 1 MiB cap.
	body := strings.NewReader(strings.Repeat("a", maxRequestBytes+1024))
	req := httptest.NewRequest(http.MethodPost, "/api/admin/services", body)
	h.ServeHTTP(httptest.NewRecorder(), req)

	if readErr == nil {
		t.Fatal("reading an oversized body should error once past the cap, got nil")
	}
}

// A normal small body passes through untouched.
func TestLimitRequestBodyAllowsSmallBody(t *testing.T) {
	const payload = `{"name":"VPN"}`
	var got string
	h := limitRequestBody(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("small body read: %v", err)
		}
		got = string(b)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/admin/services", strings.NewReader(payload))
	h.ServeHTTP(httptest.NewRecorder(), req)

	if got != payload {
		t.Fatalf("body = %q, want %q", got, payload)
	}
}
