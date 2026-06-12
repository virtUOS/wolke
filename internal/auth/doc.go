// Package auth implements the provider-agnostic OIDC BFF: the code flow,
// server-side sessions, and resolution of primary_role and is_admin from the
// configurable claim mapping (docs/02 §6). No tokens ever reach the browser.
// Populated in Phase 1.
package auth
