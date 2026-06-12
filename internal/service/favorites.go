package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
)

const (
	maxFavoriteLists = 20
	maxListNameLen   = 60
	defaultListName  = "Meine Favoriten"
)

// NotFoundError is a missing/!owned resource the HTTP layer maps to 404.
type NotFoundError struct{ What string }

func (e *NotFoundError) Error() string { return e.What + " not found" }

// FavoritesStore is the persistence the favorites use case needs.
type FavoritesStore interface {
	GetFavoriteLists(ctx context.Context, userID pgtype.UUID) ([]store.FavoriteList, error)
	GetFavoriteItemsForUser(ctx context.Context, userID pgtype.UUID) ([]store.GetFavoriteItemsForUserRow, error)
	CountFavoriteLists(ctx context.Context, userID pgtype.UUID) (int64, error)
	CreateFavoriteList(ctx context.Context, arg store.CreateFavoriteListParams) (store.FavoriteList, error)
	GetFavoriteListForUser(ctx context.Context, arg store.GetFavoriteListForUserParams) (store.FavoriteList, error)
	GetDefaultList(ctx context.Context, userID pgtype.UUID) (store.FavoriteList, error)
	RenameFavoriteList(ctx context.Context, arg store.RenameFavoriteListParams) (int64, error)
	SetFavoriteListSort(ctx context.Context, arg store.SetFavoriteListSortParams) (int64, error)
	DeleteFavoriteList(ctx context.Context, arg store.DeleteFavoriteListParams) (int64, error)
	NextItemSort(ctx context.Context, listID pgtype.UUID) (int32, error)
	AddFavoriteItem(ctx context.Context, arg store.AddFavoriteItemParams) error
	RemoveFavoriteItem(ctx context.Context, arg store.RemoveFavoriteItemParams) (int64, error)
}

// FavoriteList is the read model of one list and the service ids it contains.
type FavoriteList struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	IsDefault bool     `json:"is_default"`
	Sort      int      `json:"sort"`
	Items     []string `json:"items"`
}

// ListFavorites returns the user's lists with their items, in one round trip.
func ListFavorites(ctx context.Context, db FavoritesStore, userID pgtype.UUID) ([]FavoriteList, error) {
	lists, err := db.GetFavoriteLists(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get lists: %w", err)
	}
	items, err := db.GetFavoriteItemsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get items: %w", err)
	}
	byList := map[string][]string{}
	for _, it := range items {
		byList[uuidStr(it.ListID)] = append(byList[uuidStr(it.ListID)], uuidStr(it.ServiceID))
	}
	out := make([]FavoriteList, 0, len(lists))
	for _, l := range lists {
		id := uuidStr(l.ID)
		items := byList[id]
		if items == nil {
			items = []string{}
		}
		out = append(out, FavoriteList{ID: id, Name: l.Name, IsDefault: l.IsDefault, Sort: int(l.Sort), Items: items})
	}
	return out, nil
}

// CreateList validates the name and the per-user soft cap, then appends a list.
func CreateList(ctx context.Context, db FavoritesStore, userID pgtype.UUID, name string) (FavoriteList, error) {
	clean, err := validListName(name)
	if err != nil {
		return FavoriteList{}, err
	}
	n, err := db.CountFavoriteLists(ctx, userID)
	if err != nil {
		return FavoriteList{}, fmt.Errorf("count lists: %w", err)
	}
	if n >= maxFavoriteLists {
		return FavoriteList{}, &ValidationError{Field: "lists", Msg: fmt.Sprintf("limit of %d lists reached", maxFavoriteLists)}
	}
	row, err := db.CreateFavoriteList(ctx, store.CreateFavoriteListParams{
		UserID: userID, Name: clean, Sort: int32(n), IsDefault: false,
	})
	if err != nil {
		return FavoriteList{}, fmt.Errorf("create list: %w", err)
	}
	return FavoriteList{ID: uuidStr(row.ID), Name: row.Name, IsDefault: row.IsDefault, Sort: int(row.Sort), Items: []string{}}, nil
}

