# Spec — Flatten migrations to a v1 baseline

Status: **DRAFTED, POSTPONED — execute immediately before going to production / the first
release.** · Owner: supervisor session · Written 2026-08-28
Run with: **sonnet, new session off `main`.**

## Why (and why the timing is rigid)

No production database exists yet — only test systems that reseed from empty. That makes
this the last free moment to flatten the 15-step migration history (00001–00015) into one
canonical schema: the instant a production database exists, history becomes immutable
forever. Fresh installs are this repo's audience (open-source reuse, golden rule 8); an
adopter bootstrapping an empty database should read one clean schema, not replay internal
decision churn (favorites lists added then dropped, the announcement model reworked twice,
keywords bolted on). Git keeps the history; it just stops executing.

**Preconditions before running the prompt below:**
1. Every migration-carrying PR that should ship in v1 is merged (at drafting time: #93 was
   still open — land it first; new migrations added after this drafting simply become part
   of the flatten).
2. Decide whether any test-system data is worth keeping. If an admin has hand-entered the
   real UOS catalog on a test system, take `pg_dump --data-only` of
   `services`/`service_categories`/`categories`/`role_defaults` (and `announcements` if
   wanted) BEFORE the wipe — that curation is exactly the "irreplaceable data" of docs/04 §5.
3. Every test/staging deployment gets reset (dropped volume) when this lands — announce it.

## The handoff prompt (paste verbatim into the coding session)

> Read CLAUDE.md and docs/specs/flatten-migrations.md. Flatten the goose migrations
> (00001 through the current highest) into a single `migrations/00001_init.sql` as the v1
> baseline — no production database exists, only reseedable test systems, so history replay
> has no consumers. Requirements:
> - The new file is the one canonical schema: tables in dependency order, indexes with
>   their tables, comments consolidated — keep the load-bearing doc comments (the
>   announcement-singleton semantics, the sessions/BFF notes, the soft-delete rationale),
>   drop superseded churn. Include a matching `-- +goose Down`.
> - **Prove equivalence mechanically**: apply the old chain to a fresh Postgres and
>   `pg_dump --schema-only`; apply the new single file to another fresh Postgres and dump
>   again; the diff must be empty apart from goose's version bookkeeping. Script the
>   comparison (don't hand-verify) and paste the diff evidence in the PR body.
> - Delete the old migration files. sqlc regenerates cleanly; `dev/seed.sql` still applies;
>   `AUTO_MIGRATE` startup behavior is unaffected for a fresh database.
> - Update everything that references migration numbers by name — docs/02 §4 cites
>   00007/00011/00012, and grep the repo (docs/, README, comments) for other `000NN`
>   references. CLAUDE.md's goose/forward-only convention stays: it applies from this new
>   baseline.
> - Header note in the new file: flattened pre-v1 baseline, prior history in git; all
>   future changes are new numbered migrations.
> - Full gates green including the DB-backed integration tests and `make e2e` (both
>   exercise the real migrated schema).
> - State in the PR body, prominently: merging this requires resetting every existing
>   test/staging database (dropped volume).
> - No Claude attribution in commits. Leave the PR unmerged — the user decides merge
>   timing (after any data worth keeping is dumped, before the v1 tag).
