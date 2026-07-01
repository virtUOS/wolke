// Package readmcp is the transport-agnostic core of the public catalog MCP
// server: read-only access to the active catalog for any university member.
// It exposes what the SPA's /api/catalog and /api/announcements expose — active
// services (with their beta/maintenance tag and documentation links), the
// category list, search, and active announcements — and nothing else.
//
// By design this package holds NO write path: its Manager never imports the
// admin use cases, so least privilege is enforced at compile time, not by
// discipline. Soft-deleted (inactive) services are never returned, because the
// catalog snapshot it reads from only ever contains active ones.
package readmcp

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/store"
)

// Store is the read surface the catalog MCP server needs: search and
// announcements. The catalog itself is served through the snapshot cache.
type Store interface {
	SearchServiceIDs(ctx context.Context, q string) ([]pgtype.UUID, error)
	announce.Store
}

// Manager serves read-only catalog queries from the in-process snapshot cache
// (the same one the HTTP server uses) plus the search and announcement stores.
type Manager struct {
	cache *catalog.Cache
	db    Store
}

// New builds a Manager over the given catalog cache and read store.
func New(cache *catalog.Cache, db Store) *Manager {
	return &Manager{cache: cache, db: db}
}

// Category is the read shape for category.list.
type Category struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
	Sort  int               `json:"sort"`
}

// ListServices returns active services, optionally narrowed by category slug and
// by status tag ("beta" or "wartung"). Empty filters return the full catalog.
func (m *Manager) ListServices(ctx context.Context, category, status string) ([]catalog.Service, error) {
	snap, err := m.cache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("load catalog: %w", err)
	}
	out := make([]catalog.Service, 0, len(snap.Services))
	for _, s := range snap.Services {
		if category != "" && !containsSlug(s.Categories, category) {
			continue
		}
		if status != "" && s.Tag != status {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

// GetService returns one active service by id, or a not-found error. Inactive or
// unknown ids are indistinguishable here on purpose: the snapshot holds only
// active services.
func (m *Manager) GetService(ctx context.Context, id string) (catalog.Service, error) {
	snap, err := m.cache.Get(ctx)
	if err != nil {
		return catalog.Service{}, fmt.Errorf("load catalog: %w", err)
	}
	svc, ok := snap.ServiceByID(strings.TrimSpace(id))
	if !ok {
		return catalog.Service{}, fmt.Errorf("no active service with id %q", id)
	}
	return svc, nil
}

// Search resolves a fuzzy/substring query to full active services, ranked, in
// the same shape as /api/search.
func (m *Manager) Search(ctx context.Context, query string) ([]catalog.Service, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return []catalog.Service{}, nil
	}
	ids, err := m.db.SearchServiceIDs(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	snap, err := m.cache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("load catalog: %w", err)
	}
	out := make([]catalog.Service, 0, len(ids))
	for _, id := range ids {
		if svc, ok := snap.ServiceByID(uuidStr(id)); ok {
			out = append(out, svc)
		}
	}
	return out, nil
}

// ListInMaintenance returns the active services currently tagged "wartung".
func (m *Manager) ListInMaintenance(ctx context.Context) ([]catalog.Service, error) {
	return m.ListServices(ctx, "", "wartung")
}

// ListCategories returns the managed categories.
func (m *Manager) ListCategories(ctx context.Context) ([]Category, error) {
	snap, err := m.cache.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("load catalog: %w", err)
	}
	out := make([]Category, 0, len(snap.Categories))
	for _, c := range snap.Categories {
		out = append(out, Category{Slug: c.Slug, Label: c.Label, Sort: c.Sort})
	}
	return out, nil
}

// ListAnnouncements returns every in-window announcement across all audiences —
// the maintenance-window signal that complements a service's "wartung" tag.
func (m *Manager) ListAnnouncements(ctx context.Context) ([]announce.Announcement, error) {
	return announce.ListAllActive(ctx, m.db)
}

// --- helpers ---

func containsSlug(slugs []string, want string) bool {
	for _, s := range slugs {
		if s == want {
			return true
		}
	}
	return false
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// compile-time guard: *store.DB satisfies Store.
var _ Store = (*store.DB)(nil)
