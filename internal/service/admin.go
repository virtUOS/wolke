package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/config"
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
// MCP server behave identically (docs/02 §10). vis is the deployment's
// configured visibility set: a service may only be restricted to a slug it
// contains.
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
//
// Moving a service into a restricted category also purges its role-default
// rows in the same transaction and records the affected roles as `purged_roles`
// in the diff, the way SetRoleDefaults reports its own purge. Default views are
// public-only (docs/specs/service-visibility.md §2.2): without this, a public
// default later restricted would reach non-holders through
// /api/catalog/defaults and wedge that role's editor, whose every save would
// then be rejected. The admin's intent is unambiguous, so the write follows
// through rather than bouncing them into a two-step dance. (CreateService needs
// no counterpart: a fresh id cannot be anyone's default yet.)
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
		diff := map[string]any{
			"before": toAdminService(before, beforeSlugs),
			"after":  out,
		}
		restricted, err := q.ListServiceRestrictedCategories(ctx, id)
		if err != nil {
			return fmt.Errorf("check restricted categories: %w", err)
		}
		if len(restricted) > 0 {
			purged, err := q.PurgeRoleDefaultsForService(ctx, id)
			if err != nil {
				return fmt.Errorf("purge role defaults of restricted service: %w", err)
			}
			if len(purged) > 0 {
				diff["purged_roles"] = purged
			}
		}
		return audit(ctx, q, actor, "service.update", id, diff)
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

// SetRoleDefaults replaces the ordered default services for a role. The role
// must be one this deployment configures (roles.go); saving a list also purges
// rows left behind by roles the claim mapping no longer defines, which is the
// one moment we know it is safe to (spec §2.2).
//
// A service in a restricted category may not be a role default
// (docs/specs/service-visibility.md §2.2): default views stay public-only, so
// every user of a role sees the same default view. Rejected with a field error
// naming the service. A beta service is deliberately NOT rejected — it is a
// per-user choice, not a grant, and degrades for the users who have not asked
// for beta services exactly as a soft-deleted default does.
func SetRoleDefaults(ctx context.Context, db AdminDB, actor Actor, roles config.RoleSet, role string, serviceIDs []pgtype.UUID) error {
	if err := ValidateRole(roles, role); err != nil {
		return err
	}
	return inTx(ctx, db, func(q *store.Queries) error {
		// Purge first, in one statement, so the delete and the roles it reports
		// cannot disagree. Guarded on a non-empty set: `<> all('{}')` matches
		// every row, and an empty set means a misconfigured caller, not "purge
		// everything".
		var purged []string
		if slugs := roles.Slugs(); len(slugs) > 0 {
			var err error
			if purged, err = q.PurgeRoleDefaultsNotIn(ctx, slugs); err != nil {
				return fmt.Errorf("purge stale role defaults: %w", err)
			}
		}
		if err := q.DeleteRoleDefaults(ctx, role); err != nil {
			return fmt.Errorf("clear role defaults: %w", err)
		}
		ids := make([]string, 0, len(serviceIDs))
		for i, sid := range serviceIDs {
			svc, err := q.GetServiceByID(ctx, sid)
			if errors.Is(err, pgx.ErrNoRows) {
				return &ValidationError{Field: "service_ids", Msg: "contains an unknown service"}
			}
			if err != nil {
				return fmt.Errorf("look up service: %w", err)
			}
			restricted, err := q.ListServiceRestrictedCategories(ctx, sid)
			if err != nil {
				return fmt.Errorf("check restricted categories: %w", err)
			}
			if len(restricted) > 0 {
				return &ValidationError{Field: "service_ids", Msg: fmt.Sprintf("%q is in a restricted category (%s) and cannot be a role default", svc.Name, textVal(restricted[0]))}
			}
			if err := q.AddRoleDefault(ctx, store.AddRoleDefaultParams{Role: role, ServiceID: sid, Sort: int32(i)}); err != nil {
				return &ValidationError{Field: "service_ids", Msg: "contains an unknown service"}
			}
			ids = append(ids, uuidStr(sid))
		}
		diff := map[string]any{"role": role, "service_ids": ids}
		if len(purged) > 0 {
			diff["purged_roles"] = purged
		}
		return audit(ctx, q, actor, "role_defaults.set", pgtype.UUID{}, diff)
	})
}

// ConflictError is a well-formed write the current state refuses — other data
// still depends on what it would change. The HTTP layer maps it to a 409.
type ConflictError struct{ Msg string }

func (e *ConflictError) Error() string { return e.Msg }

// Category slugs are kebab-case: lowercase alphanumerics, hyphen-separated.
// They appear in the /?cat=<slug> URL filter, so the format is a real rule and
// not cosmetic. This regex used to live only in CategoriesAdmin.tsx, which left
// the API accepting "Foo Bar!!" — it belongs here, with the frontend's copy
// kept purely as fast feedback (CLAUDE.md rule 3, issue #130).
var categorySlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// How many blocking service names a delete refusal names before it counts the
// rest. Enough to act on, short enough to read in one line.
const categoryInUseSample = 4

