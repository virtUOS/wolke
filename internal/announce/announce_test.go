package announce

import (
	"testing"

	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/store"
)

func twoRoles() config.RoleSet {
	return config.RoleMapping{
		Values:     map[string]string{"student": "student", "employee": "staff"},
		Precedence: []string{"staff", "student"},
		Default:    "student",
	}.RoleSet()
}

// An audience that is no longer a configured role is flagged in the read model
// itself, so every consumer — the admin API, the public catalog MCP — sees the
// same answer (CLAUDE.md rule 3). The notice reaches nobody either way; the
// flag is what keeps it fixable instead of invisible.
func TestViewFlagsAnUnknownAudience(t *testing.T) {
	roles := twoRoles()
	tests := []struct {
		audience string
		want     bool
	}{
		{"all", false},
		{"staff", false},
		{"student", false},
		{"teacher", true},
		{"", true},
	}
	for _, tt := range tests {
		got := View(store.Announcement{Audience: tt.audience, Title: []byte(`{}`), Body: []byte(`{}`)}, roles)
		if got.AudienceUnknown != tt.want {
			t.Errorf("audience %q → AudienceUnknown = %v, want %v", tt.audience, got.AudienceUnknown, tt.want)
		}
	}
}
