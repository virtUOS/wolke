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
	// Tag is at most one status badge. "beta" additionally means the service is
	// hidden unless the reader asked for beta services
	// (docs/specs/service-visibility.md §2.1); "wartung" is cosmetic plus its
	// filter, as before. The asymmetry is deliberate.
	Tag string `json:"tag,omitempty"` // "beta" | "wartung" | ""
}

// Category is the read model of a managed category. Visibility is the
// configured slug that restricts it, or "" for a public category
// (docs/specs/service-visibility.md §2.2): only holders of that slug see the
// category and everything in it. It is not serialized — a View never carries a
// category the reader may not see, and the admin screens read the unnarrowed
// GET /api/admin/categories instead.
type Category struct {
	Slug       string            `json:"slug"`
	Label      map[string]string `json:"label"`
	Sort       int               `json:"sort"`
	Visibility string            `json:"-"`
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
	// public is the pre-narrowed view for the commonest reader: holding no
	// group and not asking for beta services. When no category is restricted
	// and nothing is tagged beta it IS the whole catalog, and VisibleTo hands
	// it out without copying — the plain deployment pays nothing.
	public     *View
	restricted bool // some category carries a visibility slug
	hasBeta    bool // some service is tagged beta
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
	for _, c := range categories {
		if c.Visibility != "" {
			s.restricted = true
			break
		}
	}
	for _, svc := range services {
		if svc.Tag == TagBeta {
			s.hasBeta = true
			break
		}
	}
	if s.restricted || s.hasBeta {
		s.public = s.narrow(nil, false)
	} else {
		s.public = newView(services, categories)
	}
	return s
}

// TagBeta is the tag that both badges a service and hides it until the reader
// switches beta services on (docs/specs/service-visibility.md §2.1).
const TagBeta = "beta"

// VisibleTo returns the catalog as one reader sees it. Two independent rules
// narrow it (docs/specs/service-visibility.md §3):
//
//	visible(service) = every restricted category of the service is in held
//	                   AND (service.Tag != beta OR showBeta)
//
// "Restricted wins": a service in both a restricted and a public category is
// hidden from non-holders, so restriction cannot be bypassed by filing the
// service under a second category.
//
// held may be nil and showBeta false — public, no beta, which is what the
// catalog MCP passes unconditionally (it has no user to ask).
//
// Categories narrow too, which is what makes a restricted group's category
// vanish for non-holders instead of rendering as an empty filter pill: a
// restricted category the reader does not hold is dropped, and so is any
// category that filtering emptied. A category that has no services for anyone
// stays, exactly as today — so a deployment with no restricted category and no
// beta service gets byte-identical output to the raw catalog.
func (s *Snapshot) VisibleTo(held []string, showBeta bool) *View {
	// Nothing to narrow, or the pre-narrowed reader: hand out the cached view.
	if (!s.restricted && !s.hasBeta) || (len(held) == 0 && !showBeta) {
		if s.public == nil {
			// The zero Snapshot (never assembled): empty, not nil.
			return newView([]Service{}, []Category{})
		}
		return s.public
	}
	return s.narrow(held, showBeta)
}

// visible is the predicate itself, in one place. restrictedBy maps a category
// slug to the visibility slug restricting it (absent = public).
func visible(svc Service, restrictedBy map[string]string, held []string, showBeta bool) bool {
	if svc.Tag == TagBeta && !showBeta {
		return false
	}
	for _, cat := range svc.Categories {
		if slug := restrictedBy[cat]; slug != "" && !slices.Contains(held, slug) {
			return false
		}
	}
	return true
}

func (s *Snapshot) narrow(held []string, showBeta bool) *View {
	restrictedBy := make(map[string]string, len(s.categories))
	for _, c := range s.categories {
		if c.Visibility != "" {
			restrictedBy[c.Slug] = c.Visibility
		}
	}

	services := make([]Service, 0, len(s.services))
	for _, svc := range s.services {
		if visible(svc, restrictedBy, held, showBeta) {
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
	stillPopulated := map[string]bool{}
	for _, svc := range services {
		for _, c := range svc.Categories {
			stillPopulated[c] = true
		}
	}
	categories := make([]Category, 0, len(s.categories))
	for _, c := range s.categories {
		if slug := restrictedBy[c.Slug]; slug != "" && !slices.Contains(held, slug) {
			continue
		}
		if !populated[c.Slug] || stillPopulated[c.Slug] {
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
		categories = append(categories, Category{
			Slug: c.Slug, Label: label, Sort: int(c.Sort), Visibility: textStr(c.Visibility),
		})
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
