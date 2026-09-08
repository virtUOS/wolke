package service

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/virtuos/wolke/internal/config"
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
		// Visibility: "" is public; otherwise it must be a configured slug.
		{"public visibility is valid", func(in *Draft) { in.Visibility = "" }, ""},
		{"a configured visibility slug is valid", func(in *Draft) { in.Visibility = "experimental" }, ""},
		{"an unconfigured visibility slug is rejected", func(in *Draft) { in.Visibility = "it-infra" }, "visibility"},
	}
	vis := (&config.Config{VisibilityEntries: []config.VisibilityEntry{{
		Slug: "experimental", Grant: config.GrantOptIn,
		Warning: map[string]string{"de": "Kann verschwinden."},
	}}}).Visibility()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validInput()
			tt.mutate(&in)
			err := validateServiceInput(vis, in)
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

// With no visibility configured at all, any non-empty slug is refused: the
// admin form and the MCP propose path cannot restrict a service to a group
// that does not exist.
func TestVisibilityRejectedWhenNoneConfigured(t *testing.T) {
	in := validInput()
	in.Visibility = "experimental"
	var ve *ValidationError
	if err := validateServiceInput(config.VisibilitySet{}, in); !errors.As(err, &ve) || ve.Field != "visibility" {
		t.Fatalf("err = %v, want a visibility ValidationError", err)
	}
}

// --- categories (issue #130) ---

func TestValidateCategoryInput(t *testing.T) {
	validLabel := map[string]string{"de": "Forschung", "en": "Research"}
	tests := []struct {
		name  string
		slug  string
		label map[string]string
		field string // "" => expect valid
	}{
		{"valid", "forschung", validLabel, ""},
		{"valid with digits and hyphens", "ai-tools-2", validLabel, ""},
		{"surrounding whitespace is trimmed, not rejected", "  forschung  ", validLabel, ""},
		{"empty", "   ", validLabel, "slug"},
		{"spaces and punctuation", "Foo Bar!!", validLabel, "slug"},
		{"uppercase", "Forschung", validLabel, "slug"},
		{"underscore", "ai_tools", validLabel, "slug"},
		{"leading hyphen", "-tools", validLabel, "slug"},
		{"trailing hyphen", "tools-", validLabel, "slug"},
		{"double hyphen", "ai--tools", validLabel, "slug"},
		{"missing de label", "forschung", map[string]string{"en": "Research"}, "label"},
		{"blank de label", "forschung", map[string]string{"de": "  ", "en": "Research"}, "label"},
		{"missing en label", "forschung", map[string]string{"de": "Forschung"}, "label"},
		{"blank en label", "forschung", map[string]string{"de": "Forschung", "en": " "}, "label"},
		{"nil label", "forschung", nil, "label"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			slug, err := validateCategoryInput(tt.slug, tt.label)
			if tt.field == "" {
				if err != nil {
					t.Fatalf("want valid, got %v", err)
				}
				if slug != strings.TrimSpace(tt.slug) {
					t.Errorf("slug = %q, want the trimmed input %q", slug, strings.TrimSpace(tt.slug))
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

// The reorder write is a permutation of exactly the existing slugs — the same
// contract as PUT /api/favorites/order, so a client that is out of sync is
// rejected rather than having its partial list silently renumber the rest.
func TestCheckCategoryPermutation(t *testing.T) {
	current := []string{"learning", "teaching", "data"}
	tests := []struct {
		name string
		want []string
		ok   bool
	}{
		{"same order is valid (idempotent)", []string{"learning", "teaching", "data"}, true},
		{"a real permutation", []string{"data", "learning", "teaching"}, true},
		{"a duplicate", []string{"data", "data", "learning"}, false},
		{"one missing", []string{"data", "learning"}, false},
		{"one extra", []string{"data", "learning", "teaching", "support"}, false},
		{"an unknown slug swapped in", []string{"data", "learning", "support"}, false},
		{"empty while categories exist", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := checkCategoryPermutation(current, tt.want)
			if tt.ok {
				if err != nil {
					t.Fatalf("want valid, got %v", err)
				}
				return
			}
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("err = %v, want ValidationError", err)
			}
			if ve.Field != "slugs" {
				t.Errorf("field = %q, want %q", ve.Field, "slugs")
			}
		})
	}
}

// The refusal has to tell the admin what to reassign, not just that something
// blocks (issue #130 §2.3).
func TestCategoryInUseMessage(t *testing.T) {
	tests := []struct {
		name  string
		n     int64
		names []string
		want  string
	}{
		{"one", 1, []string{"MyShare"}, "1 service still uses this category: MyShare. Reassign it first."},
		{
			"a few, all named", 3, []string{"BigBlueButton", "Stud.IP", "Webmail"},
			"3 services still use this category: BigBlueButton, Stud.IP, Webmail. Reassign them first.",
		},
		{
			"more than the sample", 6, []string{"BigBlueButton", "Stud.IP", "VPN", "Webmail"},
			"6 services still use this category: BigBlueButton, Stud.IP, VPN, Webmail and 2 more. Reassign them first.",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := categoryInUseMessage(tt.n, tt.names); got != tt.want {
				t.Errorf("categoryInUseMessage(%d, %q) =\n  %q\nwant\n  %q", tt.n, tt.names, got, tt.want)
			}
		})
	}
}
