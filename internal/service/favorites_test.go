package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
)

// fakeFav is a controllable in-memory FavoritesStore for unit-testing the rules.
type fakeFav struct {
	count       int64
	defaultErr  error
	defaultList store.FavoriteList
	ownErr      error
	renameRows  int64
	deleteRows  int64

	created []store.CreateFavoriteListParams
	added   []store.AddFavoriteItemParams
}

func uuidVal() pgtype.UUID { return pgtype.UUID{Valid: true} }

func (f *fakeFav) GetFavoriteLists(context.Context, pgtype.UUID) ([]store.FavoriteList, error) {
	return nil, nil
}
func (f *fakeFav) GetFavoriteItemsForUser(context.Context, pgtype.UUID) ([]store.GetFavoriteItemsForUserRow, error) {
	return nil, nil
}
func (f *fakeFav) CountFavoriteLists(context.Context, pgtype.UUID) (int64, error) {
	return f.count, nil
}
func (f *fakeFav) CreateFavoriteList(_ context.Context, arg store.CreateFavoriteListParams) (store.FavoriteList, error) {
	f.created = append(f.created, arg)
	return store.FavoriteList{ID: uuidVal(), Name: arg.Name, IsDefault: arg.IsDefault, Sort: arg.Sort}, nil
}
func (f *fakeFav) GetFavoriteListForUser(context.Context, store.GetFavoriteListForUserParams) (store.FavoriteList, error) {
	return store.FavoriteList{}, f.ownErr
}
func (f *fakeFav) GetDefaultList(context.Context, pgtype.UUID) (store.FavoriteList, error) {
	return f.defaultList, f.defaultErr
}
func (f *fakeFav) RenameFavoriteList(context.Context, store.RenameFavoriteListParams) (int64, error) {
	return f.renameRows, nil
}
func (f *fakeFav) SetFavoriteListSort(context.Context, store.SetFavoriteListSortParams) (int64, error) {
	return f.renameRows, nil
}
func (f *fakeFav) DeleteFavoriteList(context.Context, store.DeleteFavoriteListParams) (int64, error) {
	return f.deleteRows, nil
}
func (f *fakeFav) NextItemSort(context.Context, pgtype.UUID) (int32, error) { return 0, nil }
func (f *fakeFav) AddFavoriteItem(_ context.Context, arg store.AddFavoriteItemParams) error {
	f.added = append(f.added, arg)
	return nil
}
func (f *fakeFav) RemoveFavoriteItem(context.Context, store.RemoveFavoriteItemParams) (int64, error) {
	return 1, nil
}

func TestCreateListValidation(t *testing.T) {
	ctx := context.Background()
	t.Run("empty name rejected", func(t *testing.T) {
		f := &fakeFav{}
		_, err := CreateList(ctx, f, uuidVal(), "   ")
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("err = %v, want ValidationError", err)
		}
		if len(f.created) != 0 {
			t.Error("list must not be created on invalid name")
		}
	})
	t.Run("soft cap enforced", func(t *testing.T) {
		f := &fakeFav{count: maxFavoriteLists}
		_, err := CreateList(ctx, f, uuidVal(), "Daily")
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("err = %v, want ValidationError at cap", err)
		}
	})
	t.Run("valid create appends at end, not default", func(t *testing.T) {
		f := &fakeFav{count: 3}
		_, err := CreateList(ctx, f, uuidVal(), "  Daily  ")
		if err != nil {
			t.Fatalf("CreateList: %v", err)
		}
		if len(f.created) != 1 || f.created[0].Name != "Daily" || f.created[0].Sort != 3 || f.created[0].IsDefault {
			t.Errorf("created = %+v, want name=Daily sort=3 default=false", f.created)
		}
	})
}

func TestRenameAndDeleteNotFound(t *testing.T) {
	ctx := context.Background()
	f := &fakeFav{renameRows: 0, deleteRows: 0}
	var nf *NotFoundError
	if err := RenameList(ctx, f, uuidVal(), uuidVal(), "X"); !errors.As(err, &nf) {
		t.Errorf("RenameList err = %v, want NotFoundError", err)
	}
	if err := DeleteList(ctx, f, uuidVal(), uuidVal()); !errors.As(err, &nf) {
		t.Errorf("DeleteList err = %v, want NotFoundError", err)
	}
}

func TestAddItemOwnership(t *testing.T) {
	ctx := context.Background()
	t.Run("not owned -> NotFound, no add", func(t *testing.T) {
		f := &fakeFav{ownErr: pgx.ErrNoRows}
		var nf *NotFoundError
		if err := AddItem(ctx, f, uuidVal(), uuidVal(), uuidVal()); !errors.As(err, &nf) {
			t.Fatalf("err = %v, want NotFoundError", err)
		}
		if len(f.added) != 0 {
			t.Error("item must not be added to an unowned list")
		}
	})
	t.Run("owned -> added", func(t *testing.T) {
		f := &fakeFav{ownErr: nil}
		if err := AddItem(ctx, f, uuidVal(), uuidVal(), uuidVal()); err != nil {
			t.Fatalf("AddItem: %v", err)
		}
		if len(f.added) != 1 {
			t.Errorf("added = %d, want 1", len(f.added))
		}
	})
}

func TestQuickStarCreatesDefaultOnFirstUse(t *testing.T) {
	ctx := context.Background()
	t.Run("no default yet -> creates default + adds", func(t *testing.T) {
		f := &fakeFav{defaultErr: pgx.ErrNoRows}
		if _, err := QuickStar(ctx, f, uuidVal(), uuidVal()); err != nil {
			t.Fatalf("QuickStar: %v", err)
		}
		if len(f.created) != 1 || !f.created[0].IsDefault || f.created[0].Name != defaultListName {
			t.Errorf("created = %+v, want the default list", f.created)
		}
		if len(f.added) != 1 {
			t.Errorf("added = %d, want 1", len(f.added))
		}
	})
	t.Run("existing default -> no create, adds", func(t *testing.T) {
		f := &fakeFav{defaultErr: nil, defaultList: store.FavoriteList{ID: uuidVal(), IsDefault: true}}
		if _, err := QuickStar(ctx, f, uuidVal(), uuidVal()); err != nil {
			t.Fatalf("QuickStar: %v", err)
		}
		if len(f.created) != 0 {
			t.Error("must not create a second default list")
		}
		if len(f.added) != 1 {
			t.Errorf("added = %d, want 1", len(f.added))
		}
	})
}
