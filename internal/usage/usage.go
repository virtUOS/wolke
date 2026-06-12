// Package usage ingests launch-click events and derives "frequently used"
// (docs/01 §4.5, §5.4). Aggregate rollups and Prometheus counters come in
// Phase 4; this is the per-user ingestion and read path.
package usage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtUOS/service-hub/internal/store"
)

// Defaults for the "frequently used" view.
const (
	FrequentWindow = 30 * 24 * time.Hour
	FrequentLimit  = 8
)

// Store is the persistence the usage path needs.
type Store interface {
	RecordClick(ctx context.Context, arg store.RecordClickParams) error
	FrequentServiceIDs(ctx context.Context, arg store.FrequentServiceIDsParams) ([]pgtype.UUID, error)
}

// Record appends a launch-click event for the user/service/role.
func Record(ctx context.Context, db Store, userID, serviceID pgtype.UUID, role string) error {
	if err := db.RecordClick(ctx, store.RecordClickParams{UserID: userID, ServiceID: serviceID, UserRole: role}); err != nil {
		return fmt.Errorf("record click: %w", err)
	}
	return nil
}

// Frequent returns the user's most-used active service ids since `since`. The
// caller resolves them to full services via the catalog cache.
func Frequent(ctx context.Context, db Store, userID pgtype.UUID, since time.Time, limit int) ([]pgtype.UUID, error) {
	ids, err := db.FrequentServiceIDs(ctx, store.FrequentServiceIDsParams{
		UserID: userID,
		Since:  pgtype.Timestamptz{Time: since, Valid: true},
		Lim:    int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("frequent services: %w", err)
	}
	return ids, nil
}
