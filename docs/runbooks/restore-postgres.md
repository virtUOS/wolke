# Runbook: restore PostgreSQL from backup

> **Backups now exist.** `compose.prod.yaml` ships an opt-in `backup` service
> (profile `backup`) that runs `pg_dump -Fc` and pushes it to a **restic**
> repository — an S3 bucket in the tested setup — then applies a
> `restic forget --prune` retention policy. See **README → Backups** for how to
> enable and configure it. This runbook restores from one of those snapshots
> (§ *Restore from a restic snapshot*), and still covers restoring from a bare
> dump file you took by hand (§ *Fallback: restore from a bare dump file*).
>
> If you are reading this and the `backup` service was never enabled for this
> deployment, there is no snapshot to restore — say so in the incident channel
> early rather than late, and go to the fallback section with whatever artifact
> you do have.

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

- Either a restic snapshot taken by the `backup` service, **or** a `pg_dump`
  artifact of the `wolke` database that you have on hand.
- The compose stack this runbook assumes: `compose.yaml` (staging/build-from-source)
  or `compose.prod.yaml` (production, pulls `ghcr.io/<owner>/<repo>:$WOLKE_VERSION`).
  Both define a `postgres` service (`postgres:17`, database `wolke`, user
  `wolke`, named volume `pgdata` mounted at `/var/lib/postgresql/data`) and an
  `app` service that talks to it over the internal `backend` network — Postgres
  is never published to the host in either file.
- For the restic path: the same `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` and S3
  credentials the backup service used, in the `.env` beside the compose file.
  **Without `RESTIC_PASSWORD` the snapshots cannot be decrypted by anyone,
  including you.**
- `docker compose` (or `podman-compose` — swap the binary, same flags) run
  from the directory containing the compose file and its `.env`.

---

## Restore from a restic snapshot

Every command below runs inside the `backup` service's container: it already
has `pg_restore` at the right major version, the repository credentials, and
network reach to both S3 and Postgres. `run --rm` starts a throwaway one, which
is why each invocation re-installs `restic` first (a few seconds).

1. **Stop the app so it stops writing during the restore** (Postgres itself can
   stay up):
   ```bash
   docker compose -f compose.prod.yaml stop app
   ```

2. **List what you can restore from.** Confirm the timestamps look like you
   expect *before* you touch the database:
   ```bash
   docker compose -f compose.prod.yaml --profile backup \
     run --rm --entrypoint sh backup -c \
     'apk add --no-cache restic >/dev/null 2>&1; restic snapshots --tag wolke-db'
   ```
   ```
   ID        Time                 Host    Tags      Paths                             Size
   ------------------------------------------------------------------------------------------
   070cad28  2026-08-28 12:49:26  wolke   wolke-db  /tmp/wolke-20260828T124926Z.dump  33.168 KiB
   584ca89b  2026-08-28 12:54:34  wolke   wolke-db  /tmp/wolke-20260828T125434Z.dump  33.168 KiB
   ```
   Pick a snapshot **from before the incident**. If you just want the newest,
   the ID `latest` works everywhere an ID does.

3. **Restore the dump and load it, in one container.** The restored file only
   exists inside the throwaway container's `/tmp`, so fetching it and running
   `pg_restore` must happen in the same command:
   ```bash
   SNAPSHOT=584ca89b   # or: latest

   docker compose -f compose.prod.yaml --profile backup \
     run --rm --entrypoint sh backup -c '
       set -e
       apk add --no-cache restic >/dev/null 2>&1
       restic restore '"$SNAPSHOT"' --target /tmp/restore
       dump=$(find /tmp/restore -name "*.dump" | head -1)
       echo "restoring $dump ($(wc -c <"$dump") bytes)"
       psql -d postgres -c "drop database if exists wolke;" \
                        -c "create database wolke owner wolke;"
       pg_restore -d wolke --no-owner "$dump"
     '
   ```
   `drop database` fails if anything is still connected — that is what step 1
   was for. If it complains anyway, find the stragglers with
   `psql -d postgres -c "select pid, application_name from pg_stat_activity where datname = 'wolke';"`.

   If the snapshot predates the current migration set, this restores the schema
   as it was *at backup time*; the next step applies anything newer,
   forward-only, automatically.

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
   Then work through *Verify the restore actually worked* below — do not skip it.

6. **Bring the backup service back** if you stopped it, and confirm the next
   cycle succeeds so you are not now running unprotected:
   ```bash
   docker compose -f compose.prod.yaml --profile backup up -d backup
   docker compose -f compose.prod.yaml --profile backup logs -f backup   # expect: backup cycle ok
   ```

### If the whole `pgdata` volume is gone

Nothing changes except that step 3's `drop database` is a no-op: bring
`postgres` up on a fresh volume first (it creates an empty `wolke` database
from `POSTGRES_DB`), then run step 3 as written.

```bash
docker compose -f compose.prod.yaml up -d postgres
```

---

## Fallback: restore from a bare dump file

Use this when you have a dump artifact on the host rather than a restic
snapshot — one you took by hand, or one pulled out of the repository elsewhere.

1. **Stop the app:**
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
   custom-format (`-Fc`) dump needs `pg_restore`. The `backup` service produces
   custom format:

   Custom-format dump (`-Fc`, what the backup service writes):
   ```bash
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d postgres -c "drop database wolke;" -c "create database wolke owner wolke;"
   docker compose -f compose.prod.yaml exec -T postgres \
     pg_restore -U wolke -d wolke --no-owner /tmp/wolke-backup.dump
   ```

   Plain SQL dump:
   ```bash
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d postgres -c "drop database wolke;" -c "create database wolke owner wolke;"
   docker compose -f compose.prod.yaml exec -T postgres \
     psql -U wolke -d wolke -f /tmp/wolke-backup.dump
   ```

4. **Start the app back up** and watch the logs, exactly as in steps 4–5 above:
   ```bash
   docker compose -f compose.prod.yaml up -d app
   docker compose -f compose.prod.yaml logs -f app
   ```

---

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
bind mount — if the restore step goes wrong mid-way, the safest recovery is to
`docker compose down` the `postgres` service, remove and recreate the `pgdata`
volume from a filesystem-level snapshot if you have one, or simply re-run the
restore: both paths above start with a fresh `create database`, so repeating
them is safe and idempotent. Do not attempt partial row-level surgery on a
half-restored database under incident pressure — recreate the database and
restore cleanly again.

A restic snapshot is immutable and stays put whatever happens here, so you can
retry the restore as many times as you need; nothing you do to the database
can damage the backup.
