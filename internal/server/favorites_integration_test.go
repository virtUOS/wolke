package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/virtUOS/service-hub/internal/service"
	"github.com/virtUOS/service-hub/internal/store"
)

// Integration: favorites SQL + handlers against a seeded DB
// (make db && make migrate && make seed). Skipped without DATABASE_URL.
func TestFavoritesFlow(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping favorites integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'fav-api-test'")
		db.Close()
	})

	user, err := db.UpsertUser(ctx, store.UpsertUserParams{
		OidcSub: "fav-api-test", DisplayName: "Fav Tester", PrimaryRole: "student",
	})
	if err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	svcs, err := db.ListActiveServices(ctx)
	if err != nil || len(svcs) == 0 {
		t.Fatalf("need seeded services: %v", err)
	}
	serviceID := uuidString(svcs[0].ID)

	req := func(method, target, body, idParam string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		c := context.WithValue(r.Context(), userCtxKey{}, user)
		if idParam != "" {
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("id", idParam)
			c = context.WithValue(c, chi.RouteCtxKey, rctx)
		}
		rec := httptest.NewRecorder()
		switch {
		case method == http.MethodGet:
			listFavorites(db)(rec, r.WithContext(c))
		case target == "/api/favorites/lists":
			createList(db)(rec, r.WithContext(c))
		case method == http.MethodPatch:
			patchList(db)(rec, r.WithContext(c))
		case method == http.MethodDelete && strings.HasPrefix(target, "/api/favorites/lists"):
			deleteList(db)(rec, r.WithContext(c))
		case method == http.MethodPost && target == "/api/favorites/items":
			addItem(db)(rec, r.WithContext(c))
		case method == http.MethodDelete && target == "/api/favorites/items":
			removeItem(db)(rec, r.WithContext(c))
		}
		return rec
	}

	// Create a list.
	rec := req(http.MethodPost, "/api/favorites/lists", `{"name":"Täglich"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create list = %d, want 201", rec.Code)
	}
	var created service.FavoriteList
	mustJSON(t, rec, &created)

	// Add the service to it.
	rec = req(http.MethodPost, "/api/favorites/items", `{"list_id":"`+created.ID+`","service_id":"`+serviceID+`"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("add item = %d, want 200", rec.Code)
	}

	// List reflects the item.
	rec = req(http.MethodGet, "/api/favorites", "", "")
	var got struct {
		Lists []service.FavoriteList `json:"lists"`
	}
	mustJSON(t, rec, &got)
	if len(got.Lists) != 1 || len(got.Lists[0].Items) != 1 || got.Lists[0].Items[0] != serviceID {
		t.Fatalf("favorites = %+v, want one list with the service", got.Lists)
	}

	// Quick-star (no list_id) creates the default list and adds the service.
	rec = req(http.MethodPost, "/api/favorites/items", `{"service_id":"`+serviceID+`"}`, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("quick-star = %d, want 200", rec.Code)
	}
	rec = req(http.MethodGet, "/api/favorites", "", "")
	got.Lists = nil
	mustJSON(t, rec, &got)
	var hasDefault bool
	for _, l := range got.Lists {
		if l.IsDefault {
			hasDefault = true
		}
	}
	if len(got.Lists) != 2 || !hasDefault {
		t.Fatalf("after quick-star: %+v, want 2 lists incl. default", got.Lists)
	}

	// Rename the created list.
	rec = req(http.MethodPatch, "/api/favorites/lists/"+created.ID, `{"name":"Wichtig"}`, created.ID)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("rename = %d, want 204", rec.Code)
	}

	// Remove the item, then delete the list.
	rec = req(http.MethodDelete, "/api/favorites/items", `{"list_id":"`+created.ID+`","service_id":"`+serviceID+`"}`, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("remove item = %d, want 204", rec.Code)
	}
	rec = req(http.MethodDelete, "/api/favorites/lists/"+created.ID, "", created.ID)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete list = %d, want 204", rec.Code)
	}

	// Ownership: patching a non-existent list id is a 404.
	rec = req(http.MethodPatch, "/api/favorites/lists/00000000-0000-0000-0000-000000000000", `{"name":"x"}`, "00000000-0000-0000-0000-000000000000")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("patch unknown list = %d, want 404", rec.Code)
	}
}

func mustJSON(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
}
