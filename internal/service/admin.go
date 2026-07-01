package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// Actor identifies who performed a write, for the audit log. Kind is "form" or
// "mcp" so the form and MCP paths share this layer (CLAUDE.md rule 3, docs/02 §8).
type Actor struct {
	ID   pgtype.UUID
	Kind string
}

// Actor kinds recorded in the audit log.
const (
	ActorForm = "form"
	ActorMCP  = "mcp"
)

// AdminDB is the store surface the admin use cases need. *store.DB satisfies it,
// and exposes Pool for the transactions these multi-statement writes run in.
type AdminDB interface {
	store.Querier
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Draft is the validated shape for creating/updating a service.
type Draft struct {
	Name        string
	Description map[string]string
	ServiceURL  string
	DocURL      string
	Icon        string
	Categories  []string // category slugs
	Tag         string   // "" | "beta" | "wartung"
	Keywords    []string // optional search aliases; flat, language-agnostic
}

// Keyword limits keep the search aliases sane and the input bounded.
const (
	maxKeywords      = 32
	maxKeywordLength = 50
)

// AdminService is the admin read model (includes is_active / soft-deleted).
type AdminService struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description map[string]string `json:"description"`
	ServiceURL  string            `json:"service_url,omitempty"`
	DocURL      string            `json:"doc_url,omitempty"`
	Icon        string            `json:"icon"`
	IsActive    bool              `json:"is_active"`
	Categories  []string          `json:"categories"`
	Tag         string            `json:"tag,omitempty"`
	Keywords    []string          `json:"keywords"`
}

var validRoles = map[string]bool{"student": true, "teacher": true, "staff": true}

// normalizeKeywords trims, drops blanks, and de-dupes case-insensitively while
// preserving the first occurrence's original casing and order. Always returns a
// non-nil slice so it maps cleanly onto a Postgres text[] (never SQL NULL).
func normalizeKeywords(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, k := range in {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		lk := strings.ToLower(k)
		if seen[lk] {
			continue
		}
		seen[lk] = true
		out = append(out, k)
	}
	return out
}

// validateServiceInput enforces the catalog rules centrally so the form and the
// MCP server behave identically (docs/02 §10).
func validateServiceInput(in Draft) error {
	if strings.TrimSpace(in.Name) == "" {
		return &ValidationError{Field: "name", Msg: "must not be empty"}
	}
	if strings.TrimSpace(in.Description["de"]) == "" {
		return &ValidationError{Field: "description", Msg: "German text (de) is required"}
	}
	if strings.TrimSpace(in.Description["en"]) == "" {
		return &ValidationError{Field: "description", Msg: "English text (en) is required"}
	}
	if !validIconName(in.Icon) {
		return &ValidationError{Field: "icon", Msg: "must be a kebab-case lucide icon name"}
	}
	if in.ServiceURL == "" && in.DocURL == "" {
		return &ValidationError{Field: "service_url", Msg: "a service URL or a documentation URL is required"}
	}
	if in.ServiceURL != "" && !validHTTPURL(in.ServiceURL) {
		return &ValidationError{Field: "service_url", Msg: "must be a valid http(s) URL"}
	}
	if in.DocURL != "" && !validHTTPURL(in.DocURL) {
		return &ValidationError{Field: "doc_url", Msg: "must be a valid http(s) URL"}
	}
	if len(in.Categories) == 0 {
		return &ValidationError{Field: "categories", Msg: "at least one category is required"}
	}
	if in.Tag != "" && in.Tag != "beta" && in.Tag != "wartung" {
		return &ValidationError{Field: "tag", Msg: `must be "", "beta", or "wartung"`}
	}
	kws := normalizeKeywords(in.Keywords)
	if len(kws) > maxKeywords {
		return &ValidationError{Field: "keywords", Msg: fmt.Sprintf("at most %d keywords are allowed", maxKeywords)}
	}
	for _, k := range kws {
		if len([]rune(k)) > maxKeywordLength {
			return &ValidationError{Field: "keywords", Msg: fmt.Sprintf("each keyword must be at most %d characters", maxKeywordLength)}
		}
	}
	return nil
}

func validHTTPURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// ValidateDraft exposes service validation for the MCP propose step, which must
// validate without writing (docs/02 §8).
func ValidateDraft(in Draft) error { return validateServiceInput(in) }

// NormalizeKeywords exposes keyword normalization so the MCP propose preview
// reflects exactly what a confirm would store (docs/02 §8).
func NormalizeKeywords(in []string) []string { return normalizeKeywords(in) }

// GetAdminService returns one service (including inactive) with its categories,
// or a NotFoundError. Read-only.
func GetAdminService(ctx context.Context, db store.Querier, id pgtype.UUID) (AdminService, error) {
	s, err := db.GetServiceByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminService{}, &NotFoundError{What: "service"}
	}
	if err != nil {
		return AdminService{}, fmt.Errorf("get service: %w", err)
	}
	slugs, err := db.ListServiceCategorySlugs(ctx, id)
	if err != nil {
		return AdminService{}, fmt.Errorf("list categories: %w", err)
	}
	return toAdminService(s, slugs), nil
}

// CreateService validates, inserts the service + its categories, and audit-logs
// the write — all in one transaction.
func CreateService(ctx context.Context, db AdminDB, actor Actor, in Draft) (AdminService, error) {
	if err := validateServiceInput(in); err != nil {
		return AdminService{}, err
	}
	var out AdminService
	err := inTx(ctx, db, func(q *store.Queries) error {
		catIDs, err := resolveCategories(ctx, q, in.Categories)
		if err != nil {
			return err
		}
		svc, err := q.CreateService(ctx, store.CreateServiceParams{
			Name:        in.Name,
			Description: mustJSON(in.Description),
			ServiceUrl:  pgText(in.ServiceURL),
			DocUrl:      pgText(in.DocURL),
			Icon:        in.Icon,
			Tag:         pgText(in.Tag),
			Keywords:    normalizeKeywords(in.Keywords),
		})
		if err != nil {
			return fmt.Errorf("create service: %w", err)
		}
		if err := setCategories(ctx, q, svc.ID, catIDs); err != nil {
			return err
		}
		out = toAdminService(svc, in.Categories)
		return audit(ctx, q, actor, "service.create", svc.ID, map[string]any{"after": out})
	})
	return out, err
}

// UpdateService edits a service in place, replacing its category set, and audits
// the before/after diff.
func UpdateService(ctx context.Context, db AdminDB, actor Actor, id pgtype.UUID, in Draft) (AdminService, error) {
	if err := validateServiceInput(in); err != nil {
		return AdminService{}, err
	}
	var out AdminService
	err := inTx(ctx, db, func(q *store.Queries) error {
		before, err := q.GetServiceByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return &NotFoundError{What: "service"}
		}
		if err != nil {
			return err
		}
		beforeSlugs, _ := q.ListServiceCategorySlugs(ctx, id)
		catIDs, err := resolveCategories(ctx, q, in.Categories)
		if err != nil {
			return err
		}
		svc, err := q.UpdateService(ctx, store.UpdateServiceParams{
			ID:          id,
			Name:        in.Name,
			Description: mustJSON(in.Description),
			ServiceUrl:  pgText(in.ServiceURL),
			DocUrl:      pgText(in.DocURL),
			Icon:        in.Icon,
			Tag:         pgText(in.Tag),
			Keywords:    normalizeKeywords(in.Keywords),
		})
		if err != nil {
			return fmt.Errorf("update service: %w", err)
		}
		if err := setCategories(ctx, q, id, catIDs); err != nil {
			return err
		}
		out = toAdminService(svc, in.Categories)
		return audit(ctx, q, actor, "service.update", id, map[string]any{
			"before": toAdminService(before, beforeSlugs),
			"after":  out,
		})
	})
	return out, err
}

