package config

import (
	"os"
	"path/filepath"
	"testing"
)

// envMap turns a map into a LookupEnv-compatible func, so tests never touch the
// real process environment.
func envMap(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}
}

func writeTemp(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return p
}

func TestDefaultsWhenNoFileNoEnv(t *testing.T) {
	cfg, err := load("", envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr = %q, want :8080", cfg.HTTPAddr)
	}
	if cfg.PublicURL != "http://localhost:8080" {
		t.Errorf("PublicURL = %q, want default", cfg.PublicURL)
	}
	if cfg.Branding.ProductName != "wolke" {
		t.Errorf("ProductName = %q, want default UOS skin", cfg.Branding.ProductName)
	}
	if got := cfg.Branding.Theme.Light["primary"]; got != "#A6093D" {
		t.Errorf("light primary = %q, want default brand red", got)
	}
	if cfg.Branding.ImprintURL == "" || cfg.Branding.PrivacyURL == "" {
		t.Error("default branding should carry imprint/privacy footer links")
	}
	if cfg.AnnouncementRetentionDays != 60 {
		t.Errorf("AnnouncementRetentionDays = %d, want default 60", cfg.AnnouncementRetentionDays)
	}
}

func TestAnnouncementRetentionDaysFromEnv(t *testing.T) {
	cfg, err := load("", envMap(map[string]string{"ANNOUNCEMENT_RETENTION_DAYS": "30"}))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.AnnouncementRetentionDays != 30 {
		t.Errorf("AnnouncementRetentionDays = %d, want 30 from env", cfg.AnnouncementRetentionDays)
	}
}

func TestNegativeRetentionRejected(t *testing.T) {
	if _, err := load("", envMap(map[string]string{"ANNOUNCEMENT_RETENTION_DAYS": "-5"})); err == nil {
		t.Fatal("load: want error for negative announcement_retention_days, got nil")
	}
}

