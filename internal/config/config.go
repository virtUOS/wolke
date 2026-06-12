// Package config loads runtime configuration with the precedence
// env > mounted file > defaults (docs/02 §11).
//
// The agreed split: scalar settings and secrets come from environment
// variables; structured maps (the OIDC claim mapping and the branding theme)
// come from a mounted YAML file. Environment variables override only top-level
// scalar fields — never nested map keys. This keeps secrets out of files and
// lets a fork re-skin or re-point by editing one YAML file and restarting, with
// no recompile.
package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// Config is the fully-resolved runtime configuration.
type Config struct {
	// Top-level scalars (env-overridable).
	HTTPAddr       string   `yaml:"http_addr"`
	PublicURL      string   `yaml:"public_url"`
	DatabaseURL    string   `yaml:"database_url"`
	SessionSecret  string   `yaml:"session_secret"`
	MetricsToken   string   `yaml:"metrics_token"`
	LogLevel       string   `yaml:"log_level"`
	TrustedProxies []string `yaml:"trusted_proxies"`

	OIDC     OIDC     `yaml:"oidc"`
	Branding Branding `yaml:"branding"`
}

// OIDC holds the provider-agnostic client settings (scalars, env-overridable)
// plus the configurable claim mapping (nested maps, file-only) — docs/02 §6.
type OIDC struct {
	IssuerURL    string   `yaml:"issuer_url"`
	ClientID     string   `yaml:"client_id"`
	ClientSecret string   `yaml:"client_secret"`
	Scopes       []string `yaml:"scopes"`

	Role  RoleMapping  `yaml:"role"`
	Admin AdminMapping `yaml:"admin"`
}

// RoleMapping maps an affiliation claim's values to the three internal roles.
type RoleMapping struct {
	Claim      string            `yaml:"claim"`
	Values     map[string]string `yaml:"values"`
	Precedence []string          `yaml:"precedence"`
	Default    string            `yaml:"default"`
}

// AdminMapping detects a dashboard admin from a (possibly nested) claim.
type AdminMapping struct {
	Claim string `yaml:"claim"`
	Match string `yaml:"match"`
}

// Branding is the runtime skin served at GET /api/branding (docs/02 §11,
// docs/03 §2). The bundled defaults are the UOS skin; a deployer overrides them
// by mounting a branding.yaml and swapping logo assets — no recompile.
type Branding struct {
	ProductName   string `yaml:"product_name"`
	OrgName       string `yaml:"org_name"`
	LogoLight     string `yaml:"logo_light"`
	LogoDark      string `yaml:"logo_dark"`
	Favicon       string `yaml:"favicon"`
	DefaultLocale string `yaml:"default_locale"`
	Theme         Theme  `yaml:"theme"`
}

// Theme carries the light/dark token sets. Tokens are a map so the variable
// names stay stable while only values change across deployments (docs/03 §2).
type Theme struct {
	Light map[string]string `yaml:"light"`
	Dark  map[string]string `yaml:"dark"`
}

// Defaults returns the bundled configuration: dev-friendly scalars and the UOS
// default skin (docs/03 §2 — these brand values are read off the mockups and are
// still TBD against the official Corporate Design manual; CLAUDE.md rule 8).
func Defaults() Config {
	return Config{
		HTTPAddr:       ":8080",
		PublicURL:      "http://localhost:8080",
		LogLevel:       "info",
		TrustedProxies: nil,
		OIDC: OIDC{
			Scopes: []string{"openid", "profile", "email"},
			Role: RoleMapping{
				Claim:      "eduPersonAffiliation",
				Values:     map[string]string{"faculty": "teacher", "employee": "staff", "member": "staff", "student": "student"},
				Precedence: []string{"teacher", "staff", "student"},
				Default:    "student",
			},
			Admin: AdminMapping{Claim: "groups", Match: "dashboard-admins"},
		},
		Branding: Branding{
			ProductName:   "IT Service",
			OrgName:       "Universität Osnabrück",
			LogoLight:     "/branding/logo-light.svg",
			LogoDark:      "/branding/logo-dark.svg",
			Favicon:       "/branding/favicon.svg",
			DefaultLocale: "de",
			Theme: Theme{
				// TBD: lock against the UOS Corporate Design manual (concept §8.1).
				Light: map[string]string{
					"primary": "#A6093D", "primary_hover": "#8A0732", "accent": "#F2C879",
					"surface": "#F4F4F5", "text": "#18181B",
				},
				Dark: map[string]string{
					"primary": "#C2355C", "primary_hover": "#A6093D", "accent": "#F2C879",
					"surface": "#1E1E21", "text": "#F4F4F5",
				},
			},
		},
	}
}

// Load resolves configuration from the mounted file (path in CONFIG_FILE, if
// set and present) layered over defaults, then applies environment overrides.
func Load() (*Config, error) {
	return load(os.Getenv("CONFIG_FILE"), os.LookupEnv)
}

// load is the testable core: defaults < file < env, where env touches only
// top-level scalars. A non-empty path that does not exist is an error; an empty
// path means "no file" (defaults + env only).
func load(path string, lookupEnv func(string) (string, bool)) (*Config, error) {
	cfg := Defaults()

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read config file %q: %w", path, err)
		}
		// Unmarshalling onto the defaulted struct overlays file values, fully
		// replacing nested maps that the file specifies and leaving the rest.
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return nil, fmt.Errorf("parse config file %q: %w", path, err)
		}
	}

	applyEnv(&cfg, lookupEnv)

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// applyEnv overrides top-level scalar fields from the environment. Nested map
// keys (role.values, branding.theme.*) are intentionally not env-overridable.
func applyEnv(cfg *Config, lookupEnv func(string) (string, bool)) {
	setStr := func(key string, dst *string) {
		if v, ok := lookupEnv(key); ok {
			*dst = v
		}
	}
	setCSV := func(key string, dst *[]string) {
		if v, ok := lookupEnv(key); ok {
			*dst = splitCSV(v)
		}
	}

	setStr("HTTP_ADDR", &cfg.HTTPAddr)
	setStr("PUBLIC_URL", &cfg.PublicURL)
	setStr("DATABASE_URL", &cfg.DatabaseURL)
	setStr("SESSION_SECRET", &cfg.SessionSecret)
	setStr("METRICS_TOKEN", &cfg.MetricsToken)
	setStr("LOG_LEVEL", &cfg.LogLevel)
	setCSV("TRUSTED_PROXIES", &cfg.TrustedProxies)

	setStr("OIDC_ISSUER_URL", &cfg.OIDC.IssuerURL)
	setStr("OIDC_CLIENT_ID", &cfg.OIDC.ClientID)
	setStr("OIDC_CLIENT_SECRET", &cfg.OIDC.ClientSecret)
	setCSV("OIDC_SCOPES", &cfg.OIDC.Scopes)
}

// validate enforces invariants that must hold in every environment. Auth and DB
// settings may be empty in Phase 0 local dev (no real login/DB wired yet), so
// they are not required here; later phases tighten this.
func (c *Config) validate() error {
	if c.PublicURL == "" {
		return fmt.Errorf("config: public_url must not be empty")
	}
	if c.HTTPAddr == "" {
		return fmt.Errorf("config: http_addr must not be empty")
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("config: log_level %q is not one of debug|info|warn|error", c.LogLevel)
	}
	return nil
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
