package main

import (
	"context"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/virtuos/wolke/internal/readmcp"
)

// Verifies the MCP tool layer wires up: AddTool panics on a bad input/output
// schema, so a clean registration + tools/list proves the shapes are valid. No
// DB needed (tools/list doesn't invoke handlers).
func TestToolRegistration(t *testing.T) {
	ctx := context.Background()
	srv := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	registerTools(srv, readmcp.New(nil, nil))

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
		"service.list", "service.get", "service.search",
		"service.list_in_maintenance", "category.list", "announcements.list",
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
