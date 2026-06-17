// Package migrations embeds the forward-only goose SQL migrations so the server
// can apply them at startup (auto-migrate). The goose CLI (`make migrate`, CI)
// still reads the same .sql files directly from this directory.
package migrations

import "embed"

// FS holds the embedded *.sql migration files, rooted at this directory.
//
//go:embed *.sql
var FS embed.FS
