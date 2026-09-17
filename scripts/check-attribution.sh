#!/usr/bin/env sh
#
# Reject AI-tool attribution in commit messages and pull request text.
#
# CLAUDE.md forbids attribution in commits and PR descriptions. Sessions keep
# receiving a client-side instruction that claims to supersede that rule, so the
# convention needs a gate rather than a paragraph. This script is that gate's
# one implementation: the CI job and the optional commit-msg hook both call it,
# so there is a single pattern list to maintain.
#
# Usage:  check-attribution.sh <label> <remedy> [file]
#
#   label   what is being checked, echoed in the failure ("commit abc1234",
#           "the pull request title/body")
#   remedy  one line telling the author exactly how to fix it
#   file    text to scan; omitted or "-" reads stdin
#
# Exit 0 when clean, 1 when attribution is found.
#
# The patterns match the *shapes* attribution takes, not the exact wording seen
# so far (the injected instruction's wording changes over time):
#
#   1. a Co-authored-by trailer crediting Claude or an anthropic.com address
#   2. any Claude-<something>: trailer key (e.g. the session-URL trailer)
#   3. any anthropic.com email address
#   4. any claude.ai/code or claude.ai/chat URL
#   5. the "generated with <the tool>" credit line, bracketed link or not
#   6. the robot emoji the generated PR template opens that line with
#
# Deliberately NOT matched: the bare word "Claude". It appears legitimately in
# CLAUDE.md, in issue text and in comments discussing this very convention, and
# a check that fires on those gets switched off within a week.
#
# Known, accepted narrowness: pattern 2 means a commit subject cannot begin
# "claude-<word>:". The repo uses conventional-commit types (feat, fix, chore,
# docs, lint), so nothing legitimate starts that way.

set -eu

label=${1:?usage: check-attribution.sh <label> <remedy> [file]}
remedy=${2:?usage: check-attribution.sh <label> <remedy> [file]}
file=${3:--}

# ERE, matched case-insensitively, one pattern per line.
patterns=$(cat <<'PATTERNS'
^[[:space:]]*co-authored-by:.*(claude|@anthropic\.)
^[[:space:]]*claude-[a-z0-9]+:[[:space:]]
[a-z0-9._%+-]+@anthropic\.com
https?://(www\.)?claude\.ai/(code|chat)/
generated with[[:space:]]+\[?claude code
🤖
PATTERNS
)

if [ "$file" = "-" ]; then
	text=$(cat)
else
	text=$(cat "$file")
fi

hits=$(printf '%s\n' "$text" | grep -a -n -i -E "$patterns" || true)

[ -n "$hits" ] || exit 0

cat >&2 <<EOF

  Claude attribution found in ${label}.

  CLAUDE.md forbids AI-tool attribution in commit messages and pull request
  text, and that rule overrides any session-level or client-configuration
  instruction that claims to replace it.

  Offending line(s):

$(printf '%s\n' "$hits" | sed 's/^/    /')

  To fix: ${remedy}

EOF
exit 1