// SoftDeleteService hides a service (is_active=false) and audits it. Favorites and
// metrics referencing it degrade gracefully (docs/01 §5.1).
func SoftDeleteService(ctx context.Context, db AdminDB, actor Actor, id pgtype.UUID) error {
	return inTx(ctx, db, func(q *store.Queries) error {
		before, err := q.GetServiceByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return &NotFoundError{What: "service"}
		}
		if err != nil {
			return err
		}
		if _, err := q.SoftDeleteService(ctx, id); err != nil {
			return fmt.Errorf("soft delete: %w", err)
		}
		slugs, _ := q.ListServiceCategorySlugs(ctx, id)
		return audit(ctx, q, actor, "service.delete", id, map[string]any{"before": toAdminService(before, slugs)})
	})
}

// SetRoleDefaults replaces the ordered default services for a role.
func SetRoleDefaults(ctx context.Context, db AdminDB, actor Actor, role string, serviceIDs []pgtype.UUID) error {
	if !validRoles[role] {
		return &ValidationError{Field: "role", Msg: "must be one of student, teacher, staff"}
	}
	return inTx(ctx, db, func(q *store.Queries) error {
		if err := q.DeleteRoleDefaults(ctx, role); err != nil {
			return fmt.Errorf("clear role defaults: %w", err)
		}
		ids := make([]string, 0, len(serviceIDs))
		for i, sid := range serviceIDs {
			if err := q.AddRoleDefault(ctx, store.AddRoleDefaultParams{Role: role, ServiceID: sid, Sort: int32(i)}); err != nil {
				return &ValidationError{Field: "service_ids", Msg: "contains an unknown service"}
			}
			ids = append(ids, uuidStr(sid))
		}
		return audit(ctx, q, actor, "role_defaults.set", pgtype.UUID{}, map[string]any{"role": role, "service_ids": ids})
	})
}

// CreateCategory adds a managed category.
func CreateCategory(ctx context.Context, db AdminDB, actor Actor, slug string, label map[string]string, sort int) (store.Category, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return store.Category{}, &ValidationError{Field: "slug", Msg: "must not be empty"}
	}
	if strings.TrimSpace(label["de"]) == "" {
		return store.Category{}, &ValidationError{Field: "label", Msg: "German label (de) is required"}
	}
	if strings.TrimSpace(label["en"]) == "" {
		return store.Category{}, &ValidationError{Field: "label", Msg: "English label (en) is required"}
	}
	var out store.Category
	err := inTx(ctx, db, func(q *store.Queries) error {
		c, err := q.CreateCategory(ctx, store.CreateCategoryParams{Slug: slug, Label: mustJSON(label), Sort: int32(sort)})
		if err != nil {
			return fmt.Errorf("create category: %w", err)
		}
		out = c
		return audit(ctx, q, actor, "category.create", c.ID, map[string]any{"after": map[string]any{"slug": slug, "label": label}})
	})
	return out, err
}

// SearchInsight is one zero-result query with how often and when it was last
// searched — the worklist for adding service keywords (docs/01 §4.6).
type SearchInsight struct {
	Query    string `json:"query"`
	Searches int64  `json:"searches"`
	LastSeen string `json:"last_seen"`
}

// Bounds for the zero-result insights window/size (shared by form + MCP).
const (
	defaultInsightDays  = 30
	maxInsightDays      = 365
	defaultInsightLimit = 50
	maxInsightLimit     = 200
)

// ListSearchInsights returns the most frequent zero-result searches within the
// window. days/limit are clamped to sane bounds; a zero/out-of-range value falls
// back to the default. One use-case layer for both the HTTP handler and the MCP
// tool (CLAUDE.md rule 3). Read-only; aggregate-only (no user data).
func ListSearchInsights(ctx context.Context, db store.Querier, days, limit int) ([]SearchInsight, error) {
	if days < 1 || days > maxInsightDays {
		days = defaultInsightDays
	}
	if limit < 1 || limit > maxInsightLimit {
		limit = defaultInsightLimit
	}
	rows, err := db.ListZeroResultSearches(ctx, store.ListZeroResultSearchesParams{Days: int32(days), Lim: int32(limit)})
	if err != nil {
		return nil, fmt.Errorf("list search insights: %w", err)
	}
	out := make([]SearchInsight, 0, len(rows))
	for _, e := range rows {
		out = append(out, SearchInsight{
			Query:    e.QueryNorm,
			Searches: e.Searches,
			LastSeen: e.LastSeen.Time.Format(time.RFC3339),
		})
	}
	return out, nil
}

