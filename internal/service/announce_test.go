package service

import (
	"errors"
	"testing"
	"time"
)

func validAnnouncement() AnnouncementInput {
	return AnnouncementInput{
		Title:    map[string]string{"de": "Wartung"},
		Body:     map[string]string{"de": "Heute Abend."},
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
