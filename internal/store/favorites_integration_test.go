package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// Favourites ordered by usage look back over a fixed window, not over whatever
// raw click history happens to be retained (issue #159). A click outside the
// window must not lift a service in the ordering — otherwise the retention
// setting silently decides what "most used" means.
func TestListFavoritesByUsageWindow(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	u, err := db.UpsertUser(ctx, UpsertUserParams{OidcSub: "fav-window-test", DisplayName: "W", PrimaryRole: "student"})
	if err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	// Own, inactive services: this test only needs click_events to have a
	// service to point at, and inactive keeps the fixtures out of every catalog
	// read while the parallel package tests run against the same database.
	newService := func(name string) pgtype.UUID {
		t.Helper()
		var id pgtype.UUID
		if err := db.Pool.QueryRow(ctx,
			`insert into services (name, description, service_url, icon, is_active)
			 values ($1, '{"de":"x","en":"x"}', 'https://example.edu', 'server', false)
			 returning id`, name).Scan(&id); err != nil {
			t.Fatalf("insert service %s: %v", name, err)
		}
		return id
	}
	// `old` is favorited first, so it also wins the sort tiebreaker: if the
	// window were ignored its stale clicks would put it first either way, and
	// the assertion below would not distinguish the two.
	old := newService("Fav Window Old")
	recent := newService("Fav Window Recent")

	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from click_events where user_id=$1", u.ID)
		_, _ = db.Pool.Exec(ctx, "delete from favorites where user_id=$1", u.ID)
		_, _ = db.Pool.Exec(ctx, "delete from usage_daily where service_id = any($1)", []pgtype.UUID{old, recent})
		_, _ = db.Pool.Exec(ctx, "delete from services where id = any($1)", []pgtype.UUID{old, recent})
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub='fav-window-test'")
	})

	for i, id := range []pgtype.UUID{old, recent} {
		if err := db.AddFavorite(ctx, AddFavoriteParams{UserID: u.ID, ServiceID: id, Sort: int32(i)}); err != nil {
			t.Fatalf("add favorite: %v", err)
		}
	}

	click := func(id pgtype.UUID, at time.Time) {
		t.Helper()
		if _, err := db.Pool.Exec(ctx,
			"insert into click_events (user_id, service_id, user_role, target, clicked_at) values ($1,$2,'student','service',$3)",
			u.ID, id, at); err != nil {
			t.Fatalf("insert click: %v", err)
		}
	}
	now := time.Now()
	// Five clicks well outside the window against one inside it.
	for i := 0; i < 5; i++ {
		click(old, now.Add(-40*24*time.Hour))
	}
	click(recent, now.Add(-time.Hour))

	since := pgtype.Timestamptz{Time: now.Add(-30 * 24 * time.Hour), Valid: true}
	ids, err := db.ListFavoritesByUsage(ctx, ListFavoritesByUsageParams{UserID: u.ID, Since: since})
	if err != nil {
		t.Fatalf("ListFavoritesByUsage: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("got %d favorites, want 2", len(ids))
	}
	if ids[0] != recent {
		t.Errorf("first favorite = %v, want the recently clicked one (%v): clicks outside the window still order the list", ids[0], recent)
	}

	// The manual-order seed mirrors the same ranking (issue #125) and has to
	// see the same window, or entering manual mode reintroduces the drift.
	if err := db.SeedManualFavoritesOrder(ctx, SeedManualFavoritesOrderParams{UserID: u.ID, Since: since}); err != nil {
		t.Fatalf("SeedManualFavoritesOrder: %v", err)
	}
	manual, err := db.ListFavoritesManual(ctx, u.ID)
	if err != nil {
		t.Fatalf("ListFavoritesManual: %v", err)
	}
	if len(manual) != 2 || manual[0] != recent {
		t.Errorf("manual seed order = %v, want the recently clicked one (%v) first", manual, recent)
	}
}