// AdminCategory is the API/audit shape of a category (label as a map, not the
// raw JSONB bytes store.Category carries).
type AdminCategory struct {
	Slug  string            `json:"slug"`
	Label map[string]string `json:"label"`
	Sort  int32             `json:"sort"`
	// Visibility restricts the category — and every service in it — to holders
	// of a configured slug; "" = public (docs/specs/service-visibility.md
	// §2.2). Admin surfaces always see it, narrowed reads never do.
	Visibility string `json:"visibility,omitempty"`
}

func toAdminCategory(c store.Category) AdminCategory {
	return AdminCategory{
		Slug: c.Slug, Label: jsonToMap(c.Label), Sort: c.Sort,
		Visibility: textVal(c.Visibility),
	}
}

// ListAdminCategories returns every category with its visibility, unnarrowed —
// what the admin screens manage (docs/specs/service-visibility.md §5). The
// dashboard's /api/catalog stays narrowed, admin or not.
func ListAdminCategories(ctx context.Context, db store.Querier) ([]AdminCategory, error) {
	rows, err := db.AdminListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	out := make([]AdminCategory, 0, len(rows))
	for _, c := range rows {
		out = append(out, toAdminCategory(c))
	}
	return out, nil
}

// validateCategoryInput enforces the slug format, the both-languages label rule
// and the configured-visibility rule for every category write path, and returns
// the trimmed slug. A category may only be restricted to a slug this deployment
// configures — an unconfigured one would fail closed (nobody holds it, so
// nobody sees the category), which is a footgun, not a feature.
func validateCategoryInput(slug string, label map[string]string, visibility string, vis config.VisibilitySet) (string, error) {
	if visibility != "" && !vis.Has(visibility) {
		msg := "must be empty (public)"
		if vis.Len() > 0 {
			msg += " or one of " + strings.Join(vis.Slugs(), ", ")
		} else {
			msg += "; this deployment configures no visibility groups"
		}
		return "", &ValidationError{Field: "visibility", Msg: msg}
	}
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return "", &ValidationError{Field: "slug", Msg: "must not be empty"}
	}
	if !categorySlugPattern.MatchString(slug) {
		return "", &ValidationError{Field: "slug", Msg: "must be lowercase letters, digits and single hyphens (e.g. \"forschung\")"}
	}
	if strings.TrimSpace(label["de"]) == "" {
		return "", &ValidationError{Field: "label", Msg: "German label (de) is required"}
	}
	if strings.TrimSpace(label["en"]) == "" {
		return "", &ValidationError{Field: "label", Msg: "English label (en) is required"}
	}
	return slug, nil
}

// requireFreeSlug rejects a slug another category already holds. categories.slug
// is unique not null, so without this check the raw 23505 would surface as a 500
// on both create and rename (issue #130 §2.2).
func requireFreeSlug(ctx context.Context, q *store.Queries, slug string) error {
	_, err := q.GetCategoryBySlug(ctx, slug)
	switch {
	case err == nil:
		return &ValidationError{Field: "slug", Msg: fmt.Sprintf("already exists (%q)", slug)}
	case errors.Is(err, pgx.ErrNoRows):
		return nil
	default:
		return fmt.Errorf("check category slug: %w", err)
	}
}

// CreateCategory adds a managed category, public or restricted to a configured
// visibility slug.
func CreateCategory(ctx context.Context, db AdminDB, actor Actor, vis config.VisibilitySet, slug string, label map[string]string, sort int, visibility string) (store.Category, error) {
	slug, err := validateCategoryInput(slug, label, visibility, vis)
	if err != nil {
		return store.Category{}, err
	}
	var out store.Category
	err = inTx(ctx, db, func(q *store.Queries) error {
		if err := requireFreeSlug(ctx, q, slug); err != nil {
			return err
		}
		c, err := q.CreateCategory(ctx, store.CreateCategoryParams{
			Slug: slug, Label: mustJSON(label), Sort: int32(sort), Visibility: pgText(visibility),
		})
		if err != nil {
			return fmt.Errorf("create category: %w", err)
		}
		out = c
		return audit(ctx, q, actor, "category.create", c.ID, map[string]any{"after": toAdminCategory(c)})
	})
	return out, err
}

