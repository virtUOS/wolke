package service

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

type fakeVisibilityStore struct {
	got   []string
	calls int
}

func (f *fakeVisibilityStore) UpdateUserVisibilityOptIn(_ context.Context, arg store.UpdateUserVisibilityOptInParams) (store.User, error) {
	f.calls++
	f.got = arg.Optin
	return store.User{ID: arg.ID, VisibilityOptin: arg.Optin}, nil
}

func visSet() config.VisibilitySet {
	return (&config.Config{VisibilityEntries: []config.VisibilityEntry{
		{Slug: "it-infra", Grant: config.GrantClaim, Claim: "groups", Match: "x"},
		{Slug: "experimental", Grant: config.GrantOptIn, Warning: map[string]string{"de": "!"}},
		{Slug: "beta-tools", Grant: config.GrantOptIn, Warning: map[string]string{"de": "!"}},
	}}).Visibility()
}

func TestSetVisibilityOptIn(t *testing.T) {
	tests := []struct {
		name    string
		optin   []string
		want    []string // stored list; nil = expect a validation error
		wantErr bool
	}{
		{"empty list clears", nil, []string{}, false},
		{"one opt-in slug", []string{"experimental"}, []string{"experimental"}, false},
		{"normalized to config order, deduped", []string{"beta-tools", "experimental", "beta-tools"}, []string{"experimental", "beta-tools"}, false},
		{"a claim slug cannot be self-granted", []string{"it-infra"}, nil, true},
		{"an unknown slug is rejected", []string{"nope"}, nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := &fakeVisibilityStore{}
			_, err := SetVisibilityOptIn(context.Background(), db, visSet(), pgtype.UUID{}, tt.optin)
			if tt.wantErr {
				var ve *ValidationError
				if !errors.As(err, &ve) || ve.Field != "optin" {
					t.Fatalf("err = %v, want optin ValidationError", err)
				}
				if db.calls != 0 {
					t.Fatal("a rejected list must not be written")
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if !reflect.DeepEqual(db.got, tt.want) {
				t.Errorf("stored = %v, want %v", db.got, tt.want)
			}
		})
	}
}

// No configured entries → there is nothing to opt into.
func TestSetVisibilityOptInWithNothingConfigured(t *testing.T) {
	db := &fakeVisibilityStore{}
	if _, err := SetVisibilityOptIn(context.Background(), db, config.VisibilitySet{}, pgtype.UUID{}, []string{"experimental"}); err == nil {
		t.Fatal("want error, got nil")
	}
	if _, err := SetVisibilityOptIn(context.Background(), db, config.VisibilitySet{}, pgtype.UUID{}, nil); err != nil {
		t.Fatalf("clearing must work even unconfigured: %v", err)
	}
}
