// Command server runs the HTTP API and serves the embedded React SPA from a
// single binary (docs/02 §2). This is a Phase 0 stub; the chi router, config
// loader, proxy-aware middleware, and health endpoints land in steps 0.3–0.8.
package main

import (
	"log/slog"
	"os"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	log.Info("service-hub server starting", "status", "skeleton: not yet serving")
}
