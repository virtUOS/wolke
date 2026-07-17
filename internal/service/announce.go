package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// AnnouncementInput is the validated shape for creating/editing an announcement.
type AnnouncementInput struct {
	Title       map[string]string
	Body        map[string]string
	Severity    string
	Audience    string
	StartsAt    *time.Time
	EndsAt      *time.Time
	Dismissible bool
}

var (
	validSeverities = map[string]bool{"info": true, "warning": true, "critical": true}
	validAudiences  = map[string]bool{"all": true, "student": true, "teacher": true, "staff": true}
)

func validateAnnouncement(in AnnouncementInput) error {
	if in.Title["de"] == "" {
		return &ValidationError{Field: "title", Msg: "German title (de) is required"}
	}
	if in.Title["en"] == "" {
		return &ValidationError{Field: "title", Msg: "English title (en) is required"}
	}
	if in.Body["de"] == "" {
		return &ValidationError{Field: "body", Msg: "German body (de) is required"}
	}
	if in.Body["en"] == "" {
		return &ValidationError{Field: "body", Msg: "English body (en) is required"}
	}
	if !validSeverities[in.Severity] {
		return &ValidationError{Field: "severity", Msg: "must be one of info, warning, critical"}
	}
	if !validAudiences[in.Audience] {
		return &ValidationError{Field: "audience", Msg: "must be one of all, student, teacher, staff"}
	}
	if in.StartsAt != nil && in.EndsAt != nil && !in.EndsAt.After(*in.StartsAt) {
		return &ValidationError{Field: "ends_at", Msg: "must be after starts_at"}
	}
	return nil
}

// CreateAnnouncement validates, inserts, and audit-logs a new announcement.
// There is at most one ACTIVE announcement at a time (docs/01 §4.7): creating a
// new one first retires any currently-active notice (its window is ended now),
// leaving it in the table as history rather than destroying it. The retire +
// insert run in one tx so the invariant holds atomically.
func CreateAnnouncement(ctx context.Context, db AdminDB, actor Actor, in AnnouncementInput) (store.Announcement, error) {
	if err := validateAnnouncement(in); err != nil {
		return store.Announcement{}, err
	}
	var out store.Announcement
	err := inTx(ctx, db, func(q *store.Queries) error {
		if err := q.RetireActiveAnnouncements(ctx); err != nil {
			return fmt.Errorf("retire active announcements: %w", err)
		}
		a, err := q.CreateAnnouncement(ctx, store.CreateAnnouncementParams{
			Title:       mustJSON(in.Title),
			Body:        mustJSON(in.Body),
			Severity:    in.Severity,
			Audience:    in.Audience,
			StartsAt:    pgTimestamp(in.StartsAt),
			EndsAt:      pgTimestamp(in.EndsAt),
			Dismissible: in.Dismissible,
			CreatedBy:   actor.ID,
		})
		if err != nil {
			return fmt.Errorf("create announcement: %w", err)
		}
		out = a
		return audit(ctx, q, actor, "announcement.create", a.ID, map[string]any{"after": in})
	})
	return out, err
}

// UpdateAnnouncement validates and replaces an announcement (edit or expire),
// auditing the change.
func UpdateAnnouncement(ctx context.Context, db AdminDB, actor Actor, id pgtype.UUID, in AnnouncementInput) (store.Announcement, error) {
	if err := validateAnnouncement(in); err != nil {
		return store.Announcement{}, err
	}
	var out store.Announcement
	err := inTx(ctx, db, func(q *store.Queries) error {
		if _, err := q.GetAnnouncementByID(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			return &NotFoundError{What: "announcement"}
		} else if err != nil {
			return err
		}
		a, err := q.UpdateAnnouncement(ctx, store.UpdateAnnouncementParams{
			ID:          id,
			Title:       mustJSON(in.Title),
			Body:        mustJSON(in.Body),
			Severity:    in.Severity,
			Audience:    in.Audience,
			StartsAt:    pgTimestamp(in.StartsAt),
			EndsAt:      pgTimestamp(in.EndsAt),
			Dismissible: in.Dismissible,
		})
		if err != nil {
			return fmt.Errorf("update announcement: %w", err)
		}
		out = a
		return audit(ctx, q, actor, "announcement.update", id, map[string]any{"after": in})
	})
	return out, err
}

// DeleteAnnouncement removes the announcement (singleton) and audits it. Per-user
// dismissals cascade away with the row.
func DeleteAnnouncement(ctx context.Context, db AdminDB, actor Actor, id pgtype.UUID) error {
	return inTx(ctx, db, func(q *store.Queries) error {
		before, err := q.GetAnnouncementByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return &NotFoundError{What: "announcement"}
		} else if err != nil {
			return err
		}
		n, err := q.DeleteAnnouncement(ctx, id)
		if err != nil {
			return fmt.Errorf("delete announcement: %w", err)
		}
		if n == 0 {
			return &NotFoundError{What: "announcement"}
		}
		diff := map[string]any{"before": map[string]any{
			"title": json.RawMessage(before.Title), "severity": before.Severity, "audience": before.Audience,
		}}
		return audit(ctx, q, actor, "announcement.delete", id, diff)
	})
}

// DismissStore is the persistence the dismiss use case needs.
type DismissStore interface {
	GetAnnouncementByID(ctx context.Context, id pgtype.UUID) (store.Announcement, error)
	DismissAnnouncement(ctx context.Context, arg store.DismissAnnouncementParams) error
}

// DismissAnnouncement records a per-user dismissal so the banner stays gone
// across reloads. Non-dismissible and critical notices cannot be dismissed
// (defense-in-depth; the UI also hides their close button). Idempotent.
func DismissAnnouncement(ctx context.Context, db DismissStore, userID, announcementID pgtype.UUID) error {
	a, err := db.GetAnnouncementByID(ctx, announcementID)
	if errors.Is(err, pgx.ErrNoRows) {
		return &NotFoundError{What: "announcement"}
	} else if err != nil {
		return fmt.Errorf("get announcement: %w", err)
	}
	if !a.Dismissible || a.Severity == "critical" {
		return &ValidationError{Field: "dismiss", Msg: "this announcement cannot be dismissed"}
	}
	if err := db.DismissAnnouncement(ctx, store.DismissAnnouncementParams{UserID: userID, AnnouncementID: announcementID}); err != nil {
		return fmt.Errorf("dismiss announcement: %w", err)
	}
	return nil
}

func pgTimestamp(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
