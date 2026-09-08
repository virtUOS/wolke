package usage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// Integration: rollup aggregates clicks into usage_daily and purges old raw
// events. Needs a seeded DB (DATABASE_URL).
func TestRollupAndPurge(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping rollup integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	u, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "rollup-test", DisplayName: "R", PrimaryRole: "student"})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	// The test owns its service rather than borrowing the catalog's first one.
	// ListActiveServices orders by name, so `svcs[0]` was whichever service
	// happened to sort first *at that moment* — and several integration tests in
	// other packages create a transient service that sorts before the seeded
	// ones ("Admin Test Service", "API Test Service"). `go test ./...` runs those
	// packages in parallel against this same database, so the borrowed id could
	// be hard-deleted by its owner's cleanup between the read above and the
	// insert below, failing this test on click_events' foreign key. Inserted
	// directly: a click rollup needs a service row, not a valid catalog entry
	// (the >= 1 category rule is a service-layer one), and nothing else reads it.
	var sid pgtype.UUID
	// is_active = false so the fixture is invisible to every catalog read while
	// it exists — the rollup aggregates raw click_events and does not filter on
	// it, so this costs the test nothing and keeps the isolation total.
	if err := db.Pool.QueryRow(ctx,
		`insert into services (name, description, service_url, icon, is_active)
		 values ('Rollup Test Service', '{"de":"Rollup.","en":"Rollup."}', 'https://rollup.example.edu', 'server', false)
		 returning id`).Scan(&sid); err != nil {
		t.Fatalf("insert service: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from click_events where user_id=$1", u.ID)
		_, _ = db.Pool.Exec(ctx, "delete from usage_daily where service_id=$1", sid)
		_, _ = db.Pool.Exec(ctx, "delete from services where id=$1", sid)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub='rollup-test'")
		db.Close()
	})

	// Two clicks today (unique role label so we can assert our own rows).
	for i := 0; i < 2; i++ {
		if err := db.RecordClick(ctx, store.RecordClickParams{UserID: u.ID, ServiceID: sid, UserRole: "rollup-role", Target: TargetService}); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	// One old click (100 days ago) — should roll up then be purged.
	old := pgtype.Timestamptz{Time: time.Now().Add(-100 * 24 * time.Hour), Valid: true}
	if _, err := db.Pool.Exec(ctx,
		"insert into click_events (user_id, service_id, user_role, clicked_at) values ($1,$2,'rollup-role',$3)",
		u.ID, sid, old.Time); err != nil {
		t.Fatalf("insert old: %v", err)
	}

	if err := Rollup(ctx, db, 90*24*time.Hour); err != nil {
		t.Fatalf("Rollup: %v", err)
	}

	// usage_daily has today's 2 and the old day's 1.
	var days, totalClicks int64
	if err := db.Pool.QueryRow(ctx,
		"select count(*), coalesce(sum(clicks),0) from usage_daily where service_id=$1 and user_role='rollup-role'", sid).
		Scan(&days, &totalClicks); err != nil {
		t.Fatalf("query usage_daily: %v", err)
	}
	if days != 2 || totalClicks != 3 {
		t.Errorf("usage_daily = %d days / %d clicks, want 2 / 3", days, totalClicks)
	}

	// The 100-day-old raw event was purged; today's remain.
	var remaining int64
	if err := db.Pool.QueryRow(ctx, "select count(*) from click_events where user_id=$1", u.ID).Scan(&remaining); err != nil {
		t.Fatalf("count remaining: %v", err)
	}
	if remaining != 2 {
		t.Errorf("remaining raw clicks = %d, want 2 (old one purged)", remaining)
	}
}
