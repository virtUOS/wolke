package service

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/store"
)

// Integration: the announcement singleton, role/window scoping, per-user
// dismissal, delete, and audit. Needs DATABASE_URL.
func TestAnnouncementsSingletonScopingDismissal(t *testing.T) {
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
		t.Fatalf("upsert admin: %v", err)
	}
	reader, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "ann-reader", DisplayName: "Rdr", PrimaryRole: "student", IsAdmin: false})
	if err != nil {
		t.Fatalf("upsert reader: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from announcements where created_by = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub in ('ann-test','ann-reader')")
		db.Close()
	})
	actor := Actor{ID: admin.ID, Kind: ActorForm}

	mk := func(severity, audience string, ends *time.Time) store.Announcement {
		t.Helper()
		a, err := CreateAnnouncement(ctx, db, actor, AnnouncementInput{
			Title: map[string]string{"de": "T", "en": "T"}, Body: map[string]string{"de": "B", "en": "B"},
			Severity: severity, Audience: audience, EndsAt: ends, Dismissible: true,
		})
		if err != nil {
			t.Fatalf("create announcement (%s/%s): %v", severity, audience, err)
		}
		return a
	}
	del := func(id pgtype.UUID) {
		t.Helper()
		if err := DeleteAnnouncement(ctx, db, actor, id); err != nil {
			t.Fatalf("delete announcement: %v", err)
		}
	}
	listAs := func(role string, uid pgtype.UUID) []announce.Announcement {
		t.Helper()
		got, err := announce.ListActive(ctx, db, role, uid)
		if err != nil {
			t.Fatalf("ListActive: %v", err)
		}
		return got
	}

	// Singleton: a second create is rejected while one exists.
	a := mk("info", "all", nil)
	if _, err := CreateAnnouncement(ctx, db, actor, AnnouncementInput{
		Title: map[string]string{"de": "T2", "en": "T2"}, Body: map[string]string{"de": "B2", "en": "B2"}, Severity: "info", Audience: "all",
	}); err == nil {
		t.Error("second create should be rejected (singleton)")
	}
	del(a.ID)

	// Role scoping: a student-only notice is visible to a student, not to staff.
	a = mk("warning", "student", nil)
	if len(listAs("student", reader.ID)) != 1 {
		t.Error("student should see the student-scoped announcement")
	}
	if len(listAs("staff", admin.ID)) != 0 {
		t.Error("staff should not see a student-only announcement")
	}
	del(a.ID)

	// Window: an expired announcement is not active.
	a = mk("info", "all", ptr(time.Now().Add(-time.Hour)))
	if len(listAs("student", reader.ID)) != 0 {
		t.Error("expired announcement should not be active")
	}
	del(a.ID)

	// Dismissal persists per user and does not affect other users.
	a = mk("info", "all", nil)
	if err := DismissAnnouncement(ctx, db, reader.ID, a.ID); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	if len(listAs("student", reader.ID)) != 0 {
		t.Error("dismissed announcement should be hidden for the dismissing user")
	}
	if len(listAs("staff", admin.ID)) != 1 {
		t.Error("a dismissal by one user must not hide it from others")
	}
	// Dismissing again is idempotent.
	if err := DismissAnnouncement(ctx, db, reader.ID, a.ID); err != nil {
		t.Fatalf("dismiss (idempotent): %v", err)
	}
	del(a.ID) // cascade removes the dismissal row

	// Critical / non-dismissible cannot be dismissed.
	a = mk("critical", "all", nil)
	var ve *ValidationError
	if err := DismissAnnouncement(ctx, db, reader.ID, a.ID); !errors.As(err, &ve) {
		t.Errorf("dismissing a critical announcement should fail validation, got %v", err)
	}
	del(a.ID)

	// Delete is audited.
	var n int
	if err := db.Pool.QueryRow(ctx, "select count(*) from audit_log where actor_id=$1 and action='announcement.delete'", admin.ID).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	if n < 1 {
		t.Errorf("announcement.delete audit rows = %d, want >= 1", n)
	}

	// Invalid input is rejected.
	if _, err := CreateAnnouncement(ctx, db, actor, AnnouncementInput{Title: map[string]string{}, Severity: "info", Audience: "all"}); err == nil {
		t.Error("create with empty title should fail validation")
	}
}

func ptr[T any](v T) *T { return &v }
