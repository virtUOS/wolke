package service

import "regexp"

// Icons are picked from the full lucide set in the admin UI (sourced from
// lucide's own icon-name list), so the backend no longer keeps a hand-maintained
// allowlist. It validates the shape instead: a kebab-case slug, the way lucide
// names icons. A well-formed but unknown name degrades gracefully to a fallback
// glyph in the client (CLAUDE.md: lucide-react for icons).
var iconNamePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func validIconName(name string) bool {
	return iconNamePattern.MatchString(name)
}
