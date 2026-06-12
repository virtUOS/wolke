// Package web embeds the built React SPA (via go:embed) and serves it as static
// assets with SPA-fallback routing, alongside the JSON API, from the single Go
// binary (docs/02 §2). The embed.FS wiring lands in step 0.8.
package web