func TestFileOverridesDefaults(t *testing.T) {
	path := writeTemp(t, `
public_url: https://hub.example.edu
branding:
  product_name: "Campus Apps"
  theme:
    light:
      primary: "#123456"
`)
	cfg, err := load(path, envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.PublicURL != "https://hub.example.edu" {
		t.Errorf("PublicURL = %q, want file value", cfg.PublicURL)
	}
	if cfg.Branding.ProductName != "Campus Apps" {
		t.Errorf("ProductName = %q, want file value", cfg.Branding.ProductName)
	}
	if got := cfg.Branding.Theme.Light["primary"]; got != "#123456" {
		t.Errorf("light primary = %q, want file value", got)
	}
}

func TestEnvOverridesFileForScalars(t *testing.T) {
	path := writeTemp(t, `
public_url: https://from-file.example.edu
oidc:
  client_secret: file-secret
`)
	env := envMap(map[string]string{
		"PUBLIC_URL":         "https://from-env.example.edu",
		"OIDC_CLIENT_SECRET": "env-secret",
		"SESSION_SECRET":     "s3cr3t",
	})
	cfg, err := load(path, env)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.PublicURL != "https://from-env.example.edu" {
		t.Errorf("PublicURL = %q, want env to win over file", cfg.PublicURL)
	}
	if cfg.OIDC.ClientSecret != "env-secret" {
		t.Errorf("ClientSecret = %q, want env to win over file", cfg.OIDC.ClientSecret)
	}
	if cfg.SessionSecret != "s3cr3t" {
		t.Errorf("SessionSecret = %q, want env value", cfg.SessionSecret)
	}
}

// The agreed rule: env overrides top-level scalars only, never nested map keys.
// There is deliberately no env var that can rewrite a theme token or a role
// claim-value mapping — those are file-only.
func TestEnvDoesNotOverrideNestedMapKeys(t *testing.T) {
	path := writeTemp(t, `
branding:
  theme:
    light:
      primary: "#AAAAAA"
oidc:
  role:
    values:
      faculty: teacher
`)
	// Even if a deployer sets suggestively-named env vars, nested keys are
	// untouched: only the file controls them.
	env := envMap(map[string]string{
		"BRANDING_THEME_LIGHT_PRIMARY": "#FFFFFF",
		"OIDC_ROLE_VALUES_FACULTY":     "staff",
	})
	cfg, err := load(path, env)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.Branding.Theme.Light["primary"]; got != "#AAAAAA" {
		t.Errorf("light primary = %q, want file value untouched by env", got)
	}
	if got := cfg.OIDC.Role.Values["faculty"]; got != "teacher" {
		t.Errorf("role faculty = %q, want file value untouched by env", got)
	}
}

func TestEnvCSVParsing(t *testing.T) {
	env := envMap(map[string]string{
		"OIDC_SCOPES":     "openid, profile , email,groups",
		"TRUSTED_PROXIES": "10.0.0.0/8,172.16.0.0/12",
	})
	cfg, err := load("", env)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	wantScopes := []string{"openid", "profile", "email", "groups"}
	if got := cfg.OIDC.Scopes; !equalStrings(got, wantScopes) {
		t.Errorf("Scopes = %v, want %v", got, wantScopes)
	}
	wantProxies := []string{"10.0.0.0/8", "172.16.0.0/12"}
	if got := cfg.TrustedProxies; !equalStrings(got, wantProxies) {
		t.Errorf("TrustedProxies = %v, want %v", got, wantProxies)
	}
}

// The assistant widget fields follow the bot_url pattern: empty by default
// (feature hidden), settable via file, overridable via env scalars.
func TestAssistantWidgetConfig(t *testing.T) {
	cfg, err := load("", envMap(nil))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Branding.AssistantWidgetURL != "" || cfg.Branding.AssistantBotID != "" {
		t.Error("assistant widget must be unset by default (feature hidden)")
	}

	path := writeTemp(t, `
branding:
  assistant_widget_url: https://from-file.example.edu/widget.js
  assistant_bot_id: file-bot
`)
	env := envMap(map[string]string{
		"ASSISTANT_WIDGET_URL": "https://assistant.example.edu/widget.js",
		"ASSISTANT_BOT_ID":     "echo",
	})
	cfg, err = load(path, env)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Branding.AssistantWidgetURL != "https://assistant.example.edu/widget.js" {
		t.Errorf("AssistantWidgetURL = %q, want env to win over file", cfg.Branding.AssistantWidgetURL)
	}
	if cfg.Branding.AssistantBotID != "echo" {
		t.Errorf("AssistantBotID = %q, want env to win over file", cfg.Branding.AssistantBotID)
	}
}

// A set assistant_widget_url must be an absolute http(s) URL — its origin feeds
// the CSP allowlist, so a malformed value must fail fast at startup.
func TestAssistantWidgetURLValidated(t *testing.T) {
	for _, bad := range []string{"not-a-url", "ftp://assistant.example.edu/widget.js", "/widget.js"} {
		env := envMap(map[string]string{"ASSISTANT_WIDGET_URL": bad})
		if _, err := load("", env); err == nil {
			t.Errorf("load: want error for assistant_widget_url %q, got nil", bad)
		}
	}
	// Empty stays valid (feature off).
	if _, err := load("", envMap(nil)); err != nil {
		t.Errorf("load: empty assistant_widget_url must be valid, got %v", err)
	}
}

func TestMissingFileIsError(t *testing.T) {
	if _, err := load("/no/such/config.yaml", envMap(nil)); err == nil {
		t.Fatal("load: want error for missing file, got nil")
	}
}

func TestInvalidLogLevelRejected(t *testing.T) {
	env := envMap(map[string]string{"LOG_LEVEL": "chatty"})
	if _, err := load("", env); err == nil {
		t.Fatal("load: want error for invalid log_level, got nil")
	}
}

func TestEmptyPublicURLRejected(t *testing.T) {
	path := writeTemp(t, "public_url: \"\"\n")
	if _, err := load(path, envMap(nil)); err == nil {
		t.Fatal("load: want error for empty public_url, got nil")
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
