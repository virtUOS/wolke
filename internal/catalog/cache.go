package catalog

import (
	"context"
	"sync"
	"time"
)

// Cache holds the assembled catalog snapshot in process, refreshing it when
// stale or when explicitly invalidated after an admin write (docs/02 §9). It is
// safe for concurrent use; reads take a read lock and never hit the DB.
type Cache struct {
	mu       sync.RWMutex
	snap     *Snapshot
	loadedAt time.Time

	ttl    time.Duration
	loader func(context.Context) (*Snapshot, error)
	now    func() time.Time
}

// NewCache builds a cache that (re)loads via loader and treats a snapshot older
// than ttl as stale.
func NewCache(ttl time.Duration, loader func(context.Context) (*Snapshot, error)) *Cache {
	return &Cache{ttl: ttl, loader: loader, now: time.Now}
}

// Get returns the cached snapshot, reloading if absent or stale.
func (c *Cache) Get(ctx context.Context) (*Snapshot, error) {
	c.mu.RLock()
	snap, fresh := c.snap, c.snap != nil && c.now().Sub(c.loadedAt) < c.ttl
	c.mu.RUnlock()
	if fresh {
		return snap, nil
	}
	return c.reload(ctx)
}

// Invalidate drops the cached snapshot so the next Get reloads. Call after any
// catalog write.
func (c *Cache) Invalidate() {
	c.mu.Lock()
	c.snap = nil
	c.mu.Unlock()
}

func (c *Cache) reload(ctx context.Context) (*Snapshot, error) {
	snap, err := c.loader(ctx)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.snap = snap
	c.loadedAt = c.now()
	c.mu.Unlock()
	return snap, nil
}
