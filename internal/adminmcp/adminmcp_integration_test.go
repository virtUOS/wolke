package adminmcp

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/virtUOS/service-hub/internal/service"
	"github.com/virtUOS/service-hub/internal/store"
)

// Enforces the MCP safety contract (CLAUDE.md rule 4, docs/02 §8): propose_*
// never writes; only confirm writes, exactly once, audited as actor_kind=mcp;
// expired / reused / discarded tokens are rejected. Needs DATABASE_URL.
func TestProposeNeverWritesConfirmDoes(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set; skipping MCP integration test")
	}
	ctx := context.Background()
	db, err := store.Open(ctx, url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	admin, err := db.UpsertUser(ctx, store.UpsertUserParams{OidcSub: "mcp-test", DisplayName: "MCP", PrimaryRole: "staff", IsAdmin: true})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(ctx, "delete from services where name like 'MCP Test%'")
		_, _ = db.Pool.Exec(ctx, "delete from audit_log where actor_id = $1", admin.ID)
		_, _ = db.Pool.Exec(ctx, "delete from users where oidc_sub = 'mcp-test'")
		db.Close()
	})

	mgr := New(db, service.Actor{ID: admin.ID, Kind: service.ActorMCP})

	countServices := func() int {
		var n int
		_ = db.Pool.QueryRow(ctx, "select count(*) from services where name like 'MCP Test%'").Scan(&n)
		return n
	}
	countAudit := func() int {
		var n int
		_ = db.Pool.QueryRow(ctx, "select count(*) from audit_log where actor_id=$1", admin.ID).Scan(&n)
		return n
	}

	draft := service.Draft{
		Name: "MCP Test Svc", Description: map[string]string{"de": "Test."},
		ServiceURL: "https://mcp.example.edu", Icon: "server", Categories: []string{"data"},
	}

	// propose_create writes nothing.
	prev, err := mgr.ProposeCreate(ctx, draft)
	if err != nil {
		t.Fatalf("ProposeCreate: %v", err)
	}
	if prev.ChangeToken == "" || prev.After == nil || prev.After.Name != "MCP Test Svc" {
		t.Fatalf("preview = %+v, want token + after", prev)
	}
	if countServices() != 0 || countAudit() != 0 {
		t.Fatalf("propose wrote to the DB: services=%d audit=%d, want 0/0", countServices(), countAudit())
	}

	// Invalid input is rejected at propose, still no write.
	if _, err := mgr.ProposeCreate(ctx, service.Draft{Name: "", Icon: "nope"}); err == nil {
		t.Error("ProposeCreate with invalid input should fail")
	}

	// confirm writes exactly once and audits as mcp.
	if _, err := mgr.Confirm(ctx, prev.ChangeToken); err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if countServices() != 1 {
		t.Fatalf("after confirm: services=%d, want 1", countServices())
	}
	var kind, action string
	if err := db.Pool.QueryRow(ctx, "select actor_kind, action from audit_log where actor_id=$1 order by id desc limit 1", admin.ID).Scan(&kind, &action); err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if kind != "mcp" || action != "service.create" {
		t.Errorf("audit = %s/%s, want mcp/service.create", kind, action)
	}

	// The token is single-use.
	if _, err := mgr.Confirm(ctx, prev.ChangeToken); err == nil {
		t.Error("reusing a confirmed token should fail")
	}

	// An expired token is rejected and writes nothing.
	exp, _ := mgr.ProposeCreate(ctx, service.Draft{
		Name: "MCP Test Expired", Description: map[string]string{"de": "x"},
		DocURL: "https://docs.example.edu/x", Icon: "server", Categories: []string{"data"},
	})
	mgr.now = func() time.Time { return time.Now().Add(2 * TokenTTL) }
	before := countServices()
	if _, err := mgr.Confirm(ctx, exp.ChangeToken); err == nil {
		t.Error("expired token should be rejected")
	}
	if countServices() != before {
		t.Error("expired confirm must not write")
	}
	mgr.now = time.Now

	// Discard removes a staged change so it can't be confirmed.
	disc, err := mgr.ProposeCreate(ctx, service.Draft{
		Name: "MCP Test Discard", Description: map[string]string{"de": "x"},
		DocURL: "https://docs.example.edu/d", Icon: "server", Categories: []string{"data"},
	})
	if err != nil {
		t.Fatalf("ProposeCreate (discard): %v", err)
	}
	if err := mgr.Discard(disc.ChangeToken); err != nil {
		t.Fatalf("Discard: %v", err)
	}
	if _, err := mgr.Confirm(ctx, disc.ChangeToken); err == nil {
		t.Error("confirming a discarded token should fail")
	}
}
