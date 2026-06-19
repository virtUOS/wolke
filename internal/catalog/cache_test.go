package catalog

import (
	"context"
	"errors"
	"sync"
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

// A transient loader failure at TTL expiry must serve the last good snapshot
// rather than blanking the catalog for every reader.
func TestCacheServesStaleSnapshotOnReloadError(t *testing.T) {
	good := &Snapshot{}
	fail := false
	c := NewCache(time.Minute, func(context.Context) (*Snapshot, error) {
		if fail {
			return nil, errors.New("db down")
		}
		return good, nil
	})
	now := time.Unix(1_000, 0)
	c.now = func() time.Time { return now }

	ctx := context.Background()
	first, err := c.Get(ctx)
	if err != nil || first != good {
		t.Fatalf("first Get: snap=%v err=%v", first, err)
	}

	// Past TTL with the loader now failing: the previous snapshot is served.
	fail = true
	now = now.Add(2 * time.Minute)
	got, err := c.Get(ctx)
	if err != nil {
		t.Fatalf("stale Get: unexpected error %v", err)
	}
	if got != good {
		t.Fatalf("stale Get: got %v, want the previous snapshot %v", got, good)
	}
}

// After an explicit Invalidate (a write superseded the data) there is no good
// snapshot to fall back to, so a failed reload must surface the error.
func TestCacheErrorsAfterInvalidateWhenReloadFails(t *testing.T) {
	fail := false
	c := NewCache(time.Hour, func(context.Context) (*Snapshot, error) {
		if fail {
			return nil, errors.New("db down")
		}
		return &Snapshot{}, nil
	})
	ctx := context.Background()
	if _, err := c.Get(ctx); err != nil {
		t.Fatalf("first Get: %v", err)
	}
	c.Invalidate()
	fail = true
	if _, err := c.Get(ctx); err == nil {
		t.Fatal("Get after invalidate+failure: want error, got nil")
	}
}

// Concurrent reloads collapse to a single loader call (singleflight).
func TestCacheCollapsesConcurrentReloads(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	entered := make(chan struct{}, 16)
	release := make(chan struct{})
	c := NewCache(time.Hour, func(context.Context) (*Snapshot, error) {
		mu.Lock()
		calls++
		mu.Unlock()
		entered <- struct{}{}
		<-release
		return &Snapshot{}, nil
	})

	const n = 8
	ready := make(chan struct{}, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for range n {
		go func() {
			defer wg.Done()
			ready <- struct{}{} // about to call Get
			if _, err := c.Get(context.Background()); err != nil {
				t.Errorf("concurrent Get: %v", err)
			}
		}()
	}
	// Barrier: every goroutine is running and about to call Get, and one is in
	// flight inside the loader (parked on release). The other n-1 then join that
	// in-flight singleflight call. Without waiting for all goroutines to arrive,
	// the loader could finish and the singleflight key be removed before the
	// slower goroutines call Get (flaky under -race/coverage) — a second call.
	for range n {
		<-ready
	}
	<-entered
	// The joiners can't complete Get until release, so they can only be parked
	// inside singleflight.Do; give them a moment to get there before releasing.
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("loader calls = %d, want 1 (concurrent reloads should collapse)", calls)
	}
}
