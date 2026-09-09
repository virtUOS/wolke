package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
	"github.com/virtuos/wolke/internal/store/storetest"
)

// Integration: admin API roundtrip through the handlers (create → list → audit →
// delete) + category creation. Needs DATABASE_URL.
func TestAdminAPIFlow(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping admin API integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "admin-api-test", DisplayName: "Admin", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert admin: %v", err)
	}
	// This test adds and drops a category, which changes the set a concurrent
	// whole-list reorder validates against. Cleanups run LIFO, so the three
	// registrations below run in reverse: fixtures are torn down while the lock
	// is still held, then the lock is released, then the pool closes last
	// (issue #142; see storetest.LockCategorySet).
	t.Cleanup(db.Close)
	storetest.LockCategorySet(ctx, t, db.Pool)
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'API Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug = 'api-test-cat'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'admin-api-test'")
	})

	d := AdminDeps{Store: db, Invalidate: func() {}, Audit: db}
	call := func(h http.HandlerFunc, method, target, body, idParam, roleParam string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		c := context.WithValue(r.Context(), userCtxKey{}, admin)
		if idParam != "" || roleParam != "" {
			rctx := chi.NewRouteContext()
			if idParam != "" {
				rctx.URLParams.Add("id", idParam)
			}
			if roleParam != "" {
				rctx.URLParams.Add("role", roleParam)
			}
			c = context.WithValue(c, chi.RouteCtxKey, rctx)
		}
		rec := httptest.NewRecorder()
		h(rec, r.WithContext(c))
		return rec
	}

	// Create a category, then a service in it.
	if rec := call(adminCreateCategory(d), http.MethodPost, "/api/admin/categories", `{"slug":"api-test-cat","label":{"de":"API Test","en":"API Test"},"sort":99}`, "", ""); rec.Code != http.StatusCreated {
		t.Fatalf("create category = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	body := `{"name":"API Test Service","description":{"de":"Test.","en":"Test."},"service_url":"https://t.example.edu","icon":"server","categories":["api-test-cat"]}`
	rec := call(adminCreateService(d), http.MethodPost, "/api/admin/services", body, "", "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("create service = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	var created service.AdminService
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Invalid create → 400.
	if rec := call(adminCreateService(d), http.MethodPost, "/api/admin/services", `{"name":"","description":{},"icon":"bad","categories":[]}`, "", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid create = %d, want 400", rec.Code)
	}

	// List includes it.
	rec = call(adminListServices(d), http.MethodGet, "/api/admin/services", "", "", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "API Test Service") {
		t.Fatalf("list = %d, want it to include the new service", rec.Code)
	}

	// Soft delete → 204.
	if rec := call(adminDeleteService(d), http.MethodDelete, "/api/admin/services/"+created.ID, "", created.ID, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204", rec.Code)
	}

	// Audit lists the create + delete.
	rec = call(adminListAudit(d), http.MethodGet, "/api/admin/audit", "", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("audit = %d, want 200", rec.Code)
	}
	got := rec.Body.String()
	if !strings.Contains(got, "service.create") || !strings.Contains(got, "service.delete") {
		t.Errorf("audit missing expected actions: %s", got)
	}
	// The acting user's display name is resolved and surfaced (actor_id → users).
	if !strings.Contains(got, `"actor_name":"Admin"`) {
		t.Errorf("audit missing actor_name for the acting user: %s", got)
	}
}

// Integration: the category routes (issue #130) — PATCH/DELETE /:slug and the
// reorder PUT, their status mapping, and that each successful write invalidates
// the catalog cache (labels and order are part of /api/catalog). Needs
// DATABASE_URL.
func TestAdminCategoryRoutes(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping category route integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "cat-route-test", DisplayName: "Admin", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert admin: %v", err)
	}

	// The reorder route rewrites every category's sort, so this test needs the
	// shared category set to itself and has to restore the seeded values.
	type sortRow struct {
		slug string
		sort int32
	}
	var origSorts []sortRow
	cleanup := func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'Route Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug in ('route-test-cat','route-test-renamed','route-test-used')")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
	}
	// Cleanups run LIFO, so these three registrations run in reverse: the
	// category fixtures are deleted and the seeded sorts restored while the lock
	// is still held, then the lock is released, then the pool closes last. The
	// old order released the lock first, leaving the next lock holder free to
	// read rows this test was about to delete (issue #142).
	t.Cleanup(db.Close)
	storetest.LockCategorySet(ctx, t, db.Pool)
	t.Cleanup(func() {
		cleanup()
		for _, r := range origSorts {
			_, _ = db.Pool.Exec(ctx, "update categories set sort = $1 where slug = $2", r.sort, r.slug)
		}
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'cat-route-test'")
	})
	cleanup()

	rows, err := db.Pool.Query(ctx, "select slug, sort from categories order by sort, slug")
	if err != nil {
		t.Fatalf("read category sorts: %v", err)
	}
	for rows.Next() {
		var r sortRow
		if err := rows.Scan(&r.slug, &r.sort); err != nil {
			t.Fatalf("scan: %v", err)
		}
		origSorts = append(origSorts, r)
	}
	rows.Close()

	invalidated := 0
	d := AdminDeps{Store: db, Invalidate: func() { invalidated++ }, Audit: db}
	call := func(h http.HandlerFunc, method, target, body, slug string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		c := context.WithValue(r.Context(), userCtxKey{}, admin)
		if slug != "" {
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("slug", slug)
			c = context.WithValue(c, chi.RouteCtxKey, rctx)
		}
		rec := httptest.NewRecorder()
		h(rec, r.WithContext(c))
		return rec
	}

	label := `{"de":"Route Test","en":"Route test"}`

	// A malformed slug is rejected by the API, on create...
	if rec := call(adminCreateCategory(d), http.MethodPost, "/api/admin/categories", `{"slug":"Foo Bar!!","label":`+label+`,"sort":99}`, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("create with a malformed slug = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
	if rec := call(adminCreateCategory(d), http.MethodPost, "/api/admin/categories", `{"slug":"route-test-cat","label":`+label+`,"sort":9100}`, ""); rec.Code != http.StatusCreated {
		t.Fatalf("create category = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	// The collision target for the rename below is a category this test owns, not
	// whichever category happened to sort first (`origSorts[0]`). That borrowed a
	// row from ambient database state — in the observed failure, `cat-test-used`,
	// a fixture belonging to internal/service's tests, which its owner deleted
	// mid-test so the rename that should 400 succeeded (issue #142). Same repair
	// the #130 session applied to usage.TestRollupAndPurge, which borrowed
	// `ListActiveServices()[0]`: a test owns every row it asserts on.
	// It doubles as the still-used category for the guarded-delete case further
	// down, so it is created once, here.
	if rec := call(adminCreateCategory(d), http.MethodPost, "/api/admin/categories", `{"slug":"route-test-used","label":`+label+`,"sort":9110}`, ""); rec.Code != http.StatusCreated {
		t.Fatalf("create used category = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}

	before := invalidated

	// ...and on update.
	if rec := call(adminUpdateCategory(d), http.MethodPatch, "/api/admin/categories/route-test-cat", `{"slug":"Foo Bar!!","label":`+label+`}`, "route-test-cat"); rec.Code != http.StatusBadRequest {
		t.Errorf("update with a malformed slug = %d, want 400", rec.Code)
	}
	if invalidated != before {
		t.Error("a failed write must not invalidate the catalog cache")
	}

	// A rename onto an existing slug is a 400 with a readable detail, never a 500.
	if rec := call(adminUpdateCategory(d), http.MethodPatch, "/api/admin/categories/route-test-cat", `{"slug":"route-test-used","label":`+label+`}`, "route-test-cat"); rec.Code != http.StatusBadRequest {
		t.Errorf("rename onto an existing slug = %d, want 400 (%s)", rec.Code, rec.Body.String())
	} else if !strings.Contains(rec.Body.String(), "slug") {
		t.Errorf("duplicate-slug detail = %s, want it to name the slug field", rec.Body.String())
	}

	// A successful rename + relabel: 200, and the cache is invalidated.
	rec := call(adminUpdateCategory(d), http.MethodPatch, "/api/admin/categories/route-test-cat",
		`{"slug":"route-test-renamed","label":{"de":"Route Test v2","en":"Route test v2"}}`, "route-test-cat")
	if rec.Code != http.StatusOK {
		t.Fatalf("update = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "route-test-renamed") || !strings.Contains(rec.Body.String(), "Route Test v2") {
		t.Errorf("update body = %s, want the new slug and label", rec.Body.String())
	}
	if invalidated != before+1 {
		t.Errorf("invalidate calls after update = %d, want %d", invalidated, before+1)
	}

	// Unknown slug → 404.
	if rec := call(adminUpdateCategory(d), http.MethodPatch, "/api/admin/categories/nope", `{"slug":"nope","label":`+label+`}`, "nope"); rec.Code != http.StatusNotFound {
		t.Errorf("update unknown slug = %d, want 404", rec.Code)
	}
	if rec := call(adminDeleteCategory(d), http.MethodDelete, "/api/admin/categories/nope", "", "nope"); rec.Code != http.StatusNotFound {
		t.Errorf("delete unknown slug = %d, want 404", rec.Code)
	}

	// A category a service still uses → 409 with the blocking count in the
	// detail, not a raw constraint error. route-test-used was created above.
	svcBody := `{"name":"Route Test Service","description":{"de":"Test.","en":"Test."},"service_url":"https://rt.example.edu","icon":"server","categories":["route-test-used"]}`
	if rec := call(adminCreateService(d), http.MethodPost, "/api/admin/services", svcBody, ""); rec.Code != http.StatusCreated {
		t.Fatalf("create service = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	rec = call(adminDeleteCategory(d), http.MethodDelete, "/api/admin/categories/route-test-used", "", "route-test-used")
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete a used category = %d, want 409 (%s)", rec.Code, rec.Body.String())
	}
	if body := rec.Body.String(); !strings.Contains(body, "1 service still uses") || !strings.Contains(body, "Route Test Service") {
		t.Errorf("refusal detail = %s, want the count and the blocking service name", body)
	}

	// The unused one deletes → 204 + invalidation.
	before = invalidated
	if rec := call(adminDeleteCategory(d), http.MethodDelete, "/api/admin/categories/route-test-renamed", "", "route-test-renamed"); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}
	if invalidated != before+1 {
		t.Errorf("invalidate calls after delete = %d, want %d", invalidated, before+1)
	}

	// Reorder: a partial list is a 400; the full permutation is a 204 that
	// invalidates and actually changes the order.
	current, err := db.ListCategorySlugs(ctx)
	if err != nil {
		t.Fatalf("ListCategorySlugs: %v", err)
	}
	partial, _ := json.Marshal(map[string]any{"slugs": current[:len(current)-1]})
	if rec := call(adminSetCategoryOrder(d), http.MethodPut, "/api/admin/categories/order", string(partial), ""); rec.Code != http.StatusBadRequest {
		t.Errorf("reorder with a partial list = %d, want 400", rec.Code)
	}
	reversed := make([]string, len(current))
	for i, s := range current {
		reversed[len(current)-1-i] = s
	}
	before = invalidated
	full, _ := json.Marshal(map[string]any{"slugs": reversed})
	if rec := call(adminSetCategoryOrder(d), http.MethodPut, "/api/admin/categories/order", string(full), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("reorder = %d, want 204 (%s)", rec.Code, rec.Body.String())
	}
	if invalidated != before+1 {
		t.Errorf("invalidate calls after reorder = %d, want %d", invalidated, before+1)
	}
	after, err := db.ListCategorySlugs(ctx)
	if err != nil {
		t.Fatalf("ListCategorySlugs after reorder: %v", err)
	}
	if !reflect.DeepEqual(after, reversed) {
		t.Errorf("order after reorder = %q, want %q", after, reversed)
	}

	// All three actions are in the audit log.
	rec = call(adminListAudit(d), http.MethodGet, "/api/admin/audit", "", "")
	body := rec.Body.String()
	for _, action := range []string{"category.update", "category.delete", "category.reorder"} {
		if !strings.Contains(body, action) {
			t.Errorf("audit missing %s: %s", action, body)
		}
	}
}
