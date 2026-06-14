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

	"github.com/virtUOS/service-hub/internal/store"
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
}

// Store is the read surface the announce package needs.
type Store interface {
	ListActiveAnnouncements(ctx context.Context, role string) ([]store.Announcement, error)
	AdminListAnnouncements(ctx context.Context, lim int32) ([]store.Announcement, error)
}

// ListActive returns announcements currently in-window and addressed to the role.
func ListActive(ctx context.Context, db Store, role string) ([]Announcement, error) {
	rows, err := db.ListActiveAnnouncements(ctx, role)
	if err != nil {
		return nil, fmt.Errorf("list active announcements: %w", err)
	}
	return views(rows), nil
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
