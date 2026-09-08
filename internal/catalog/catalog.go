// Package catalog builds and serves the read model of services and categories.
// Reads are served from an in-process snapshot cache so the bulk of traffic
// never touches the DB (docs/02 §9); writes (Phase 3) invalidate the cache.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// Service is the read model of a catalog entry. DocOnly is true when there is no
// service_url, i.e. the tile launches documentation instead (docs/01 §5.3).
type Service struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description map[string]string `json:"description"`
	ServiceURL  string            `json:"service_url,omitempty"`
	DocURL      string            `json:"doc_url,omitempty"`
	Icon        string            `json:"icon"`
	Categories  []string          `json:"categories"` // category slugs
	DocOnly     bool              `json:"doc_only"`
	Tag         string            `json:"tag,omitempty"` // "beta" | "wartung" | ""
	// Visibility is the configured slug this service is restricted to, or ""
	// for a public service (docs/specs/service-visibility.md). Only ever
	// present on a service the reader holds — a View never carries a service
	// whose slug the reader lacks.
	Visibility string `json:"visibility,omitempty"`
}

// Category is the read model of a managed category.
type Category struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
	Sort  int               `json:"sort"`
}

// Snapshot is an immutable, fully-assembled view of the active catalog — the
// RAW one, straight from the loader. It is deliberately unreadable: its service
// and category accessors are unexported, and the only way to get at them is
// VisibleTo, which narrows the catalog to what one reader may see. A handler
// that forgets to narrow therefore fails to compile rather than leaking a
// restricted service (docs/specs/service-visibility.md §3).
type Snapshot struct {
	services   []Service
	categories []Category
	// public is the pre-narrowed view for a reader holding nothing. When no
	// service is restricted it IS the whole catalog, and VisibleTo hands it
	// out without copying — the unconfigured deployment pays nothing.
	public     *View
	restricted bool
}

// NewSnapshot assembles a snapshot from already-built services and categories.
// Load uses it; tests use it to build fixtures without a database.
func NewSnapshot(services []Service, categories []Category) *Snapshot {
	if services == nil {
		services = []Service{}
	}
	if categories == nil {
		categories = []Category{}
	}
	s := &Snapshot{services: services, categories: categories}
	for _, svc := range services {
		if svc.Visibility != "" {
			s.restricted = true
			break
		}
	}
	if s.restricted {
		s.public = s.narrow(nil)
	} else {
		s.public = newView(services, categories)
	}
	return s
}

// VisibleTo returns the catalog as one reader sees it: public services plus
// those whose visibility slug is in held, and only the categories that still
// contain a service this reader can see. held may be nil (public only — what
// the catalog MCP server passes, unconditionally).
//
// Category narrowing is what makes a restricted group's category vanish for
// non-holders instead of rendering as an empty filter pill. A category that has
// no services for anyone stays, exactly as today — narrowing only drops
// categories that filtering emptied, so an unconfigured deployment's output is
// byte-identical to the raw catalog.
func (s *Snapshot) VisibleTo(held []string) *View {
	if !s.restricted || len(held) == 0 {
		if s.public == nil {
			// The zero Snapshot (never assembled): empty, not nil.
			return newView([]Service{}, []Category{})
		}
		return s.public
	}
	return s.narrow(held)
}

func (s *Snapshot) narrow(held []string) *View {
	services := make([]Service, 0, len(s.services))
	for _, svc := range s.services {
		if svc.Visibility == "" || slices.Contains(held, svc.Visibility) {
			services = append(services, svc)
		}
	}
	// Categories populated by ANY service vs. by a VISIBLE one.
	populated := map[string]bool{}
	for _, svc := range s.services {
		for _, c := range svc.Categories {
			populated[c] = true
		}
	}
	visible := map[string]bool{}
	for _, svc := range services {
		for _, c := range svc.Categories {
			visible[c] = true
		}
	}
	categories := make([]Category, 0, len(s.categories))
	for _, c := range s.categories {
		if !populated[c.Slug] || visible[c.Slug] {
			categories = append(categories, c)
		}
	}
	return newView(services, categories)
}

// View is a narrowed, readable catalog: exactly the services and categories
// one reader may see. It is the only catalog type handlers consume, and it is
// obtained solely through Snapshot.VisibleTo. Its JSON shape is /api/catalog.
type View struct {
	Services   []Service  `json:"services"`
	Categories []Category `json:"categories"`
	byID       map[string]*Service
}

func newView(services []Service, categories []Category) *View {
	byID := make(map[string]*Service, len(services))
	for i := range services {
		byID[services[i].ID] = &services[i]
	}
	return &View{Services: services, Categories: categories, byID: byID}
}

// ServiceByID returns the service with the given id if this reader may see it.
// A restricted service the reader does not hold is indistinguishable from an
// unknown or soft-deleted one — there is no existence oracle.
func (v *View) ServiceByID(id string) (Service, bool) {
	if svc, ok := v.byID[id]; ok {
		return *svc, true
	}
	return Service{}, false
}

// Store is the slice of the data store the catalog loader needs.
type Store interface {
	ListCategories(ctx context.Context) ([]store.Category, error)
	ListActiveServices(ctx context.Context) ([]store.ListActiveServicesRow, error)
	ListActiveServiceCategories(ctx context.Context) ([]store.ListActiveServiceCategoriesRow, error)
}

// Load assembles a fresh snapshot from the store: categories, active services,
// and the many-to-many category attachments.
func Load(ctx context.Context, db Store) (*Snapshot, error) {
	cats, err := db.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	svcRows, err := db.ListActiveServices(ctx)
	if err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}
	pairs, err := db.ListActiveServiceCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("list service categories: %w", err)
	}

	categories := make([]Category, 0, len(cats))
	for _, c := range cats {
		label, err := jsonMap(c.Label)
		if err != nil {
			return nil, fmt.Errorf("category %s label: %w", c.Slug, err)
		}
		categories = append(categories, Category{Slug: c.Slug, Label: label, Sort: int(c.Sort)})
	}

	catsBySvc := map[string][]string{}
	for _, p := range pairs {
		id := uuidStr(p.ServiceID)
		catsBySvc[id] = append(catsBySvc[id], p.Slug)
	}

	services := make([]Service, 0, len(svcRows))
	for _, r := range svcRows {
		desc, err := jsonMap(r.Description)
		if err != nil {
			return nil, fmt.Errorf("service %s description: %w", r.Name, err)
		}
		id := uuidStr(r.ID)
		svc := Service{
			ID:          id,
			Name:        r.Name,
			Description: desc,
			ServiceURL:  textStr(r.ServiceUrl),
			DocURL:      textStr(r.DocUrl),
			Icon:        r.Icon,
			Categories:  catsBySvc[id],
			DocOnly:     !r.ServiceUrl.Valid || r.ServiceUrl.String == "",
			Tag:         textStr(r.Tag),
			Visibility:  textStr(r.Visibility),
		}
		if svc.Categories == nil {
			svc.Categories = []string{}
		}
		services = append(services, svc)
	}

	return NewSnapshot(services, categories), nil
}

func jsonMap(b []byte) (map[string]string, error) {
	if len(b) == 0 {
		return map[string]string{}, nil
	}
	var m map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func textStr(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}
