package auth

import (
	"context"
	"io"
	"log/slog"
	"slices"
	"testing"

	"github.com/virtuos/wolke/internal/config"
)

// The claim-granted visibility slugs follow the is_admin contract: they are
// re-derived from the token on every login and written to the user row, so
// removing the group at the IdP removes the access at the next login
// (docs/specs/service-visibility.md §4, issue #121). This exercises the real
// login write path — buildIdentity + Service.persist, exactly what Callback
// runs — against a real Postgres.
func TestLoginWritesVisibilityClaims(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	// The claim shape the dev mock IdP emits (dev/mock-oidc-config.json): a
	// multi-valued `groups` claim, the same one the admin mapping reads.
	cfg := config.Defaults()
	cfg.VisibilityEntries = []config.VisibilityEntry{
		{
			Slug: "it-infra", Grant: config.GrantClaim,
			Claim: "groups", Match: "it-service-admins",
			Label: map[string]string{"de": "IT-Infrastruktur", "en": "IT infrastructure"},
		},
		{
			Slug: "experimental", Grant: config.GrantOptIn,
			Warning: map[string]string{"de": "kann verschwinden", "en": "may vanish"},
		},
	}
	svc := NewService(nil, nil, db, &cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))

	const sub = "vis-claims-login"
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), "delete from users where oidc_sub = $1", sub)
	})

	login := func(groups []any) []string {
		t.Helper()
		claims := map[string]any{
			"sub": sub, "name": "Vis Tester", "email": "vis@example.edu",
			"eduPersonAffiliation": "employee", "groups": groups,
		}
		user, err := svc.persist(ctx, buildIdentity(claims, cfg.OIDC, cfg.Visibility()))
		if err != nil {
			t.Fatalf("persist: %v", err)
		}
		return user.VisibilityClaims
	}

	// A login carrying the group writes the slug on the user row.
	if got := login([]any{"students", "it-service-admins"}); !slices.Equal(got, []string{"it-infra"}) {
		t.Fatalf("after granting login: visibility_claims = %v, want [it-infra]", got)
	}

	// The user's own opt-in is untouched by a login: it is their choice, not
	// the IdP's, and lives in a different column.
	if _, err := db.Pool.Exec(ctx,
		"update users set visibility_optin = '{experimental}' where oidc_sub = $1", sub); err != nil {
		t.Fatalf("set opt-in: %v", err)
	}

	// Removing the group at the IdP revokes the slug at the next login.
	if got := login([]any{"students"}); len(got) != 0 {
		t.Fatalf("after revoking login: visibility_claims = %v, want empty", got)
	}

	var optin []string
	if err := db.Pool.QueryRow(ctx,
		"select visibility_optin from users where oidc_sub = $1", sub).Scan(&optin); err != nil {
		t.Fatalf("read opt-in: %v", err)
	}
	if !slices.Equal(optin, []string{"experimental"}) {
		t.Fatalf("login overwrote the user's opt-ins: %v, want [experimental]", optin)
	}
}
