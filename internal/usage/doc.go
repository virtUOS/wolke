// Package usage ingests launch-click events, derives "frequently used", and
// rolls click_events up into usage_daily for cheap metric reads (docs/01 §4.5,
// §5.4; docs/02 §7). Populated in Phase 2.
package usage
