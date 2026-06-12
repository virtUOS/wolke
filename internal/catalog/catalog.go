// Package catalog builds and serves the read model of services and categories.
// Reads are served from an in-process snapshot cache so the bulk of traffic
// never touches the DB (docs/02 §9); writes (Phase 3) invalidate the cache.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
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
}

// Category is the read model of a managed category.
type Category struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
	Sort  int               `json:"sort"`
}

// Snapshot is an immutable, fully-assembled view of the active catalog.
type Snapshot struct {
	Services   []Service           `json:"services"`
	Categories []Category          `json:"categories"`
	byID       map[string]*Service // lookup for defaults/search assembly
}

// ServiceByID returns the service with the given id, if present.
func (s *Snapshot) ServiceByID(id string) (Service, bool) {
	if svc, ok := s.byID[id]; ok {
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
	byID := make(map[string]*Service, len(svcRows))
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
		}
		if svc.Categories == nil {
			svc.Categories = []string{}
		}
		services = append(services, svc)
	}
	for i := range services {
		byID[services[i].ID] = &services[i]
	}

	return &Snapshot{Services: services, Categories: categories, byID: byID}, nil
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