// RenameList renames a user-owned list.
func RenameList(ctx context.Context, db FavoritesStore, userID, listID pgtype.UUID, name string) error {
	clean, err := validListName(name)
	if err != nil {
		return err
	}
	rows, err := db.RenameFavoriteList(ctx, store.RenameFavoriteListParams{ID: listID, UserID: userID, Name: clean})
	if err != nil {
		return fmt.Errorf("rename list: %w", err)
	}
	if rows == 0 {
		return &NotFoundError{What: "list"}
	}
	return nil
}

// ReorderList sets a list's sort position.
func ReorderList(ctx context.Context, db FavoritesStore, userID, listID pgtype.UUID, sort int) error {
	rows, err := db.SetFavoriteListSort(ctx, store.SetFavoriteListSortParams{ID: listID, UserID: userID, Sort: int32(sort)})
	if err != nil {
		return fmt.Errorf("reorder list: %w", err)
	}
	if rows == 0 {
		return &NotFoundError{What: "list"}
	}
	return nil
}

// DeleteList removes a user-owned list (and its items, via cascade).
func DeleteList(ctx context.Context, db FavoritesStore, userID, listID pgtype.UUID) error {
	rows, err := db.DeleteFavoriteList(ctx, store.DeleteFavoriteListParams{ID: listID, UserID: userID})
	if err != nil {
		return fmt.Errorf("delete list: %w", err)
	}
	if rows == 0 {
		return &NotFoundError{What: "list"}
	}
	return nil
}

// AddItem adds a service to a user-owned list (idempotent).
func AddItem(ctx context.Context, db FavoritesStore, userID, listID, serviceID pgtype.UUID) error {
	if err := ensureOwned(ctx, db, userID, listID); err != nil {
		return err
	}
	return appendItem(ctx, db, listID, serviceID)
}

// RemoveItem removes a service from a user-owned list.
func RemoveItem(ctx context.Context, db FavoritesStore, userID, listID, serviceID pgtype.UUID) error {
	if err := ensureOwned(ctx, db, userID, listID); err != nil {
		return err
	}
	if _, err := db.RemoveFavoriteItem(ctx, store.RemoveFavoriteItemParams{ListID: listID, ServiceID: serviceID}); err != nil {
		return fmt.Errorf("remove item: %w", err)
	}
	return nil
}

// QuickStar adds a service to the user's default list, creating that list on
// first use (the one-tap favorite — docs/01 §4.4). Returns the default list id.
func QuickStar(ctx context.Context, db FavoritesStore, userID, serviceID pgtype.UUID) (string, error) {
	def, err := db.GetDefaultList(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		def, err = db.CreateFavoriteList(ctx, store.CreateFavoriteListParams{
			UserID: userID, Name: defaultListName, Sort: 0, IsDefault: true,
		})
	}
	if err != nil {
		return "", fmt.Errorf("get/create default list: %w", err)
	}
	if err := appendItem(ctx, db, def.ID, serviceID); err != nil {
		return "", err
	}
	return uuidStr(def.ID), nil
}

func ensureOwned(ctx context.Context, db FavoritesStore, userID, listID pgtype.UUID) error {
	_, err := db.GetFavoriteListForUser(ctx, store.GetFavoriteListForUserParams{ID: listID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return &NotFoundError{What: "list"}
	}
	if err != nil {
		return fmt.Errorf("verify list ownership: %w", err)
	}
	return nil
}

func appendItem(ctx context.Context, db FavoritesStore, listID, serviceID pgtype.UUID) error {
	sort, err := db.NextItemSort(ctx, listID)
	if err != nil {
		return fmt.Errorf("next item sort: %w", err)
	}
	if err := db.AddFavoriteItem(ctx, store.AddFavoriteItemParams{ListID: listID, ServiceID: serviceID, Sort: sort}); err != nil {
		return fmt.Errorf("add item: %w", err)
	}
	return nil
}

func validListName(name string) (string, error) {
	clean := strings.TrimSpace(name)
	if clean == "" {
		return "", &ValidationError{Field: "name", Msg: "must not be empty"}
	}
	if len([]rune(clean)) > maxListNameLen {
		return "", &ValidationError{Field: "name", Msg: fmt.Sprintf("must be at most %d characters", maxListNameLen)}
	}
	return clean, nil
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
