package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

type fakePrefsStore struct {
	got store.UpdateUserPrefsParams
}

func (f *fakePrefsStore) UpdateUserPrefs(_ context.Context, arg store.UpdateUserPrefsParams) (store.User, error) {
	f.got = arg
	return store.User{ViewMode: arg.ViewMode, Theme: arg.Theme}, nil
}

func reqWithUser(method, target, body string, user store.User) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	return req.WithContext(context.WithValue(req.Context(), userCtxKey{}, user))
}

func TestUpdatePrefsPartialKeepsCurrent(t *testing.T) {
	f := &fakePrefsStore{}
	current := store.User{ID: pgtype.UUID{Valid: true}, ViewMode: "auto", Theme: "system", Locale: "auto", FavoritesOrder: "usage"}
	// Only theme is sent; view_mode and locale must keep their current values.
	req := reqWithUser(http.MethodPatch, "/api/me/prefs", `{"theme":"dark"}`, current)
	rec := httptest.NewRecorder()
	updatePrefs(f)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if f.got.Theme != "dark" || f.got.ViewMode != "auto" {
		t.Errorf("persisted %+v, want theme=dark view_mode=auto (kept)", f.got)
	}
	var body meResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Theme != "dark" || body.ViewMode != "auto" {
		t.Errorf("response %+v, want theme=dark view_mode=auto", body)
	}
}

func TestUpdatePrefsSetsLocale(t *testing.T) {
	f := &fakePrefsStore{}
	current := store.User{ID: pgtype.UUID{Valid: true}, ViewMode: "auto", Theme: "system", Locale: "auto", FavoritesOrder: "usage"}
	req := reqWithUser(http.MethodPatch, "/api/me/prefs", `{"locale":"en"}`, current)
	rec := httptest.NewRecorder()
	updatePrefs(f)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if f.got.Locale != "en" {
		t.Errorf("persisted locale = %q, want en", f.got.Locale)
	}
}

func TestUpdatePrefsRejectsInvalidLocale(t *testing.T) {
	f := &fakePrefsStore{}
	current := store.User{ViewMode: "auto", Theme: "system", Locale: "auto", FavoritesOrder: "usage"}
	req := reqWithUser(http.MethodPatch, "/api/me/prefs", `{"locale":"fr"}`, current)
	rec := httptest.NewRecorder()
	updatePrefs(f)(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdatePrefsRejectsInvalidValue(t *testing.T) {
	f := &fakePrefsStore{}
	req := reqWithUser(http.MethodPatch, "/api/me/prefs", `{"view_mode":"grid"}`, store.User{ViewMode: "auto", Theme: "system"})
	rec := httptest.NewRecorder()
	updatePrefs(f)(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestUpdatePrefsRejectsBadJSON(t *testing.T) {
	f := &fakePrefsStore{}
	req := reqWithUser(http.MethodPatch, "/api/me/prefs", `not json`, store.User{ViewMode: "auto", Theme: "system"})
	rec := httptest.NewRecorder()
	updatePrefs(f)(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
