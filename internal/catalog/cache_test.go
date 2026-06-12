package catalog

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestCacheServesWithinTTLAndReloadsWhenStale(t *testing.T) {
	calls := 0
	loader := func(context.Context) (*Snapshot, error) {
		calls++
		return &Snapshot{}, nil
	}
	c := NewCache(time.Minute, loader)

	now := time.Unix(1_000, 0)
	c.now = func() time.Time { return now }

	ctx := context.Background()
	if _, err := c.Get(ctx); err != nil {
		t.Fatalf("first Get: %v", err)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 after first Get", calls)
	}

	// Within TTL: served from cache, no reload.
	now = now.Add(30 * time.Second)
	if _, err := c.Get(ctx); err != nil {
		t.Fatalf("second Get: %v", err)
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 within TTL", calls)
	}

	// Past TTL: reload.
	now = now.Add(2 * time.Minute)
	if _, err := c.Get(ctx); err != nil {
		t.Fatalf("third Get: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 after TTL expiry", calls)
	}
}

func TestCacheInvalidateForcesReload(t *testing.T) {
	calls := 0
	c := NewCache(time.Hour, func(context.Context) (*Snapshot, error) {
		calls++
		return &Snapshot{}, nil
	})
	ctx := context.Background()
	_, _ = c.Get(ctx)
	c.Invalidate()
	_, _ = c.Get(ctx)
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (invalidate should force a reload)", calls)
	}
}

func TestCacheReturnsLoaderError(t *testing.T) {
	c := NewCache(time.Hour, func(context.Context) (*Snapshot, error) {
		return nil, errors.New("db down")
	})
	if _, err := c.Get(context.Background()); err == nil {
		t.Fatal("Get: want error from loader, got nil")
	}
}
