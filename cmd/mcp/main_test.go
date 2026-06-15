package main

import (
	"context"
	"os"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/virtuos/wolke/internal/adminmcp"
	"github.com/virtuos/wolke/internal/service"
	"github.com/virtuos/wolke/internal/store"
)

// clientFor connects an in-memory MCP client to a server with the given manager.
func clientFor(ctx context.Context, t *testing.T, mgr *adminmcp.Manager) *mcp.ClientSession {
	t.Helper()
	srv := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	registerTools(srv, mgr)
	t1, t2 := mcp.NewInMemoryTransports()
	if _, err := srv.Connect(ctx, t1, nil); err != nil {
		t.Fatalf("server connect: %v", err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "c", Version: "0"}, nil).Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

// Verifies the MCP tool layer wires up: AddTool panics on a bad input/output
// schema, so a clean registration + tools/list proves the shapes are valid. No
// DB needed (tools/list doesn't invoke handlers).
func TestToolRegistration(t *testing.T) {
	ctx := context.Background()
	srv := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	registerTools(srv, adminmcp.New(nil, service.Actor{}))

	t1, t2 := mcp.NewInMemoryTransports()
	if _, err := srv.Connect(ctx, t1, nil); err != nil {
		t.Fatalf("server connect: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "0"}, nil)
	cs, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}
	defer func() { _ = cs.Close() }()

	res, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	got := map[string]bool{}
	for _, tool := range res.Tools {
		got[tool.Name] = true
	}
	want := []string{
		"service.list", "service.get", "category.list",
		"service.propose_create", "service.propose_update", "service.propose_delete",
		"change.confirm", "change.discard",
	}
	if len(res.Tools) != len(want) {
		t.Errorf("got %d tools, want %d", len(res.Tools), len(want))
	}
	for _, n := range want {
		if !got[n] {
			t.Errorf("missing tool %q", n)
		}
	}
}

// End-to-end through the MCP protocol: propose_create returns a token (no write),
// change.confirm applies it. The "done-when" of Phase 4 (docs/04). Needs DATABASE_URL.
func TestProposeConfirmOverProtocol(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping MCP protocol round-trip")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "mcp-proto-test", DisplayName: "MCP", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'MCP Proto%'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id=$1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub='mcp-proto-test'")
		db.Close()
	})

	cs := clientFor(ctx, t, adminmcp.New(db, service.Actor{ID: admin.ID, Kind: service.ActorMCP}))

	// propose_create → token in structured output; nothing written yet.
	res, err := cs.CallTool(ctx, &mcp.CallToolParams{
		Name: "service.propose_create",
		Arguments: map[string]any{
			"name": "MCP Proto Svc", "description_de": "Test.",
			"service_url": "https://proto.example.edu", "icon": "server", "categories": []string{"data"},
		},
	})
	if err != nil || res.IsError {
		t.Fatalf("propose_create failed: err=%v isError=%v", err, res.IsError)
	}
	prev, _ := res.StructuredContent.(map[string]any)
	token, _ := prev["change_token"].(string)
	if token == "" {
		t.Fatalf("no change_token in preview: %+v", res.StructuredContent)
	}
	var n int
	_ = db.Pool.QueryRow(ctx, "select count(*) from services where name='MCP Proto Svc'").Scan(&n)
	if n != 0 {
		t.Fatalf("propose wrote %d rows, want 0", n)
	}

	// change.confirm → service created.
	res, err = cs.CallTool(ctx, &mcp.CallToolParams{Name: "change.confirm", Arguments: map[string]any{"change_token": token}})
	if err != nil || res.IsError {
		t.Fatalf("confirm failed: err=%v isError=%v content=%v", err, res.IsError, res.Content)
	}
	_ = db.Pool.QueryRow(ctx, "select count(*) from services where name='MCP Proto Svc'").Scan(&n)
	if n != 1 {
		t.Fatalf("after confirm: %d rows, want 1", n)
	}
	var kind string
	_ = db.Pool.QueryRow(ctx, "select actor_kind from audit_log where actor_id=$1 order by id desc limit 1", admin.ID).Scan(&kind)
	if kind != "mcp" {
		t.Errorf("audit actor_kind = %q, want mcp", kind)
	}
}
