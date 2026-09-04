package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

type fakePrefs struct {
	called bool
	got    store.UpdateUserPrefsParams
}

func (f *fakePrefs) UpdateUserPrefs(_ context.Context, arg store.UpdateUserPrefsParams) (store.User, error) {
	f.called = true
	f.got = arg
	return store.User{ViewMode: arg.ViewMode, Theme: arg.Theme}, nil
}

func TestUpdatePrefsValid(t *testing.T) {
	f := &fakePrefs{}
	u, err := UpdatePrefs(context.Background(), f, pgtype.UUID{}, Prefs{Theme: "dark", ViewMode: "table", Locale: "en", FavoritesOrder: "alpha", FavoritesSeparateTab: true})
	if err != nil {
		t.Fatalf("UpdatePrefs: %v", err)
	}
	if !f.called {
		t.Fatal("store was not called")
	}
	if f.got.Theme != "dark" || f.got.ViewMode != "table" || f.got.FavoritesOrder != "alpha" || !f.got.FavoritesSeparateTab {
		t.Errorf("persisted %+v, want dark/table/alpha/separate-tab", f.got)
	}
	if u.Theme != "dark" {
		t.Errorf("returned theme = %q, want dark", u.Theme)
	}
}

// 'manual' is the third favorites order (issue #125) — accepted here, and
// backed by the relaxed check constraint in migration 00002.
func TestUpdatePrefsAcceptsManualFavoritesOrder(t *testing.T) {
	f := &fakePrefs{}
	if _, err := UpdatePrefs(context.Background(), f, pgtype.UUID{}, Prefs{
		Theme: "system", ViewMode: "auto", Locale: "de", FavoritesOrder: "manual",
	}); err != nil {
		t.Fatalf("UpdatePrefs(manual): %v", err)
	}
	if f.got.FavoritesOrder != "manual" {
		t.Errorf("persisted favorites_order = %q, want manual", f.got.FavoritesOrder)
	}
}

func TestUpdatePrefsRejectsInvalid(t *testing.T) {
	tests := []struct {
		name  string
		prefs Prefs
		field string
	}{
		{"bad theme", Prefs{Theme: "neon", ViewMode: "list", Locale: "auto", FavoritesOrder: "usage"}, "theme"},
		{"bad view_mode", Prefs{Theme: "dark", ViewMode: "grid", Locale: "auto", FavoritesOrder: "usage"}, "view_mode"},
		{"bad locale", Prefs{Theme: "dark", ViewMode: "list", Locale: "fr", FavoritesOrder: "usage"}, "locale"},
		{"bad favorites_order", Prefs{Theme: "dark", ViewMode: "list", Locale: "auto", FavoritesOrder: "random"}, "favorites_order"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakePrefs{}
			_, err := UpdatePrefs(context.Background(), f, pgtype.UUID{}, tt.prefs)
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want ValidationError", err)
			}
			if ve.Field != tt.field {
				t.Errorf("field = %q, want %q", ve.Field, tt.field)
			}
			if f.called {
				t.Error("store must not be called on invalid input")
			}
		})
	}
}
