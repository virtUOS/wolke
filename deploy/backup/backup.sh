#!/bin/sh
#
# wolke Postgres → restic → S3 backup loop.
#
# Runs in the `backup` compose profile (see compose.prod.yaml). Deliberately
# boring: one POSIX shell loop, no cron daemon, no orchestration tooling. Each
# cycle is
#
#   pg_dump -Fc  →  /tmp/<db>-<utc timestamp>.dump  →  restic backup  →  restic forget --prune
#
# Design rules:
#   * Nothing institution-specific lives here — every knob is an env var.
#   * It NEVER fails silently. Any error is logged at ERROR and the process
#     exits non-zero so the container's restart policy makes it visible (a
#     crash-looping `backup` container is the alarm). A cycle is only reported
#     as ok when pg_dump, restic backup and restic forget all succeeded.
#
set -eu

log() { printf '%s %-5s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"; }
info() { log INFO "$1"; }
# Summarise restic's stderr: its Fatal lines, else the tail of the noise.
restic_err() {
  out=$(grep -iE "^Fatal|^error|retrying after" "$1" \
        | sed -E "s/.*retrying after [^:]+: //" | sort -u | tail -3 | tr "\n" ";")
  [ -n "$out" ] || out=$(tr "\n" ";" <"$1" | tail -c 300)
  printf '%s' "$out"
}
die() { log ERROR "$1"; log ERROR "backup cycle FAILED — no snapshot was written; exiting so the restart policy surfaces this"; exit 1; }

# --- Required configuration (fail closed, loudly) --------------------------
missing=
for var in RESTIC_REPOSITORY RESTIC_PASSWORD PGHOST PGUSER PGPASSWORD PGDATABASE; do
  eval "value=\${$var:-}"
  [ -n "$value" ] || missing="$missing $var"
done
if [ -n "$missing" ]; then
  log ERROR "missing required environment:$missing"
  log ERROR "the backup service is enabled but not configured — refusing to start (see README → Backups)"
  exit 1
fi

# S3 repositories need credentials; other backends (rest:, sftp:, local paths)
# do not, so only insist on them when the repository URL is an s3: one.
case "$RESTIC_REPOSITORY" in
  s3:*)
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
      log ERROR "RESTIC_REPOSITORY is an s3: repository but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are unset"
      exit 1
    fi
    ;;
esac

# --- Optional configuration (documented defaults) --------------------------
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RUN_ON_START="${BACKUP_RUN_ON_START:-true}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
BACKUP_KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-6}"
BACKUP_TAG="${BACKUP_TAG:-wolke-db}"
BACKUP_RESTIC_VERSION="${BACKUP_RESTIC_VERSION:-}"

# restic needs a writable cache and a home; both live in the container's tmpfs.
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/tmp/restic-cache}"
export HOME=/tmp
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
mkdir -p "$RESTIC_CACHE_DIR"

# --- restic binary ---------------------------------------------------------
# The base image is postgres:*-alpine, so pg_dump/pg_restore match the server
# major version exactly (a pg_dump older than the server refuses to run). restic
# comes from the matching Alpine community repo at start-up rather than from a
# separately built image — one pinned image, no second build pipeline.
if ! command -v restic >/dev/null 2>&1; then
  info "installing restic from the Alpine community repository"
  if [ -n "$BACKUP_RESTIC_VERSION" ]; then
    apk add --no-cache "restic=$BACKUP_RESTIC_VERSION" || die "could not install restic=$BACKUP_RESTIC_VERSION"
  else
    apk add --no-cache restic || die "could not install restic (no network to the Alpine mirrors?)"
  fi
fi
info "restic $(restic version | awk '{print $2}'), $(pg_dump --version)"
info "repository=$RESTIC_REPOSITORY interval=${BACKUP_INTERVAL_SECONDS}s retention=daily:${BACKUP_KEEP_DAILY} weekly:${BACKUP_KEEP_WEEKLY} monthly:${BACKUP_KEEP_MONTHLY}"

