package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// AdminDeps are what the admin endpoints need: the use-case store, the catalog
// cache (invalidated after writes), and an audit reader.
type AdminDeps struct {
	Store      service.AdminDB
	Invalidate func() // catalog cache invalidation; nil = no-op
	Audit      AuditStore
}

// AuditStore reads the audit log.
type AuditStore interface {
	ListAudit(ctx context.Context, lim int32) ([]store.AuditLog, error)
}

// requireAdmin gates admin routes; assumes loadSession ran. Non-admins get 403.
func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := userFromContext(r.Context())
		if !ok {
			writeProblem(w, http.StatusUnauthorized, "unauthenticated", "Login required.")
			return
		}
		if !user.IsAdmin {
			writeProblem(w, http.StatusForbidden, "forbidden", "Admin access required.")
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
}

func (b serviceBody) draft() service.Draft {
	return service.Draft{
		Name:        b.Name,
		Description: b.Description,
		ServiceURL:  b.ServiceURL,
		DocURL:      b.DocURL,
		Icon:        b.Icon,
		Categories:  b.Categories,
	}
}

func adminListServices(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := service.ListAdminServices(r.Context(), d.Store)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"services": list})
	}
}

func adminCreateService(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b serviceBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		svc, err := service.CreateService(r.Context(), d.Store, actorFromContext(r.Context()), b.draft())
		if err != nil {
			writeServiceError(w, err)
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
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id.")
			return
		}
		var b serviceBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		svc, err := service.UpdateService(r.Context(), d.Store, actorFromContext(r.Context()), id, b.draft())
		if err != nil {
			writeServiceError(w, err)
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
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id.")
			return
		}
		if err := service.SoftDeleteService(r.Context(), d.Store, actorFromContext(r.Context()), id); err != nil {
			writeServiceError(w, err)
			return
		}
		d.invalidate()
		w.WriteHeader(http.StatusNoContent)
	}
}

func adminGetRoleDefaults(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ids, err := d.Store.GetRoleDefaults(r.Context(), chi.URLParam(r, "role"))
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "internal", "Could not read role defaults.")
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
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		ids := make([]pgtype.UUID, 0, len(b.ServiceIDs))
		for _, s := range b.ServiceIDs {
			id, ok := parseUUID(s)
			if !ok {
				writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid service id in list.")
				return
			}
			ids = append(ids, id)
		}
		if err := service.SetRoleDefaults(r.Context(), d.Store, actorFromContext(r.Context()), role, ids); err != nil {
			writeServiceError(w, err)
			return
		}
		d.invalidate()
		w.WriteHeader(http.StatusNoContent)
	}
}

func adminCreateCategory(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Slug  string            `json:"slug"`
			Label map[string]string `json:"label"`
			Sort  int               `json:"sort"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		cat, err := service.CreateCategory(r.Context(), d.Store, actorFromContext(r.Context()), b.Slug, b.Label, b.Sort)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		d.invalidate()
		writeJSON(w, http.StatusCreated, map[string]any{"slug": cat.Slug})
	}
}

// auditEntry is the API shape of an audit row (diff embedded as raw JSON).
type auditEntry struct {
	ID        int64           `json:"id"`
	ActorID   string          `json:"actor_id"`
	ActorKind string          `json:"actor_kind"`
	Action    string          `json:"action"`
	TargetID  string          `json:"target_id,omitempty"`
	Diff      json.RawMessage `json:"diff,omitempty"`
	CreatedAt string          `json:"created_at"`
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
			writeProblem(w, http.StatusInternalServerError, "audit_unavailable", "Could not read the audit log.")
			return
		}
		out := make([]auditEntry, 0, len(rows))
		for _, a := range rows {
			out = append(out, auditEntry{
				ID:        a.ID,
				ActorID:   uuidString(a.ActorID),
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
