# Runbook: restore PostgreSQL from backup

> **Gap: there is no automated backup job in this repo.** `docs/04` §5 lists
> "regular Postgres backups + a tested restore" as an aspiration, but a repo
> search (scripts/, `.github/workflows/`, `deploy/`, the compose files, the
> Makefile) turns up no `pg_dump`/`pg_basebackup` invocation, no cron config,
> and no backup target anywhere. Today, data durability rests entirely on the
> `pgdata` Docker/Podman volume never being lost. **This runbook restores from
> whatever backup artifact the operator already has** (e.g. a `pg_dump` file
> you took manually or via ad hoc infra tooling) — it does not create one for
> you. Setting up a scheduled backup job is tracked as a gap, not solved here;
> flag it if you're reading this because you just realized there's no backup
> to restore from.

## What's irreplaceable

Per `docs/04` §5: **the catalog (services, categories, role defaults) and
favorites are the irreplaceable data.** Everything else regenerates or is
disposable:
- `announcements` / `audit_log` — historical, nice to keep, not load-bearing.
- `click_events` / `usage_daily` — analytics, already subject to a retention
  purge; losing them is not an incident.
- `sessions` — ephemeral; users just log in again.
- `users` — re-populated from OIDC claims on next login (the row is created
  on first login), **except** that any admin's `is_admin` history and prior
  audit-log `actor_id` references are lost if the `users` table isn't
  restored along with everything else — restore the whole database, not a
  hand-picked subset of tables, unless you have a specific reason not to.

## Prerequisites

- A `pg_dump` (or `pg_basebackup`/base backup) artifact of the `wolke`
  database, taken while the schema was at a known-good migration.
- The compose stack this runbook assumes: `compose.yaml` (staging/build-from-source)
  or `compose.prod.yaml` (production, pulls `ghcr.io/<owner>/<repo>:$WOLKE_VERSION`).
  Both define a `postgres` service (`postgres:17`, database `wolke`, user
  `wolke`, named volume `pgdata` mounted at `/var/lib/postgresql/data`) and an
  `app` service that talks to it over the internal `backend` network — Postgres
  is never published to the host in either file.
- `docker compose` (or `podman-compose` — swap the binary, same flags) run
  from the directory containing the compose file and its `.env`.

## Steps

1. **Stop the app so it stops writing during the restore** (Postgres itself
   can stay up):
   ```bash
   docker compose -f compose.prod.yaml stop app
   ```

2. **Copy the dump file into the postgres container** (or mount it — either
   works; `cp` is simplest for a one-off):
   ```bash
   docker compose -f compose.prod.yaml cp ./wolke-backup.dump postgres:/tmp/wolke-backup.dump
   ```

3. **Drop and recreate the database inside the container**, then restore.
   Adjust for your dump's format — a plain-SQL `pg_dump` needs `psql`, a
   custom-format (`-Fc`) dump needs `pg_restore`:

   Plain SQL dump:
   ```bash
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d postgres -c "drop database wolke;" -c "create database wolke owner wolke;"
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d wolke -f /tmp/wolke-backup.dump
   ```

   Custom-format dump:
   ```bash
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d postgres -c "drop database wolke;" -c "create database wolke owner wolke;"
   docker compose -f compose.prod.yaml exec -T postgres \
     pg_restore -U wolke -d wolke --no-owner /tmp/wolke-backup.dump
   ```

   If the backup predates the current migration set, this restores the schema
   as it was *at backup time* — the next step (starting `app`) applies any
   migrations that landed since, forward-only, automatically.

4. **Start the app back up.** It applies any pending migrations itself on
   startup (advisory-locked, so it's safe even with multiple replicas):
   ```bash
   docker compose -f compose.prod.yaml up -d app
   ```

5. **Watch it come up clean:**
   ```bash
   docker compose -f compose.prod.yaml logs -f app
   ```
   Look for the startup/migration lines and the absence of connection errors.

## Verify the restore actually worked

Don't declare victory on "the containers are up" — check the data is real:

1. **Readiness probe** (pings the DB pool, not just "process started"):
   ```bash
   curl -fsS https://<your-public-url>/readyz
   # expect: {"status":"ready"}
   ```
   (`/healthz` only reports the process is alive, not that the DB is
   reachable — use `/readyz` for this check.)

2. **Row counts on the irreplaceable tables**, sanity-checked against what
   you expect from the backup's vintage:
   ```bash
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d wolke -c \
     "select 'services' t, count(*) from services where is_active
      union all select 'categories', count(*) from categories
      union all select 'role_defaults', count(*) from role_defaults
      union all select 'favorites', count(*) from favorites
      union all select 'users', count(*) from users;"
   ```
   Zero rows in `services`/`categories` where you expected a populated
   catalog is the signature of a restore that silently no-op'd (e.g. wrong
   database name, or the dump/restore commands above targeted the wrong DB).

3. **The app actually renders the catalog**: log in as a normal user and
   confirm the dashboard shows the expected services and that at least one
   known admin can still reach **Administration**. If favorites matter for
   this incident, log in as a user known to have had favorites pre-incident
   and check they're still pinned.

4. **Check `/api/admin/audit`** (or the Audit tab) shows history up to the
   backup's timestamp and nothing implausible after it — a quick tripwire for
   "did I restore the dump I meant to."

## If restore fails partway

`postgres` in both compose files uses a **named volume** (`pgdata`), not a
bind mount — if step 3 goes wrong mid-restore, the safest recovery is to
`docker compose down` the `postgres` service, remove and recreate the
`pgdata` volume from a filesystem-level snapshot if you have one, or start
over from step 2 with a fresh `create database`. Do not attempt partial
row-level surgery on a half-restored database under incident pressure —
recreate the database and restore cleanly again.
