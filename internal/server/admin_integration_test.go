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

	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
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
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'API Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from categories where slug = 'api-test-cat'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'admin-api-test'")
		db.Close()
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
	if rec := call(adminCreateCategory(d), http.MethodPost, "/api/admin/categories", `{"slug":"api-test-cat","label":{"de":"API Test"},"sort":99}`, "", ""); rec.Code != http.StatusCreated {
		t.Fatalf("create category = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	body := `{"name":"API Test Service","description":{"de":"Test."},"service_url":"https://t.example.edu","icon":"server","categories":["api-test-cat"]}`
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
}