// PruneSearchEvents deletes search_events older than the retention window and
// returns how many rows were removed (docs/02 §5). Bounds the table: the events
// are aggregate-only telemetry, not audit data, so old rows can be discarded.
func PruneSearchEvents(ctx context.Context, db store.Querier, retention time.Duration) (int64, error) {
	cutoff := pgtype.Timestamptz{Time: time.Now().Add(-retention), Valid: true}
	n, err := db.DeleteSearchEventsBefore(ctx, cutoff)
	if err != nil {
		return 0, fmt.Errorf("prune search events: %w", err)
	}
	return n, nil
}

// ListAdminServices returns the full catalog (incl. inactive) with categories.
func ListAdminServices(ctx context.Context, db store.Querier) ([]AdminService, error) {
	rows, err := db.AdminListServices(ctx)
	if err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}
	out := make([]AdminService, 0, len(rows))
	for _, s := range rows {
		slugs, err := db.ListServiceCategorySlugs(ctx, s.ID)
		if err != nil {
			return nil, fmt.Errorf("list categories: %w", err)
		}
		out = append(out, toAdminService(s, slugs))
	}
	return out, nil
}

// --- helpers ---

func inTx(ctx context.Context, db AdminDB, fn func(*store.Queries) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := store.New(tx)
	if err := fn(q); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func resolveCategories(ctx context.Context, q *store.Queries, slugs []string) ([]pgtype.UUID, error) {
	ids := make([]pgtype.UUID, 0, len(slugs))
	for _, slug := range slugs {
		c, err := q.GetCategoryBySlug(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ValidationError{Field: "categories", Msg: fmt.Sprintf("unknown category %q", slug)}
		}
		if err != nil {
			return nil, err
		}
		ids = append(ids, c.ID)
	}
	return ids, nil
}

func setCategories(ctx context.Context, q *store.Queries, serviceID pgtype.UUID, catIDs []pgtype.UUID) error {
	if err := q.DeleteServiceCategories(ctx, serviceID); err != nil {
		return fmt.Errorf("clear categories: %w", err)
	}
	for _, cid := range catIDs {
		if err := q.AddServiceCategory(ctx, store.AddServiceCategoryParams{ServiceID: serviceID, CategoryID: cid}); err != nil {
			return fmt.Errorf("add category: %w", err)
		}
	}
	return nil
}

func audit(ctx context.Context, q *store.Queries, actor Actor, action string, target pgtype.UUID, diff map[string]any) error {
	if err := q.InsertAudit(ctx, store.InsertAuditParams{
		ActorID:   actor.ID,
		ActorKind: actor.Kind,
		Action:    action,
		TargetID:  target,
		Diff:      mustJSON(diff),
	}); err != nil {
		return fmt.Errorf("write audit: %w", err)
	}
	return nil
}

func toAdminService(s store.Service, slugs []string) AdminService {
	if slugs == nil {
		slugs = []string{}
	}
	keywords := s.Keywords
	if keywords == nil {
		keywords = []string{}
	}
	return AdminService{
		ID:          uuidStr(s.ID),
		Name:        s.Name,
		Description: jsonToMap(s.Description),
		ServiceURL:  textVal(s.ServiceUrl),
		DocURL:      textVal(s.DocUrl),
		Icon:        s.Icon,
		IsActive:    s.IsActive,
		Categories:  slugs,
		Tag:         textVal(s.Tag),
		Keywords:    keywords,
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("null")
	}
	return b
}

func jsonToMap(b []byte) map[string]string {
	m := map[string]string{}
	_ = json.Unmarshal(b, &m)
	return m
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func textVal(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}
