// Package cache is the in-process TTL catalog cache (RWMutex-guarded), invalidated
// on any admin write so catalog reads never touch the DB (docs/02 §9). A single
// instance handles the 2–3k concurrent read-heavy peak; Redis only enters with
// multi-instance HA. Populated in Phase 1.
package cache
