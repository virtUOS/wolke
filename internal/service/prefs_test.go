package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
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
	u, err := UpdatePrefs(context.Background(), f, pgtype.UUID{}, Prefs{Theme: "dark", ViewMode: "table", FavoritesOrder: "alpha", FavoritesSeparateTab: true})
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

func TestUpdatePrefsRejectsInvalid(t *testing.T) {
	tests := []struct {
		name  string
		prefs Prefs
		field string
	}{
		{"bad theme", Prefs{Theme: "neon", ViewMode: "list", FavoritesOrder: "usage"}, "theme"},
		{"bad view_mode", Prefs{Theme: "dark", ViewMode: "grid", FavoritesOrder: "usage"}, "view_mode"},
		{"bad favorites_order", Prefs{Theme: "dark", ViewMode: "list", FavoritesOrder: "random"}, "favorites_order"},
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
