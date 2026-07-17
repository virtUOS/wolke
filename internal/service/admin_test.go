package service

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func validInput() Draft {
	return Draft{
		Name:        "MyShare",
		Description: map[string]string{"de": "Netzspeicher.", "en": "Network storage."},
		ServiceURL:  "https://myshare.example.edu",
		Icon:        "hard-drive",
		Categories:  []string{"data"},
	}
}

func TestValidateDraft(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Draft)
		field  string // "" => expect valid
	}{
		{"valid", func(*Draft) {}, ""},
		{"empty name", func(in *Draft) { in.Name = "  " }, "name"},
		{"missing de description", func(in *Draft) { in.Description = map[string]string{"en": "x"} }, "description"},
		{"missing en description", func(in *Draft) { in.Description = map[string]string{"de": "x"} }, "description"},
		{"bad icon", func(in *Draft) { in.Icon = "Bad Icon!" }, "icon"},
		{"no urls", func(in *Draft) { in.ServiceURL = ""; in.DocURL = "" }, "service_url"},
		{"bad service url", func(in *Draft) { in.ServiceURL = "javascript:alert(1)" }, "service_url"},
		{"bad doc url", func(in *Draft) { in.DocURL = "ftp://x" }, "doc_url"},
		{"no categories", func(in *Draft) { in.Categories = nil }, "categories"},
		{"doc-only is valid", func(in *Draft) { in.ServiceURL = ""; in.DocURL = "https://docs.example.edu/x" }, ""},
		{"keywords are optional", func(in *Draft) { in.Keywords = nil }, ""},
		{"a few keywords are valid", func(in *Draft) { in.Keywords = []string{"videokonferenz", "video conference"} }, ""},
		{"too many keywords", func(in *Draft) {
			in.Keywords = make([]string, maxKeywords+1)
			for i := range in.Keywords {
				in.Keywords[i] = "kw" + string(rune('a'+i))
			}
		}, "keywords"},
		{"keyword too long", func(in *Draft) { in.Keywords = []string{strings.Repeat("x", maxKeywordLength+1)} }, "keywords"},
		// Duplicates/blank/whitespace collapse before the count check, so this is valid.
		{"duplicate keywords collapse", func(in *Draft) { in.Keywords = []string{"bbb", "BBB", " bbb ", ""} }, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validInput()
			tt.mutate(&in)
			err := validateServiceInput(in)
			if tt.field == "" {
				if err != nil {
					t.Fatalf("want valid, got %v", err)
				}
				return
			}
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want ValidationError", err)
			}
			if ve.Field != tt.field {
				t.Errorf("field = %q, want %q", ve.Field, tt.field)
			}
		})
	}
}

func TestNormalizeKeywords(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want []string
	}{
		{"nil", nil, []string{}},
		{"trims and drops blanks", []string{"  bbb ", "", "   "}, []string{"bbb"}},
		{"dedupes case-insensitively, keeps first casing/order", []string{"Zoom", "video conference", "zoom", "VIDEO CONFERENCE"}, []string{"Zoom", "video conference"}},
		{"keeps multi-word phrases intact", []string{"online meeting"}, []string{"online meeting"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeKeywords(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("normalizeKeywords(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestValidHTTPURL(t *testing.T) {
	ok := []string{"https://a.example.edu", "http://localhost:8080/x?y=1"}
	bad := []string{"", "ftp://a", "javascript:alert(1)", "/relative", "https://"}
	for _, u := range ok {
		if !validHTTPURL(u) {
			t.Errorf("validHTTPURL(%q) = false, want true", u)
		}
	}
	for _, u := range bad {
		if validHTTPURL(u) {
			t.Errorf("validHTTPURL(%q) = true, want false", u)
		}
	}
}