# --- Repository ------------------------------------------------------------
# `restic cat config` is the cheapest "does this repository exist and can I open
# it" probe. It is wrapped in `timeout` because restic retries backend errors
# with exponential backoff for ~15 minutes — far too long to sit silently on a
# typo'd bucket name. Then the three failure classes are told apart explicitly,
# because they need different operator responses:
#   * unreachable / rejected  → configuration or network problem; fail hard.
#   * wrong password          → fail hard (initialising would hide the real repo).
#   * no repository yet       → initialise it (unless BACKUP_INIT_REPO=false).
probe_err=/tmp/restic-probe.err
if timeout "${BACKUP_PROBE_TIMEOUT:-45}" restic cat config >/dev/null 2>"$probe_err"; then
  info "repository opened"
elif grep -qiE 'connection refused|no such host|dial tcp|network is unreachable|i/o timeout|certificate' "$probe_err"; then
  log ERROR "cannot reach the backup repository: $(restic_err "$probe_err")"
  die "check RESTIC_REPOSITORY and that the S3 endpoint is reachable from the egress network"
elif grep -qiE 'access denied|forbidden|invalid access key|access key id|does not exist in our records|signaturedoesnotmatch|invalid argument' "$probe_err"; then
  log ERROR "the backup repository rejected our credentials: $(restic_err "$probe_err")"
  die "check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION"
elif grep -qiE 'wrong password|no key found' "$probe_err"; then
  log ERROR "RESTIC_PASSWORD does not open this repository"
  die "refusing to continue — a wrong password must never silently start a second repository"
elif grep -qiE 'unable to open config file|does not exist|no repository config' "$probe_err"; then
  if [ "${BACKUP_INIT_REPO:-true}" != "true" ]; then
    die "no repository at $RESTIC_REPOSITORY and BACKUP_INIT_REPO=false — run \`restic init\` yourself"
  fi
  info "no repository at $RESTIC_REPOSITORY yet — initialising it"
  timeout "${BACKUP_PROBE_TIMEOUT:-45}" restic init 2>>"$probe_err" \
    || die "restic init failed: $(restic_err "$probe_err")"
  info "repository initialised"
else
  log ERROR "cannot open the restic repository: $(restic_err "$probe_err")"
  die "check RESTIC_REPOSITORY, RESTIC_PASSWORD and the S3 credentials/endpoint"
fi

run_cycle() {
  dump="/tmp/${PGDATABASE}-$(date -u +%Y%m%dT%H%M%SZ).dump"
  info "pg_dump -Fc ${PGUSER}@${PGHOST}/${PGDATABASE} → ${dump}"
  pg_dump --format=custom --file="$dump" || die "pg_dump failed — is ${PGHOST} reachable and the password correct?"
  size=$(wc -c <"$dump" | tr -d ' ')
  [ "$size" -gt 0 ] || die "pg_dump produced an empty file"
  info "dump ok (${size} bytes)"

  info "restic backup --tag ${BACKUP_TAG}"
  restic backup --tag "$BACKUP_TAG" --host "${BACKUP_HOSTNAME:-wolke}" "$dump" || die "restic backup failed"

  info "restic forget --prune (keep daily:${BACKUP_KEEP_DAILY} weekly:${BACKUP_KEEP_WEEKLY} monthly:${BACKUP_KEEP_MONTHLY})"
  restic forget --tag "$BACKUP_TAG" \
    --keep-daily "$BACKUP_KEEP_DAILY" \
    --keep-weekly "$BACKUP_KEEP_WEEKLY" \
    --keep-monthly "$BACKUP_KEEP_MONTHLY" \
    --prune || die "restic forget --prune failed"

  rm -f "$dump"
  info "backup cycle ok"
}

if [ "$BACKUP_RUN_ON_START" = "true" ]; then
  run_cycle
else
  info "BACKUP_RUN_ON_START=false — waiting ${BACKUP_INTERVAL_SECONDS}s before the first backup"
fi

while true; do
  sleep "$BACKUP_INTERVAL_SECONDS"
  run_cycle
done
