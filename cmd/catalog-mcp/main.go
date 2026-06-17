// Command catalog-mcp runs the public, read-only catalog MCP server. Any
// university member can run it: it exposes the active service catalog — what
// services exist, which are in maintenance or beta, where their documentation
// lives — plus search and active announcements. It shares the same read model
// as /api/catalog, so results match the web UI exactly.
//
// Unlike the admin server (cmd/mcp), it requires no user identity: the data is
// the public catalog every logged-in member already sees, and there is nothing
// to audit because there is no write path. It needs only DATABASE_URL.
// Transport is stdio (for a local Claude Desktop / Claude Code client).
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/virtuos/wolke/internal/announce"
	"github.com/virtuos/wolke/internal/catalog"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/readmcp"
	"github.com/virtuos/wolke/internal/store"
)

// catalogCacheTTL bounds how long the in-process catalog snapshot is served
// before a reload (matches the HTTP server's cache).
const catalogCacheTTL = 60 * time.Second

func main() {
	if err := run(); err != nil {
		slog.Error("catalog MCP server exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil)) // stdout is the MCP transport
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}

	ctx := context.Background()
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	cache := catalog.NewCache(catalogCacheTTL, func(ctx context.Context) (*catalog.Snapshot, error) {
		return catalog.Load(ctx, db)
	})
	mgr := readmcp.New(cache, db)

	srv := mcp.NewServer(&mcp.Implementation{Name: "wolke-catalog", Version: "0.1.0"}, nil)
	registerTools(srv, mgr)

	log.Info("catalog MCP server ready (stdio)")
	return srv.Run(ctx, &mcp.StdioTransport{})
}

// --- tool input/output shapes ---

type empty struct{}

type listInput struct {
	Category string `json:"category,omitempty"` // filter by category slug
	Status   string `json:"status,omitempty"`   // filter by tag: "beta" or "wartung"
}

type idInput struct {
	ID string `json:"id"`
}

type searchInput struct {
	Query string `json:"query"`
}

type servicesOut struct {
	Services []catalog.Service `json:"services"`
}
type categoriesOut struct {
	Categories []readmcp.Category `json:"categories"`
}
type announcementsOut struct {
	Announcements []announce.Announcement `json:"announcements"`
}

func registerTools(s *mcp.Server, mgr *readmcp.Manager) {
	mcp.AddTool(s, &mcp.Tool{Name: "service.list", Description: "List active catalog services. Optional filters: category (a category slug) and status (\"beta\" or \"wartung\")."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in listInput) (*mcp.CallToolResult, servicesOut, error) {
			list, err := mgr.ListServices(ctx, in.Category, in.Status)
			return nil, servicesOut{Services: list}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.get", Description: "Get one active service by id, including its documentation links and beta/maintenance status."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, catalog.Service, error) {
			svc, err := mgr.GetService(ctx, in.ID)
			return nil, svc, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.search", Description: "Search active services by name, description, or category. Useful for finding where to access a service or its documentation."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in searchInput) (*mcp.CallToolResult, servicesOut, error) {
			list, err := mgr.Search(ctx, in.Query)
			return nil, servicesOut{Services: list}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.list_in_maintenance", Description: "List active services currently flagged as in maintenance (the \"wartung\" status tag)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, servicesOut, error) {
			list, err := mgr.ListInMaintenance(ctx)
			return nil, servicesOut{Services: list}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "category.list", Description: "List the catalog categories."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, categoriesOut, error) {
			cats, err := mgr.ListCategories(ctx)
			return nil, categoriesOut{Categories: cats}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "announcements.list", Description: "List active announcements across all audiences, including scheduled maintenance windows and outages."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, announcementsOut, error) {
			list, err := mgr.ListAnnouncements(ctx)
			return nil, announcementsOut{Announcements: list}, err
		})
}
