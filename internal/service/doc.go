// Package service is the single use-case layer. All writes and business rules
// live here; HTTP handlers and MCP tools are thin wrappers that call into it,
// so the form and the MCP server stay behaviorally identical (CLAUDE.md rule 3,
// docs/02 §2, §10). Validation (URL format, icon allowlist, ≥1 category, …) is
// centralized here so it is never duplicated.
package service
