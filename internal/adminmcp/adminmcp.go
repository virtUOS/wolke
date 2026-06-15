// Package adminmcp is the transport-agnostic core of the admin MCP server: read
// operations plus the staged propose→confirm write contract (docs/02 §8). It
// shares internal/service, so MCP writes get the same validation, soft-delete,
// and audit (actor_kind=mcp) as the form. propose_* NEVER writes; only confirm
// does, with a valid, unexpired, single-use token.
package adminmcp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// TokenTTL bounds how long a staged change can be confirmed (docs/02 §8).
const TokenTTL = 10 * time.Minute

type changeKind string

const (
	kindCreate changeKind = "service.create"
	kindUpdate changeKind = "service.update"
	kindDelete changeKind = "service.delete"
)

type staged struct {
	kind    changeKind
	draft   service.Draft // create/update
	id      pgtype.UUID   // update/delete
	expires time.Time
}

// Manager holds the DB, the acting admin, and the in-memory staged changes.
type Manager struct {
	db    *store.DB
	actor service.Actor

	mu     sync.Mutex
	staged map[string]staged
	now    func() time.Time
}

// New builds a Manager that writes as the given admin actor (kind=mcp).
func New(db *store.DB, actor service.Actor) *Manager {
	return &Manager{db: db, actor: actor, staged: map[string]staged{}, now: time.Now}
}

// --- reads ---

// ListServices returns the full catalog (incl. inactive).
func (m *Manager) ListServices(ctx context.Context) ([]service.AdminService, error) {
	return service.ListAdminServices(ctx, m.db)
}

// GetService returns one service by id.
func (m *Manager) GetService(ctx context.Context, idStr string) (service.AdminService, error) {
	id, err := parseUUID(idStr)
	if err != nil {
		return service.AdminService{}, &service.ValidationError{Field: "id", Msg: "invalid service id"}
	}
	return service.GetAdminService(ctx, m.db, id)
}

// Category is the read shape for category.list.
type Category struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
}

// ListCategories returns the managed categories.
func (m *Manager) ListCategories(ctx context.Context) ([]Category, error) {
	rows, err := m.db.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	out := make([]Category, 0, len(rows))
	for _, c := range rows {
		out = append(out, Category{Slug: c.Slug, Label: jsonMap(c.Label)})
	}
	return out, nil
}

// --- propose (NO write) ---

// Preview is returned by propose_*: the validated result-to-be plus the token to
// confirm it.
type Preview struct {
	ChangeToken string                `json:"change_token"`
	Action      string                `json:"action"`
	Before      *service.AdminService `json:"before,omitempty"`
	After       *service.AdminService `json:"after,omitempty"`
	ExpiresAt   string                `json:"expires_at"`
}

// ProposeCreate validates a new service and stages it. No write.
func (m *Manager) ProposeCreate(ctx context.Context, draft service.Draft) (Preview, error) {
	if err := service.ValidateDraft(draft); err != nil {
		return Preview{}, err
	}
	if err := m.checkCategories(ctx, draft.Categories); err != nil {
		return Preview{}, err
	}
	after := draftPreview(draft, true)
	return m.stage(staged{kind: kindCreate, draft: draft}, "create service", nil, &after), nil
}

// ProposeUpdate validates an edit against the current service and stages it.
func (m *Manager) ProposeUpdate(ctx context.Context, idStr string, draft service.Draft) (Preview, error) {
	id, err := parseUUID(idStr)
	if err != nil {
		return Preview{}, &service.ValidationError{Field: "id", Msg: "invalid service id"}
	}
	before, err := service.GetAdminService(ctx, m.db, id)
	if err != nil {
		return Preview{}, err
	}
	if err := service.ValidateDraft(draft); err != nil {
		return Preview{}, err
	}
	if err := m.checkCategories(ctx, draft.Categories); err != nil {
		return Preview{}, err
	}
	after := draftPreview(draft, before.IsActive)
	after.ID = before.ID
	return m.stage(staged{kind: kindUpdate, id: id, draft: draft}, "update service", &before, &after), nil
}

// ProposeDelete stages a soft delete of an existing service.
func (m *Manager) ProposeDelete(ctx context.Context, idStr string) (Preview, error) {
	id, err := parseUUID(idStr)
	if err != nil {
		return Preview{}, &service.ValidationError{Field: "id", Msg: "invalid service id"}
	}
	before, err := service.GetAdminService(ctx, m.db, id)
	if err != nil {
		return Preview{}, err
	}
	return m.stage(staged{kind: kindDelete, id: id}, "soft-delete service", &before, nil), nil
}

// --- confirm / discard ---

// Confirm executes the staged change for a valid, unexpired, single-use token.
func (m *Manager) Confirm(ctx context.Context, token string) (string, error) {
	m.mu.Lock()
	st, ok := m.staged[token]
	if ok {
		delete(m.staged, token) // single-use: consume regardless of outcome
	}
	m.mu.Unlock()
	if !ok {
		return "", &service.ValidationError{Field: "change_token", Msg: "unknown or already-used token"}
	}
	if m.now().After(st.expires) {
		return "", &service.ValidationError{Field: "change_token", Msg: "token expired"}
	}

	switch st.kind {
	case kindCreate:
		svc, err := service.CreateService(ctx, m.db, m.actor, st.draft)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("Created service %q (%s).", svc.Name, svc.ID), nil
	case kindUpdate:
		svc, err := service.UpdateService(ctx, m.db, m.actor, st.id, st.draft)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("Updated service %q (%s).", svc.Name, svc.ID), nil
	case kindDelete:
		if err := service.SoftDeleteService(ctx, m.db, m.actor, st.id); err != nil {
			return "", err
		}
		return "Service removed (soft delete).", nil
	default:
		return "", fmt.Errorf("unknown staged change kind %q", st.kind)
	}
}

// Discard drops a staged change.
func (m *Manager) Discard(token string) error {
	m.mu.Lock()
	_, ok := m.staged[token]
	delete(m.staged, token)
	m.mu.Unlock()
	if !ok {
		return &service.ValidationError{Field: "change_token", Msg: "unknown token"}
	}
	return nil
}

// --- helpers ---

func (m *Manager) stage(s staged, action string, before, after *service.AdminService) Preview {
	s.expires = m.now().Add(TokenTTL)
	token := newToken()
	m.mu.Lock()
	m.staged[token] = s
	m.mu.Unlock()
	return Preview{ChangeToken: token, Action: action, Before: before, After: after, ExpiresAt: s.expires.UTC().Format(time.RFC3339)}
}

func (m *Manager) checkCategories(ctx context.Context, slugs []string) error {
	for _, slug := range slugs {
		if _, err := m.db.GetCategoryBySlug(ctx, slug); err != nil {
			return &service.ValidationError{Field: "categories", Msg: fmt.Sprintf("unknown category %q", slug)}
		}
	}
	return nil
}

func draftPreview(d service.Draft, active bool) service.AdminService {
	cats := d.Categories
	if cats == nil {
		cats = []string{}
	}
	return service.AdminService{
		Name:        d.Name,
		Description: d.Description,
		ServiceURL:  d.ServiceURL,
		DocURL:      d.DocURL,
		Icon:        d.Icon,
		IsActive:    active,
		Categories:  cats,
	}
}

func newToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return u, err
	}
	return u, nil
}

func jsonMap(b []byte) map[string]string {
	m := map[string]string{}
	_ = json.Unmarshal(b, &m)
	return m
}
