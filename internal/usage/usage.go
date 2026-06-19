// Package usage ingests launch-click events and derives "frequently used"
// (docs/01 §4.5, §5.4). Aggregate rollups and Prometheus counters come in
// Phase 4; this is the per-user ingestion and read path.
package usage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// Defaults for the "frequently used" view.
const (
	FrequentWindow = 30 * 24 * time.Hour
	FrequentLimit  = 8
)

// Click targets recorded with each event: which link the user followed.
const (
	TargetService       = "service"       // the launch link (a service tile or a doc-only tile)
	TargetDocumentation = "documentation" // the secondary "Doku" link on a service
)

// Store is the persistence the usage path needs.
type Store interface {
	RecordClick(ctx context.Context, arg store.RecordClickParams) error
	FrequentServiceIDs(ctx context.Context, arg store.FrequentServiceIDsParams) ([]pgtype.UUID, error)
}

// Record appends a click event for the user/service/role. target is the link
// followed (TargetService or TargetDocumentation); an empty value defaults to a
// launch so older callers stay correct.
func Record(ctx context.Context, db Store, userID, serviceID pgtype.UUID, role, target string) error {
	if target == "" {
		target = TargetService
	}
	if err := db.RecordClick(ctx, store.RecordClickParams{UserID: userID, ServiceID: serviceID, UserRole: role, Target: target}); err != nil {
		return fmt.Errorf("record click: %w", err)
	}
	return nil
}

// RollupStore is the persistence the rollup job needs.
type RollupStore interface {
	RollupClicks(ctx context.Context) error
	PurgeOldClicks(ctx context.Context, cutoff pgtype.Timestamptz) (int64, error)
}

// Rollup aggregates raw click events into usage_daily, then purges raw events
// older than the retention window (docs/01 §8.9, docs/04 maintenance). Aggregate
// history is recomputed only for days whose raw events still exist, so purged
// days stay frozen at their last value.
func Rollup(ctx context.Context, db RollupStore, retention time.Duration) error {
	if err := db.RollupClicks(ctx); err != nil {
		return fmt.Errorf("rollup clicks: %w", err)
	}
	cutoff := pgtype.Timestamptz{Time: time.Now().Add(-retention), Valid: true}
	if _, err := db.PurgeOldClicks(ctx, cutoff); err != nil {
		return fmt.Errorf("purge old clicks: %w", err)
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
