package server

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/store"
)

// SearchStore is the search capability: active service ids matching a query
// (ranked; categories attached from the cache so results match /api/catalog),
// plus best-effort logging of each query for the zero-result insights.
type SearchStore interface {
	SearchServiceIDs(ctx context.Context, q string) ([]pgtype.UUID, error)
	InsertSearchEvent(ctx context.Context, arg store.InsertSearchEventParams) error
}

// normalizeSearchQuery folds a query to its logged form: lowercased, whitespace
// collapsed/trimmed, and length-capped so the insights group cleanly and no
// single pathological query bloats the log.
func normalizeSearchQuery(q string) string {
	q = strings.ToLower(strings.Join(strings.Fields(q), " "))
	if r := []rune(q); len(r) > 200 {
		q = string(r[:200])
	}
	return q
}

// search serves GET /api/search?q= — fuzzy/substring matches over name,
// description, and category labels, resolved to full services via the cache
// (docs/01 §4.6, docs/02 §12). The SPA groups results by category.
func search(c *catalog.Cache, s SearchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusOK, map[string]any{"query": "", "services": []catalog.Service{}})
			return
		}
		ids, err := s.SearchServiceIDs(r.Context(), q)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "search_failed", "Search is temporarily unavailable.")
			return
		}
		snap, err := c.Get(r.Context())
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "catalog_unavailable", "Could not load the catalog.")
			return
		}
		services := make([]catalog.Service, 0, len(ids))
		for _, id := range ids {
			if svc, ok := snap.ServiceByID(uuidString(id)); ok {
				services = append(services, svc)
			}
		}
		// Best-effort log for the zero-result insights (docs/01 §4.6): a failure
		// here must never break or slow the actual search response.
		if err := s.InsertSearchEvent(r.Context(), store.InsertSearchEventParams{
			QueryNorm:   normalizeSearchQuery(q),
			ResultCount: int32(len(services)),
		}); err != nil {
			slog.WarnContext(r.Context(), "search event log failed", "error", err)
		}
		writeJSON(w, http.StatusOK, map[string]any{"query": q, "services": services})
	}
}
