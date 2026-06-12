package service

// allowedIcons is the set of valid lucide icon names a service may use. It MUST
// stay in sync with the frontend registry in web-ui/src/lib/icons.ts (CLAUDE.md:
// validate icon names against the allowlist used by the backend).
var allowedIcons = map[string]bool{
	"app-window": true, "book-open": true, "calendar": true, "cloud": true,
	"database": true, "file-text": true, "folder": true, "globe": true,
	"graduation-cap": true, "hard-drive": true, "key-round": true, "laptop": true,
	"library-big": true, "mail": true, "message-square": true, "monitor": true,
	"network": true, "notebook-pen": true, "pen-line": true, "presentation": true,
	"server": true, "shield": true, "sparkles": true, "users": true,
	"video": true, "wifi": true,
}
