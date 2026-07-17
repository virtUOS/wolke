// Command mcp runs the admin MCP server. It shares internal/service via
// internal/adminmcp, so every write goes through the same validation,
// soft-delete, and audit (actor_kind=mcp) as the form. Writes are staged:
// propose_* validates and returns a preview + change_token (no write); only
// change.confirm with a valid, unexpired, single-use token mutates (docs/02 §8).
//
// It acts as a specific admin, identified by MCP_ADMIN_SUB (the OIDC subject of
// a user who is_admin); it refuses to start otherwise — never unauthenticated.
// Transport is stdio (for a local Claude Desktop / Claude Code client).
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/virtuos/wolke/internal/adminmcp"
	"github.com/virtuos/wolke/internal/config"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("mcp server exited with error", "error", err)
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
	adminSub := os.Getenv("MCP_ADMIN_SUB")
	if adminSub == "" {
		return fmt.Errorf("MCP_ADMIN_SUB is required (the OIDC subject of an admin user)")
	}

	ctx := context.Background()
	db, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	admin, err := db.GetUserBySub(ctx, adminSub)
	if err != nil {
		return fmt.Errorf("admin user %q not found (must have logged in once): %w", adminSub, err)
	}
	if !admin.IsAdmin {
		return fmt.Errorf("user %q is not an admin", adminSub)
	}

	mgr := adminmcp.New(db, service.Actor{ID: admin.ID, Kind: service.ActorMCP})
	srv := mcp.NewServer(&mcp.Implementation{Name: "wolke-admin", Version: "0.1.0"}, nil)
	registerTools(srv, mgr)

	log.Info("admin MCP server ready (stdio)", "admin", adminSub)
	return srv.Run(ctx, &mcp.StdioTransport{})
}

// --- tool input/output shapes ---

type empty struct{}

type serviceFields struct {
	Name          string   `json:"name"`
	DescriptionDe string   `json:"description_de"`        // required (German)
	DescriptionEn string   `json:"description_en"`        // required (English)
	ServiceURL    string   `json:"service_url,omitempty"` // one of service_url/doc_url may be omitted
	DocURL        string   `json:"doc_url,omitempty"`
	Icon          string   `json:"icon"` // kebab-case lucide icon name, e.g. "graduation-cap"
	Categories    []string `json:"categories"`
	Keywords      []string `json:"keywords,omitempty"` // optional search aliases (flat, DE+EN mixed)
}

func (f serviceFields) draft() service.Draft {
	return service.Draft{
		Name:        f.Name,
		Description: map[string]string{"de": f.DescriptionDe, "en": f.DescriptionEn},
		ServiceURL:  f.ServiceURL,
		DocURL:      f.DocURL,
		Icon:        f.Icon,
		Categories:  f.Categories,
		Keywords:    f.Keywords,
	}
}

type idInput struct {
	ID string `json:"id"`
}
type updateInput struct {
	ID string `json:"id"`
	serviceFields
}
type tokenInput struct {
	ChangeToken string `json:"change_token"`
}

type servicesOut struct {
	Services []service.AdminService `json:"services"`
}
type categoriesOut struct {
	Categories []adminmcp.Category `json:"categories"`
}
type insightsInput struct {
	Days  int `json:"days,omitempty"`  // window in days (default 30)
	Limit int `json:"limit,omitempty"` // max rows (default 50)
}
type insightsOut struct {
	Insights []service.SearchInsight `json:"insights"`
}
type resultOut struct {
	Result string `json:"result"`
}

func registerTools(s *mcp.Server, mgr *adminmcp.Manager) {
	mcp.AddTool(s, &mcp.Tool{Name: "service.list", Description: "List all catalog services (including inactive)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, servicesOut, error) {
			list, err := mgr.ListServices(ctx)
			return nil, servicesOut{Services: list}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.get", Description: "Get one service by id."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, service.AdminService, error) {
			svc, err := mgr.GetService(ctx, in.ID)
			return nil, svc, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "category.list", Description: "List managed categories."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, categoriesOut, error) {
			cats, err := mgr.ListCategories(ctx)
			return nil, categoriesOut{Categories: cats}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "search.insights", Description: "List recent searches that returned no results — the worklist for adding service keywords. Read-only; aggregate-only (no user data). Optional days (default 30) and limit (default 50)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in insightsInput) (*mcp.CallToolResult, insightsOut, error) {
			list, err := mgr.SearchInsights(ctx, in.Days, in.Limit)
			return nil, insightsOut{Insights: list}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.propose_create", Description: "Validate a new service and return a preview + change_token. Does NOT write. Requires both description_de and description_en, a kebab-case lucide icon name, and at least one category."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in serviceFields) (*mcp.CallToolResult, adminmcp.Preview, error) {
			p, err := mgr.ProposeCreate(ctx, in.draft())
			return nil, p, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.propose_update", Description: "Validate an edit to an existing service and return a before/after preview + change_token. Does NOT write. Requires both description_de and description_en, a kebab-case lucide icon name, and at least one category."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in updateInput) (*mcp.CallToolResult, adminmcp.Preview, error) {
			p, err := mgr.ProposeUpdate(ctx, in.ID, in.draft())
			return nil, p, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "service.propose_delete", Description: "Stage a soft delete of a service and return a preview + change_token. Does NOT write."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, adminmcp.Preview, error) {
			p, err := mgr.ProposeDelete(ctx, in.ID)
			return nil, p, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "change.confirm", Description: "Apply a staged change by its change_token. This performs the write and audits it."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in tokenInput) (*mcp.CallToolResult, resultOut, error) {
			msg, err := mgr.Confirm(ctx, in.ChangeToken)
			return nil, resultOut{Result: msg}, err
		})

	mcp.AddTool(s, &mcp.Tool{Name: "change.discard", Description: "Discard a staged change by its change_token."},
		func(_ context.Context, _ *mcp.CallToolRequest, in tokenInput) (*mcp.CallToolResult, resultOut, error) {
			err := mgr.Discard(in.ChangeToken)
			return nil, resultOut{Result: "discarded"}, err
		})
}
