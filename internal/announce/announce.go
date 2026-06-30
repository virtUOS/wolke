// Package announce holds the announcement read model and active-window/role
// scoping (docs/01 §4.7). Admin writes live in internal/service (they need the
// shared audit/validation machinery).
package announce

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/virtuos/wolke/internal/store"
)

// Announcement is the API/read model of an announcement.
type Announcement struct {
	ID          string            `json:"id"`
	Title       map[string]string `json:"title"`
	Body        map[string]string `json:"body"`
	Severity    string            `json:"severity"`
	Audience    string            `json:"audience"`
	StartsAt    string            `json:"starts_at,omitempty"` // RFC3339, empty if unset
	EndsAt      string            `json:"ends_at,omitempty"`
	Dismissible bool              `json:"dismissible"`
	CreatedAt   string            `json:"created_at,omitempty"` // RFC3339; when the notice was posted
}

// Store is the read surface the announce package needs.
type Store interface {
	ListActiveAnnouncements(ctx context.Context, arg store.ListActiveAnnouncementsParams) ([]store.Announcement, error)
	ListAllActiveAnnouncements(ctx context.Context) ([]store.Announcement, error)
	AdminListAnnouncements(ctx context.Context, lim int32) ([]store.Announcement, error)
	ListAnnouncementHistory(ctx context.Context, arg store.ListAnnouncementHistoryParams) ([]store.Announcement, error)
}

// PurgeStore is the write surface the retention sweep needs.
type PurgeStore interface {
	PurgeAnnouncementsBefore(ctx context.Context, cutoff pgtype.Timestamptz) (int64, error)
}

// historyLimit caps the notification-center history so the panel stays bounded.
// The retention sweep keeps the table small, so this is generous headroom.
const historyLimit = 100

// ListActive returns announcements currently in-window, addressed to the role,
// and not already dismissed by the user.
func ListActive(ctx context.Context, db Store, role string, userID pgtype.UUID) ([]Announcement, error) {
	rows, err := db.ListActiveAnnouncements(ctx, store.ListActiveAnnouncementsParams{Role: role, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("list active announcements: %w", err)
	}
	return views(rows), nil
}

// ListAllActive returns every in-window announcement regardless of audience, for
// the public catalog MCP server, which has no user role to filter on.
func ListAllActive(ctx context.Context, db Store) ([]Announcement, error) {
	rows, err := db.ListAllActiveAnnouncements(ctx)
	if err != nil {
		return nil, fmt.Errorf("list all active announcements: %w", err)
	}
	return views(rows), nil
}

// ListHistory returns a user's past notices for the notification center:
// addressed to their role, already started, and no longer an active banner for
// them (expired or dismissed). Most recent first.
func ListHistory(ctx context.Context, db Store, role string, userID pgtype.UUID) ([]Announcement, error) {
	rows, err := db.ListAnnouncementHistory(ctx, store.ListAnnouncementHistoryParams{Role: role, UserID: userID, Lim: historyLimit})
	if err != nil {
		return nil, fmt.Errorf("list announcement history: %w", err)
	}
	return views(rows), nil
}

// Purge permanently deletes expired announcements older than the retention
// cutoff (their dismissals cascade away). Returns the number of rows removed.
func Purge(ctx context.Context, db PurgeStore, cutoff time.Time) (int64, error) {
	n, err := db.PurgeAnnouncementsBefore(ctx, pgtype.Timestamptz{Time: cutoff, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("purge announcements: %w", err)
	}
	return n, nil
}

// AdminList returns the most recent announcements (all states), for management.
func AdminList(ctx context.Context, db Store, limit int32) ([]Announcement, error) {
	rows, err := db.AdminListAnnouncements(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("list announcements: %w", err)
	}
	return views(rows), nil
}

func views(rows []store.Announcement) []Announcement {
	out := make([]Announcement, 0, len(rows))
	for _, a := range rows {
		out = append(out, View(a))
	}
	return out
}

// View maps a stored announcement to the API model.
func View(a store.Announcement) Announcement {
	return Announcement{
		ID:          uuidStr(a.ID),
		Title:       jsonMap(a.Title),
		Body:        jsonMap(a.Body),
		Severity:    a.Severity,
		Audience:    a.Audience,
		StartsAt:    tsString(a.StartsAt),
		EndsAt:      tsString(a.EndsAt),
		Dismissible: a.Dismissible,
		CreatedAt:   tsString(a.CreatedAt),
	}
}

func jsonMap(b []byte) map[string]string {
	m := map[string]string{}
	_ = json.Unmarshal(b, &m)
	return m
}

func tsString(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339)
}

func uuidStr(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
