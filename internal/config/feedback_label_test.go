package config

import "testing"

// Issue #222: the footer's feedback link already has a configurable target
// (`feedback_url`); this makes its *label* configurable too, so a deployment
// pointing it at a ticket system or a help desk is not stuck calling it
// "Feedback".
//
// The label is localized — `{de, en}` — like every other user-facing string in
// the product (CLAUDE.md's i18n rule). It is the first localized field in the
// *branding* block, but not the first in config: `oidc.role.labels` and the
// `visibility` entries' `label` already carry the same shape, so the type here
// is the established `map[string]string` rather than anything new.
//
// The default is a no-op. An unconfigured deployment must render exactly what
// it renders today, which on the SPA side means "empty falls through to the
// built-in string" — see web-ui/src/__tests__/feedback-label.test.tsx for the
// three-row fallback table. Go's job is only to carry the value faithfully.

func TestFeedbackLabelDefaultsEmpty(t *testing.T) {
	label := Defaults().Branding.FeedbackLabel
	if len(label) != 0 {
		t.Errorf("feedback_label = %v, want empty by default (the built-in label wins)", label)
	}
	// Empty, but not nil: the field is served as an object so the SPA can read
	// it without a null check, the same reason `fonts` and `theme` are maps.
	if label == nil {
		t.Error("feedback_label is nil, want an empty map so /api/branding serves {} rather than null")
	}
}

func TestFeedbackLabelFromFile(t *testing.T) {
	path := writeTemp(t, `
public_url: https://hub.example.edu
branding:
  feedback_label:
    de: Kontakt
    en: Contact
`)
	cfg, err := load(path, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.Branding.FeedbackLabel["de"]; got != "Kontakt" {
		t.Errorf("feedback_label.de = %q, want Kontakt", got)
	}
	if got := cfg.Branding.FeedbackLabel["en"]; got != "Contact" {
		t.Errorf("feedback_label.en = %q, want Contact", got)
	}
}

// One language is a legitimate configuration: a deployment that renamed the
// link in German and has not translated it. The value is carried as written —
// the SPA's localized() then serves the German string to an English reader,
// which is the documented behaviour (issue #222's decision table, row 2). What
// must NOT happen is Go filling in the missing language, which would make that
// row indistinguishable from a full translation.
func TestFeedbackLabelKeepsAPartialTranslationPartial(t *testing.T) {
	path := writeTemp(t, `
public_url: https://hub.example.edu
branding:
  feedback_label:
    de: Kontakt
`)
	cfg, err := load(path, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if _, ok := cfg.Branding.FeedbackLabel["en"]; ok {
		t.Errorf("feedback_label = %v, want no en key — filling the gap here would hide the fallback",
			cfg.Branding.FeedbackLabel)
	}
}

// A blank translation means "not translated", not "render this language the
// built-in label while the other one is renamed". Dropping it at load keeps
// the SPA's test a plain emptiness check and makes `en: ""` behave exactly like
// a missing `en`. Surrounding whitespace goes the same way — a label is a
// display string, and nobody types a leading space on purpose.
func TestFeedbackLabelDropsBlankTranslations(t *testing.T) {
	path := writeTemp(t, `
public_url: https://hub.example.edu
branding:
  feedback_label:
    de: "  Kontakt  "
    en: "   "
`)
	cfg, err := load(path, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.Branding.FeedbackLabel["de"]; got != "Kontakt" {
		t.Errorf("feedback_label.de = %q, want the trimmed value", got)
	}
	if _, ok := cfg.Branding.FeedbackLabel["en"]; ok {
		t.Errorf("feedback_label = %v, want the blank en dropped", cfg.Branding.FeedbackLabel)
	}
}

// The shape is a {de, en} map, so a plain string must fail at startup rather
// than be silently ignored — a deployer copying the `feedback_url` line above
// it is the likely author of this mistake, and a label that never appears with
// no error to explain it is the worst outcome.
func TestFeedbackLabelRejectsAPlainString(t *testing.T) {
	path := writeTemp(t, `
public_url: https://hub.example.edu
branding:
  feedback_label: "Kontakt"
`)
	if _, err := load(path, envMap(nil)); err == nil {
		t.Fatal("load accepted a scalar feedback_label, want a parse error naming the field")
	}
}