// UpdateCategory edits a category's slug, both labels and its visibility,
// addressed by its current slug, and audits the before/after diff.
//
// Renaming is allowed: service_categories joins on the category id, so
// attachments survive untouched, and the only slug consumer is the /?cat=<slug>
// URL filter, which Dashboard.tsx already drops when the catalog no longer knows
// it (issue #130 §2.2).
func UpdateCategory(ctx context.Context, db AdminDB, actor Actor, vis config.VisibilitySet, slug, newSlug string, label map[string]string, visibility string) (store.Category, error) {
	newSlug, err := validateCategoryInput(newSlug, label, visibility, vis)
	if err != nil {
		return store.Category{}, err
	}
	var out store.Category
	err = inTx(ctx, db, func(q *store.Queries) error {
		before, err := q.GetCategoryBySlug(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return &NotFoundError{What: "category"}
		}
		if err != nil {
			return fmt.Errorf("get category: %w", err)
		}
		if newSlug != before.Slug {
			if err := requireFreeSlug(ctx, q, newSlug); err != nil {
				return err
			}
		}
		c, err := q.UpdateCategory(ctx, store.UpdateCategoryParams{
			ID: before.ID, Slug: newSlug, Label: mustJSON(label), Visibility: pgText(visibility),
		})
		if err != nil {
			return fmt.Errorf("update category: %w", err)
		}
		out = c
		diff := map[string]any{
			"before": toAdminCategory(before),
			"after":  toAdminCategory(c),
		}
		// Restricting a category takes its services out of every default view,
		// for the same reason UpdateService does it: a default nobody may see
		// wedges that role's editor.
		if visibility != "" {
			purged, err := q.PurgeRoleDefaultsForCategory(ctx, before.ID)
			if err != nil {
				return fmt.Errorf("purge role defaults of restricted category: %w", err)
			}
			if len(purged) > 0 {
				diff["purged_roles"] = purged
			}
		}
		return audit(ctx, q, actor, "category.update", c.ID, diff)
	})
	return out, err
}

// categoryInUseMessage is the refusal a guarded delete returns: how many
// services block it and, so the admin knows what to reassign, the first few by
// name (issue #130 §2.3).
func categoryInUseMessage(n int64, names []string) string {
	verb := "services still use"
	object := "them"
	if n == 1 {
		verb = "service still uses"
		object = "it"
	}
	listed := strings.Join(names, ", ")
	if rest := n - int64(len(names)); rest > 0 {
		listed = fmt.Sprintf("%s and %d more", listed, rest)
	}
	return fmt.Sprintf("%d %s this category: %s. Reassign %s first.", n, verb, listed, object)
}

// DeleteCategory removes a category that nothing uses, and audits it.
//
// The delete is guarded, not cascading: service_categories.category_id is
// `on delete restrict`, and that is the right guard — every service must carry
// at least one category, so cascading could mint invalid services. A category
// services still hold is refused with a ConflictError naming the count, rather
// than letting the constraint violation surface as a 500.
func DeleteCategory(ctx context.Context, db AdminDB, actor Actor, slug string) error {
	return inTx(ctx, db, func(q *store.Queries) error {
		before, err := q.GetCategoryBySlug(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return &NotFoundError{What: "category"}
		}
		if err != nil {
			return fmt.Errorf("get category: %w", err)
		}
		n, err := q.CountCategoryServices(ctx, before.ID)
		if err != nil {
			return fmt.Errorf("count category services: %w", err)
		}
		if n > 0 {
			names, err := q.ListCategoryServiceNames(ctx, store.ListCategoryServiceNamesParams{
				CategoryID: before.ID, Lim: categoryInUseSample,
			})
			if err != nil {
				return fmt.Errorf("list category services: %w", err)
			}
			return &ConflictError{Msg: categoryInUseMessage(n, names)}
		}
		if _, err := q.DeleteCategory(ctx, before.ID); err != nil {
			return fmt.Errorf("delete category: %w", err)
		}
		return audit(ctx, q, actor, "category.delete", before.ID, map[string]any{
			"before": toAdminCategory(before),
		})
	})
}

// checkCategoryPermutation is the reorder contract: the incoming list must be a
// permutation of exactly the existing slugs. Anything else is a client that is
// out of sync, and renumbering a partial list would silently collapse the order
// it didn't send — the same rule, for the same reason, as SetFavoritesOrder.
func checkCategoryPermutation(current, want []string) error {
	seen := make(map[string]bool, len(want))
	for _, slug := range want {
		if seen[slug] {
			return &ValidationError{Field: "slugs", Msg: "must not list a category twice"}
		}
		seen[slug] = true
	}
	if len(current) != len(seen) {
		return &ValidationError{Field: "slugs", Msg: "must list exactly the existing categories"}
	}
	for _, slug := range current {
		if !seen[slug] {
			return &ValidationError{Field: "slugs", Msg: "must list exactly the existing categories"}
		}
	}
	return nil
}

// SetCategoryOrder replaces the order categories appear in for every user with
// the given whole list, and audits the before/after order. Idempotent: writing
// the same list twice is a no-op.
func SetCategoryOrder(ctx context.Context, db AdminDB, actor Actor, slugs []string) error {
	return inTx(ctx, db, func(q *store.Queries) error {
		current, err := q.ListCategorySlugs(ctx)
		if err != nil {
			return fmt.Errorf("list category slugs: %w", err)
		}
		if err := checkCategoryPermutation(current, slugs); err != nil {
			return err
		}
		if len(slugs) == 0 {
			return nil
		}
		if _, err := q.SetCategoryOrder(ctx, slugs); err != nil {
			return fmt.Errorf("set category order: %w", err)
		}
		return audit(ctx, q, actor, "category.reorder", pgtype.UUID{}, map[string]any{
			"before": current,
			"after":  slugs,
		})
	})
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
