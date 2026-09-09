package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/httpx"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// AdminDeps are what the admin endpoints need: the use-case store, the catalog
// cache (invalidated after writes), and an audit reader.
type AdminDeps struct {
	// Roles is the configured role set; the router fills it from Deps.Roles.
	Roles config.RoleSet
	// Visibility is the configured visibility set; the router fills it too.
	Visibility config.VisibilitySet
	Store      service.AdminDB
	Invalidate func() // catalog cache invalidation; nil = no-op
	Audit      AuditStore
}

// AuditStore reads the audit log.
type AuditStore interface {
	ListAudit(ctx context.Context, lim int32) ([]store.ListAuditRow, error)
}

// requireAdmin gates admin routes; assumes loadSession ran. Non-admins get 403.
func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			httpx.WriteProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		if !user.IsAdmin {
			httpx.WriteProblem(w, http.StatusForbidden, "forbidden", "Admin access required.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func actorFromContext(ctx context.Context) service.Actor {
	user, _ := userFromContext(ctx)
	return service.Actor{ID: user.ID, Kind: service.ActorForm}
}

// serviceBody is the create/update request shape.
type serviceBody struct {
	Name        string            `json:"name"`
	Description map[string]string `json:"description"`
	ServiceURL  string            `json:"service_url"`
	DocURL      string            `json:"doc_url"`
	Icon        string            `json:"icon"`
	Categories  []string          `json:"categories"`
	Tag         string            `json:"tag"`
	Keywords    []string          `json:"keywords"`
}

func (b serviceBody) draft() service.Draft {
	return service.Draft{
		Name:        b.Name,
		Description: b.Description,
		ServiceURL:  b.ServiceURL,
		DocURL:      b.DocURL,
		Icon:        b.Icon,
		Categories:  b.Categories,
		Tag:         b.Tag,
		Keywords:    b.Keywords,
	}
}

func adminListServices(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := service.ListAdminServices(r.Context(), d.Store)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"services": list})
	}
}

func adminCreateService(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b serviceBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		svc, err := service.CreateService(r.Context(), d.Store, actorFromContext(r.Context()), b.draft())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		writeJSON(w, http.StatusCreated, svc)
	}
}

func adminUpdateService(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseUUID(chi.URLParam(r, "id"))
		if !ok {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id.")
			return
		}
		var b serviceBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		svc, err := service.UpdateService(r.Context(), d.Store, actorFromContext(r.Context()), id, b.draft())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		writeJSON(w, http.StatusOK, svc)
	}
}

func adminDeleteService(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseUUID(chi.URLParam(r, "id"))
		if !ok {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id.")
			return
		}
		if err := service.SoftDeleteService(r.Context(), d.Store, actorFromContext(r.Context()), id); err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		w.WriteHeader(http.StatusNoContent)
	}
}

func adminGetRoleDefaults(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := chi.URLParam(r, "role")
		if err := service.ValidateRole(d.Roles, role); err != nil {
			writeServiceError(w, r, err)
			return
		}
		ids, err := d.Store.GetRoleDefaults(r.Context(), role)
		if err != nil {
			serverError(w, r, "internal", "Could not read role defaults.", err)
			return
		}
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			out = append(out, uuidString(id))
		}
		writeJSON(w, http.StatusOK, map[string]any{"service_ids": out})
	}
}

