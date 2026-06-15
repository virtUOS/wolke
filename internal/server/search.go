package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/catalog"
)

// SearchStore is the search capability: active service ids matching a query,
// ranked. Categories are attached from the cache so results match /api/catalog.
type SearchStore interface {
	SearchServiceIDs(ctx context.Context, q pgtype.Text) ([]pgtype.UUID, error)
}

// search serves GET /api/search?q= — fuzzy/substring matches over name,
// description, and category labels, resolved to full services via the cache
// (docs/01 §4.6, docs/02 §12). The SPA groups results by category.
func search(c *catalog.Cache, store SearchStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, http.StatusOK, map[string]any{"query": "", "services": []catalog.Service{}})
			return
		}
		ids, err := store.SearchServiceIDs(r.Context(), pgtype.Text{String: q, Valid: true})
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
		writeJSON(w, http.StatusOK, map[string]any{"query": q, "services": services})
	}
}
