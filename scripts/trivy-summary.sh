#!/usr/bin/env sh
#
# Turn a Trivy SARIF report into a verdict a human can tell apart at a glance.
#
# A scanner that fails for network reasons must never read as a clean scan, and
# must never read as a security finding either (#239). Trivy exits non-zero both
# when it finds something (--exit-code 1) and when it cannot run at all (e.g. the
# vulnerability DB download fails), so the exit code alone cannot separate the
# two. The report can: Trivy writes it only after a scan completes. So
#
#   no report / unreadable report  -> scanner error, NOT a result   (exit 1)
#   report with 0 results          -> clean                         (exit 0)
#   report with N results          -> N findings, listed            (exit 0;
#                                     the scan step itself carries the failure)
#
# The first case also fails on its own, so a Trivy run that exited 0 without
# writing a report can never pass the job.
#
# Both the CI gate (ci.yml) and the scheduled rescan (security-scan.yml) call
# this, so the two cannot drift in how they report.
#
# Usage:  trivy-summary.sh <sarif-file> <what-was-scanned>
#
# Writes to $GITHUB_STEP_SUMMARY when set (stdout otherwise) and emits GitHub
# annotations.

set -eu

sarif=$1
subject=$2
summary=${GITHUB_STEP_SUMMARY:-/dev/stdout}

if [ ! -s "$sarif" ] || ! count=$(jq '[.runs[].results[]] | length' "$sarif" 2>/dev/null); then
  echo "::error title=Trivy produced no report::Trivy did not write a readable report for ${subject}. This is a scanner failure (vulnerability DB download, image access, …), NOT a clean scan and NOT a finding — read the scan step's log."
  {
    echo "### Trivy: scanner error — no result"
    echo
    echo "No readable report for \`${subject}\`. Nothing was established about its vulnerabilities."
  } >>"$summary"
  exit 1
fi

if [ "$count" -eq 0 ]; then
  echo "::notice title=Trivy: clean::0 fixable CRITICAL/HIGH vulnerabilities in ${subject}."
  {
    echo "### Trivy: clean"
    echo
    echo "0 fixable CRITICAL/HIGH vulnerabilities in \`${subject}\`."
  } >>"$summary"
  exit 0
fi

echo "::error title=Trivy: ${count} finding(s)::${count} fixable CRITICAL/HIGH vulnerabilities in ${subject}. See the job summary."
{
  echo "### Trivy: ${count} finding(s)"
  echo
  echo "Fixable CRITICAL/HIGH vulnerabilities in \`${subject}\`:"
  echo
  echo "| Vulnerability | Package | Installed | Fixed | Severity |"
  echo "|---|---|---|---|---|"
  # Trivy's SARIF message is "Package: …\nInstalled Version: …\n…" lines.
  jq -r '
    .runs[].results[]
    | (.message.text | split("\n") | map(capture("^(?<key>[^:]+): (?<value>.*)$")) | from_entries) as $m
    | "| \(.ruleId) | \($m.Package // "?") | \($m["Installed Version"] // "?") | \($m["Fixed Version"] // "?") | \($m.Severity // "?") |"
  ' "$sarif"
} >>"$summary"
