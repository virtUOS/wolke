package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/service"
)

// userAnnouncements serves the active announcements scoped to the current user's
// role (docs/01 §4.7, docs/02 §12).
func userAnnouncements(db announce.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, _ := userFromContext(r.Context())
		list, err := announce.ListActive(r.Context(), db, user.PrimaryRole)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "announcements_unavailable", "Could not load announcements.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"announcements": list})
	}
}

// announcementBody is the create/edit request shape; times are RFC3339 or null.
type announcementBody struct {
	Title       map[string]string `json:"title"`
	Body        map[string]string `json:"body"`
	Severity    string            `json:"severity"`
	Audience    string            `json:"audience"`
	StartsAt    *string           `json:"starts_at"`
	EndsAt      *string           `json:"ends_at"`
	Dismissible bool              `json:"dismissible"`
}

func (b announcementBody) input() (service.AnnouncementInput, error) {
	starts, err := parseTimePtr(b.StartsAt)
	if err != nil {
		return service.AnnouncementInput{}, err
	}
	ends, err := parseTimePtr(b.EndsAt)
	if err != nil {
		return service.AnnouncementInput{}, err
	}
	audience := b.Audience
	if audience == "" {
		audience = "all"
	}
	return service.AnnouncementInput{
		Title:       b.Title,
		Body:        b.Body,
		Severity:    b.Severity,
		Audience:    audience,
		StartsAt:    starts,
		EndsAt:      ends,
		Dismissible: b.Dismissible,
	}, nil
}

func parseTimePtr(s *string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func adminListAnnouncements(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := announce.AdminList(r.Context(), d.Store, 100)
		if err != nil {
			writeProblem(w, http.StatusInternalServerError, "announcements_unavailable", "Could not load announcements.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"announcements": list})
	}
}

func adminCreateAnnouncement(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b announcementBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		in, err := b.input()
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_time", "Timestamps must be RFC3339.")
			return
		}
		a, err := service.CreateAnnouncement(r.Context(), d.Store, actorFromContext(r.Context()), in)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, announce.View(a))
	}
}

func adminUpdateAnnouncement(d AdminDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := parseUUID(chi.URLParam(r, "id"))
		if !ok {
			writeProblem(w, http.StatusBadRequest, "invalid_id", "Invalid announcement id.")
			return
		}
		var b announcementBody
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_body", "Request body must be JSON.")
			return
		}
		in, err := b.input()
		if err != nil {
			writeProblem(w, http.StatusBadRequest, "invalid_time", "Timestamps must be RFC3339.")
			return
		}
		a, err := service.UpdateAnnouncement(r.Context(), d.Store, actorFromContext(r.Context()), id, in)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, announce.View(a))
	}
}
