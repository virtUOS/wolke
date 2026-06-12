// Command mcp runs the admin MCP server. It links the same internal/service
// use-case layer as the API, so validation, soft-delete, and audit logging are
// identical, and stages every write behind propose_* → change.confirm
// (docs/02 §8). This is a Phase 0 stub; the tool layer lands in Phase 4.
package main

import (
	"log/slog"
	"os"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	log.Info("service-hub admin MCP server starting", "status", "skeleton: not yet serving")
}
