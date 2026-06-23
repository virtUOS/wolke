package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

func validAnnouncement() AnnouncementInput {
	return AnnouncementInput{
		Title:    map[string]string{"de": "Wartung", "en": "Maintenance"},
		Body:     map[string]string{"de": "Heute Abend.", "en": "Tonight."},
		Severity: "warning",
		Audience: "all",
	}
}

func TestValidateAnnouncement(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	tests := []struct {
		name   string
		mutate func(*AnnouncementInput)
		field  string
	}{
		{"valid", func(*AnnouncementInput) {}, ""},
		{"missing de title", func(in *AnnouncementInput) { in.Title = map[string]string{} }, "title"},
		{"missing de body", func(in *AnnouncementInput) { in.Body = map[string]string{} }, "body"},
		{"bad severity", func(in *AnnouncementInput) { in.Severity = "urgent" }, "severity"},
		{"bad audience", func(in *AnnouncementInput) { in.Audience = "faculty" }, "audience"},
		{"ends before starts", func(in *AnnouncementInput) { in.StartsAt = &future; in.EndsAt = &past }, "ends_at"},
		{"valid window", func(in *AnnouncementInput) { in.StartsAt = &past; in.EndsAt = &future }, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validAnnouncement()
			tt.mutate(&in)
			err := validateAnnouncement(in)
			if tt.field == "" {
				if err != nil {
					t.Fatalf("want valid, got %v", err)
				}
				return
			}
			var ve *ValidationError
			if !errors.As(err, &ve) || ve.Field != tt.field {
				t.Fatalf("err = %v, want ValidationError on %q", err, tt.field)
			}
		})
	}
}

type fakeDismiss struct {
	ann       store.Announcement
	getErr    error
	dismissed *store.DismissAnnouncementParams
}

func (f *fakeDismiss) GetAnnouncementByID(_ context.Context, _ pgtype.UUID) (store.Announcement, error) {
	return f.ann, f.getErr
}

func (f *fakeDismiss) DismissAnnouncement(_ context.Context, arg store.DismissAnnouncementParams) error {
	f.dismissed = &arg
	return nil
}

func TestDismissAnnouncement(t *testing.T) {
	ctx := context.Background()
	uid := pgtype.UUID{Valid: true}
	aid := pgtype.UUID{Valid: true}

	t.Run("records a dismissible info announcement", func(t *testing.T) {
		f := &fakeDismiss{ann: store.Announcement{Severity: "info", Dismissible: true}}
		if err := DismissAnnouncement(ctx, f, uid, aid); err != nil {
			t.Fatalf("DismissAnnouncement: %v", err)
		}
		if f.dismissed == nil {
			t.Fatal("expected a dismissal to be written")
		}
	})

	t.Run("rejects a critical announcement", func(t *testing.T) {
		f := &fakeDismiss{ann: store.Announcement{Severity: "critical", Dismissible: true}}
		var ve *ValidationError
		if err := DismissAnnouncement(ctx, f, uid, aid); !errors.As(err, &ve) {
			t.Fatalf("err = %v, want ValidationError", err)
		}
		if f.dismissed != nil {
			t.Error("must not write a dismissal for a critical announcement")
		}
	})

	t.Run("rejects a non-dismissible announcement", func(t *testing.T) {
		f := &fakeDismiss{ann: store.Announcement{Severity: "info", Dismissible: false}}
		var ve *ValidationError
		if err := DismissAnnouncement(ctx, f, uid, aid); !errors.As(err, &ve) {
			t.Fatalf("err = %v, want ValidationError", err)
		}
	})

	t.Run("missing announcement is a not-found", func(t *testing.T) {
		f := &fakeDismiss{getErr: pgx.ErrNoRows}
		var nf *NotFoundError
		if err := DismissAnnouncement(ctx, f, uid, aid); !errors.As(err, &nf) {
			t.Fatalf("err = %v, want NotFoundError", err)
		}
	})
}