func adminSetRoleDefaults(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		role := chi.URLParam(r, "role")
		var b struct {
			ServiceIDs []string `json:"service_ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		ids := make([]pgtype.UUID, 0, len(b.ServiceIDs))
		for _, s := range b.ServiceIDs {
			id, ok := parseUUID(s)
			if !ok {
				httpx.WriteProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id in list.")
				return
			}
			ids = append(ids, id)
		}
		if err := service.SetRoleDefaults(r.Context(), d.Store, actorFromContext(r.Context()), d.Roles, role, ids); err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		w.WriteHeader(http.StatusNoContent)
	}
}

func adminCreateCategory(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b categoryBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		cat, err := service.CreateCategory(r.Context(), d.Store, actorFromContext(r.Context()), d.Visibility, b.Slug, b.Label, b.Sort, b.visibility())
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		writeJSON(w, http.StatusCreated, categoryJSON(cat))
	}
}

// categoryBody is the create/update request shape. `sort` is only meaningful on
// create (the frontend appends past max(sort)); the order is otherwise owned by
// the reorder endpoint.
type categoryBody struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
	Sort  int               `json:"sort"`
	// Visibility restricts the category and every service in it to holders of a
	// configured slug; "" = public (docs/specs/service-visibility.md §2.2).
	//
	// A pointer, so an omitted field means "leave it as it is" rather than
	// "make it public": this is the one field with an access-control effect, and
	// an older SPA build or a script sending only {slug, label} must not
	// silently un-restrict a category and everything in it (review finding 5).
	// On create, absent is simply public — there is nothing to preserve.
	Visibility *string `json:"visibility"`
}

func (b categoryBody) visibility() string {
	if b.Visibility == nil {
		return ""
	}
	return *b.Visibility
}

// adminUpdateCategory handles PATCH /api/admin/categories/{slug}: both labels,
// the visibility group, and — deliberately — the slug itself; attachments join
// on the category id, so a rename is safe (issue #130 §2.2). An omitted
// `visibility` leaves the current one alone (see categoryBody).
func adminUpdateCategory(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b categoryBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		cat, err := service.UpdateCategory(r.Context(), d.Store, actorFromContext(r.Context()), d.Visibility,
			chi.URLParam(r, "slug"), b.Slug, b.Label, b.Visibility)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		writeJSON(w, http.StatusOK, categoryJSON(cat))
	}
}

// adminDeleteCategory handles DELETE /api/admin/categories/{slug}. A category
// services still use comes back as a 409 naming the count, not as the FK's
// constraint violation (issue #130 §2.3).
func adminDeleteCategory(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := service.DeleteCategory(r.Context(), d.Store, actorFromContext(r.Context()), chi.URLParam(r, "slug")); err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		w.WriteHeader(http.StatusNoContent)
	}
}

// adminSetCategoryOrder handles PUT /api/admin/categories/order: the whole
// ordered slug list, written to categories.sort. A whole-list write rather than
// per-row sort arithmetic, so a client and the server can never end up with two
// notions of the order; sending the same list twice is a no-op. Validation
// (permutation, no duplicates) lives in internal/service.
func adminSetCategoryOrder(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Slugs []string `json:"slugs"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			httpx.WriteProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		if err := service.SetCategoryOrder(r.Context(), d.Store, actorFromContext(r.Context()), b.Slugs); err != nil {
			writeServiceError(w, r, err)
			return
		}
		d.invalidate()
		w.WriteHeader(http.StatusNoContent)
	}
}

// categoryJSON is the response shape for a single category write. The label
// comes back as a map, so the admin UI can render what it just saved without
// re-fetching the catalog.
func categoryJSON(c store.Category) map[string]any {
	var label map[string]string
	_ = json.Unmarshal(c.Label, &label)
	out := map[string]any{"slug": c.Slug, "label": label, "sort": c.Sort}
	if c.Visibility.Valid && c.Visibility.String != "" {
		out["visibility"] = c.Visibility.String
	}
	return out
}

// adminListCategories handles GET /api/admin/categories: every category with
// its visibility, unnarrowed. The admin screens read this instead of
// /api/catalog, which is narrowed for admins too — they are ordinary users in
// their own dashboard (docs/specs/service-visibility.md §5).
func adminListCategories(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := service.ListAdminCategories(r.Context(), d.Store)
		if err != nil {
			writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"categories": list})
	}
}

// auditEntry is the API shape of an audit row (diff embedded as raw JSON).
type auditEntry struct {
	ID        int64           `json:"id"`
	ActorID   string          `json:"actor_id"`
	ActorName string          `json:"actor_name,omitempty"` // resolved display name; empty for null/MCP actors
	ActorKind string          `json:"actor_kind"`
	Action    string          `json:"action"`
	TargetID  string          `json:"target_id,omitempty"`
	Diff      json.RawMessage `json:"diff,omitempty"`
	CreatedAt string          `json:"created_at"`
}

// adminSearchInsights lists recent searches that returned nothing — the admin
// worklist for adding service keywords (docs/01 §4.6). Thin wrapper over the
// service layer, which clamps days/limit (absent/invalid params become 0 → the
// service default).
func adminSearchInsights(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		entries, err := service.ListSearchInsights(r.Context(), d.Store, days, limit)
		if err != nil {
			serverError(w, r, "insights_unavailable", "Could not load search insights.", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	}
}

func adminListAudit(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit := int32(100)
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
				limit = int32(n)
			}
		}
		rows, err := d.Audit.ListAudit(r.Context(), limit)
		if err != nil {
			serverError(w, r, "audit_unavailable", "Could not read the audit log.", err)
			return
		}
		out := make([]auditEntry, 0, len(rows))
		for _, a := range rows {
			out = append(out, auditEntry{
				ID:        a.ID,
				ActorID:   uuidString(a.ActorID),
				ActorName: a.ActorName.String, // "" when null (pgtype.Text), dropped by omitempty
				ActorKind: a.ActorKind,
				Action:    a.Action,
				TargetID:  uuidString(a.TargetID),
				Diff:      json.RawMessage(a.Diff),
				CreatedAt: a.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"entries": out})
	}
}

func (d AdminDeps) invalidate() {
	if d.Invalidate != nil {
		d.Invalidate()
	}
}
