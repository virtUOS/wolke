// The mobile/desktop layout split (docs/03 §4). One constant so the JS media
// query (useIsMobile, Dashboard.tsx) and the CSS breakpoint (index.css's
// explicit `--breakpoint-md`, which drives every Tailwind `md:` utility) stay
// in sync instead of restating 768 in three unlinked places.
export const MOBILE_BREAKPOINT_PX = 768

/** `window.matchMedia` query matching the desktop layout (>= the breakpoint). */
export const DESKTOP_MEDIA_QUERY = `(min-width: ${MOBILE_BREAKPOINT_PX}px)`
