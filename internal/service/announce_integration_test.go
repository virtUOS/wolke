package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/store"
)

// Integration: announcement create + role/window scoping + audit. Needs DATABASE_URL.
func TestAnnouncementsScopingAndAudit(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping announcements integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "ann-test", DisplayName: "Ann", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from announcements where created_by = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'ann-test'")
		db.Close()
	})
	actor := Actor{ID: admin.ID, Kind: ActorForm}
	past := time.Now().Add(-2 * time.Hour)
	expired := time.Now().Add(-time.Hour)

	mk := func(severity, audience string, ends *time.Time) {
		_, err := CreateAnnouncement(ctx, db, actor, AnnouncementInput{
			Title: map[string]string{"de": "T"}, Body: map[string]string{"de": "B"},
			Severity: severity, Audience: audience, EndsAt: ends,
		})
		if err != nil {
			t.Fatalf("create announcement: %v", err)
		}
	}
	mk("info", "all", nil)          // visible to everyone
	mk("warning", "student", nil)   // students only
	mk("info", "staff", nil)        // staff only
	mk("critical", "all", &expired) // expired → not active
	_ = past

	// A student sees the 'all' + 'student' active ones, not 'staff' or expired.
	got, err := announce.ListActive(ctx, db, "student")
	if err != nil {
		t.Fatalf("ListActive: %v", err)
	}
	// Count only the ones created by this test (the DB may hold others).
	audiences := map[string]int{}
	for _, a := range got {
		audiences[a.Audience]++
	}
	if audiences["staff"] != 0 {
		t.Errorf("student should not see staff-only announcements")
	}
	if audiences["student"] < 1 {
		t.Errorf("student should see the student-scoped announcement")
	}
	// The expired critical (audience all) must be absent.
	for _, a := range got {
		if a.Severity == "critical" {
			t.Errorf("expired announcement should not be active")
		}
	}

	// Each create was audited.
	var n int
	if err := db.Pool.QueryRow(ctx, "select count(*) from audit_log where actor_id=$1 and action='announcement.create'", admin.ID).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	if n != 4 {
		t.Errorf("announcement.create audit rows = %d, want 4", n)
	}

	// Invalid input is rejected.
	if _, err := CreateAnnouncement(ctx, db, actor, AnnouncementInput{Title: map[string]string{}, Severity: "info", Audience: "all"}); err == nil {
		t.Error("create with empty title should fail validation")
	}
}
