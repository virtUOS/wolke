package config

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

// The configured role set is derived from the claim mapping alone:
// values ∪ precedence ∪ {default}, listed in precedence order.
func TestRoleSetDerivation(t *testing.T) {
	tests := []struct {
		name string
		m    RoleMapping
		want []string
	}{
		{
			name: "two-role deployment (student + employee→staff)",
			m: RoleMapping{
				Values:     map[string]string{"student": "student", "employee": "staff"},
				Precedence: []string{"staff", "student"},
				Default:    "student",
			},
			want: []string{"staff", "student"},
		},
		{
			name: "several claim values may map to the same role",
			m: RoleMapping{
				Values:     map[string]string{"employee": "staff", "member": "staff", "student": "student"},
				Precedence: []string{"staff", "student"},
				Default:    "student",
			},
			want: []string{"staff", "student"},
		},
		{
			name: "a mapped role missing from precedence still counts, sorted after it",
			m: RoleMapping{
				Values:     map[string]string{"a": "alumni", "b": "guest", "c": "staff"},
				Precedence: []string{"staff"},
				Default:    "staff",
			},
			want: []string{"staff", "alumni", "guest"},
		},
		{
			name: "the default alone can define a role",
			m:    RoleMapping{Default: "member"},
			want: []string{"member"},
		},
		{
			name: "a precedence-only role counts too",
			m: RoleMapping{
				Precedence: []string{"staff", "student"},
				Default:    "student",
			},
			want: []string{"staff", "student"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.m.RoleSet().Slugs()
			if !equalStrings(got, tt.want) {
				t.Errorf("Slugs() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRoleSetLabelsFallBackToTheCapitalizedSlug(t *testing.T) {
	m := RoleMapping{
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
		Labels: map[string]map[string]string{
			"staff": {"de": "Mitarbeitende", "en": "Staff"},
			// student deliberately unlabelled, and a de-only entry below.
		},
	}
	roles := m.RoleSet().List()
	if len(roles) != 2 {
		t.Fatalf("List() = %v, want 2 roles", roles)
	}
	if roles[0].Slug != "staff" || roles[0].Label["de"] != "Mitarbeitende" || roles[0].Label["en"] != "Staff" {
		t.Errorf("staff = %+v, want the configured labels", roles[0])
	}
	if roles[1].Label["de"] != "Student" || roles[1].Label["en"] != "Student" {
		t.Errorf("student labels = %v, want the capitalized slug in both languages", roles[1].Label)
	}

	// A partial label block fills only the missing language.
	m.Labels["student"] = map[string]string{"de": "Studierende"}
	roles = m.RoleSet().List()
	if roles[1].Label["de"] != "Studierende" || roles[1].Label["en"] != "Student" {
		t.Errorf("student labels = %v, want de configured and en fallen back", roles[1].Label)
	}
}

// The label map is a copy: mutating what a caller got back must not corrupt the
// configured set (it is served on every /api/roles request).
func TestRoleSetListIsACopy(t *testing.T) {
	set := RoleMapping{Precedence: []string{"staff"}, Default: "staff"}.RoleSet()
	got := set.List()
	got[0].Slug = "tampered"
	got[0].Label["de"] = "tampered"
	if again := set.List(); again[0].Slug != "staff" || again[0].Label["de"] != "Staff" {
		t.Errorf("List() = %+v after mutation, want the configured values", again[0])
	}
}

func TestRoleSetLookups(t *testing.T) {
	set := RoleMapping{
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
	}.RoleSet()

	if !set.Has("staff") || !set.Has("student") {
		t.Error("Has() must report the configured roles")
	}
	if set.Has("teacher") {
		t.Error("Has(teacher) = true, want false for a role this deployment does not configure")
	}
	if set.Default() != "student" {
		t.Errorf("Default() = %q, want student", set.Default())
	}
	if set.Len() != 2 {
		t.Errorf("Len() = %d, want 2", set.Len())
	}
	// Stale rows degrade to the default rather than erroring (spec §2.2).
	if got := set.Effective("teacher"); got != "student" {
		t.Errorf("Effective(teacher) = %q, want the default", got)
	}
	if got := set.Effective("staff"); got != "staff" {
		t.Errorf("Effective(staff) = %q, want it unchanged", got)
	}
}

// Slug validation is a startup failure: a malformed role would reach the URL
// path of /api/admin/role-defaults/{role} and the announcement audience.
func TestRoleSlugValidation(t *testing.T) {
	tests := []struct {
		name    string
		m       RoleMapping
		wantErr string
	}{
		{
			name:    "uppercase is rejected",
			m:       RoleMapping{Values: map[string]string{"x": "Staff"}, Default: "staff", Precedence: []string{"staff"}},
			wantErr: "Staff",
		},
		{
			name:    "spaces are rejected",
			m:       RoleMapping{Values: map[string]string{"x": "teaching staff"}, Default: "staff", Precedence: []string{"staff"}},
			wantErr: "teaching staff",
		},
		{
			name:    "underscores are rejected",
			m:       RoleMapping{Precedence: []string{"phd_student"}, Default: "phd_student"},
			wantErr: "phd_student",
		},
		{
			name:    "over 32 characters is rejected",
			m:       RoleMapping{Precedence: []string{strings.Repeat("a", 33)}, Default: "staff"},
			wantErr: "role slug",
		},
		{
			name:    "'all' is reserved for the announcement audience",
			m:       RoleMapping{Values: map[string]string{"x": "all"}, Precedence: []string{"all"}, Default: "all"},
			wantErr: "reserved",
		},
		{
			name:    "an empty default is rejected",
			m:       RoleMapping{Values: map[string]string{"x": "staff"}, Precedence: []string{"staff"}},
			wantErr: "default",
		},
		{
			name:    "an empty role set is rejected",
			m:       RoleMapping{},
			wantErr: "default",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.m.validateRoles()
			if err == nil {
				t.Fatalf("validateRoles() = nil, want an error mentioning %q", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("validateRoles() = %v, want it to mention %q", err, tt.wantErr)
			}
		})
	}

	ok := RoleMapping{
		Values:     map[string]string{"student": "student", "employee": "staff", "x": "phd-student-2"},
		Precedence: []string{"staff", "phd-student-2", "student"},
		Default:    "student",
	}
	if err := ok.validateRoles(); err != nil {
		t.Errorf("validateRoles() = %v, want nil for lowercase/digit/hyphen slugs", err)
	}
}

// A bad role slug must fail the whole config load, not be quietly dropped.
func TestLoadFailsOnAnInvalidRoleSlug(t *testing.T) {
	path := writeTemp(t, `
oidc:
  role:
    values:
      employee: Staff
    precedence: [Staff]
    default: Staff
`)
	if _, err := load(path, envMap(nil)); err == nil {
		t.Fatal("load() = nil error, want the invalid role slug to fail startup")
	}
}

func TestLoadReadsLabels(t *testing.T) {
	path := writeTemp(t, `
oidc:
  role:
    values:
      student: student
      employee: staff
    precedence: [staff, student]
    default: student
    labels:
      student: { de: "Studierende", en: "Students" }
      staff:   { de: "Mitarbeitende", en: "Staff" }
`)
	cfg, err := load(path, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	roles := cfg.Roles().List()
	if len(roles) != 2 {
		t.Fatalf("Roles() = %+v, want exactly the two configured roles", roles)
	}
	if roles[0].Slug != "staff" || roles[0].Label["de"] != "Mitarbeitende" {
		t.Errorf("roles[0] = %+v, want staff first with its German label", roles[0])
	}
	if roles[1].Slug != "student" || roles[1].Label["en"] != "Students" {
		t.Errorf("roles[1] = %+v, want student with its English label", roles[1])
	}
}

// Scaling past a handful of roles works, but the UX (default views, audience
// picker) is designed for a few — so it warns, once, at startup.
func TestLogSummaryWarnsAboveFiveRoles(t *testing.T) {
	sixRoles := RoleMapping{
		Precedence: []string{"staff", "student", "alumni", "guest", "faculty", "external"},
		Default:    "student",
	}
	records := logRoleSet(t, sixRoles)
	warns := 0
	for _, rec := range records {
		if rec["level"] == "WARN" {
			warns++
			if !strings.Contains(rec["msg"].(string), "role") {
				t.Errorf("warning msg = %q, want it to name the role set", rec["msg"])
			}
			if rec["roles"] != float64(6) {
				t.Errorf("warning roles = %v, want 6", rec["roles"])
			}
		}
	}
	if warns != 1 {
		t.Errorf("got %d warnings, want exactly one", warns)
	}

	for _, rec := range logRoleSet(t, RoleMapping{Precedence: []string{"staff", "student"}, Default: "student"}) {
		if rec["level"] == "WARN" {
			t.Errorf("unexpected warning for a two-role set: %v", rec)
		}
	}
	for _, rec := range logRoleSet(t, RoleMapping{Precedence: []string{"a", "b", "c", "d", "e"}, Default: "a"}) {
		if rec["level"] == "WARN" {
			t.Errorf("unexpected warning at exactly five roles: %v", rec)
		}
	}
}

// logRoleSet captures the JSON log records LogSummary emits for a mapping.
func logRoleSet(t *testing.T, m RoleMapping) []map[string]any {
	t.Helper()
	var buf bytes.Buffer
	m.RoleSet().LogSummary(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		rec := map[string]any{}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("log line %q is not JSON: %v", line, err)
		}
		out = append(out, rec)
	}
	return out
}
