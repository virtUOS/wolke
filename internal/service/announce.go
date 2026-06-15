package service

import (
	"context"
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
	if in.Body["de"] == "" {
		return &ValidationError{Field: "body", Msg: "German body (de) is required"}
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
func CreateAnnouncement(ctx context.Context, db AdminDB, actor Actor, in AnnouncementInput) (store.Announcement, error) {
	if err := validateAnnouncement(in); err != nil {
		return store.Announcement{}, err
	}
	var out store.Announcement
	err := inTx(ctx, db, func(q *store.Queries) error {
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

func pgTimestamp(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
