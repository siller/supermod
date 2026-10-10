#!/usr/bin/env bash
# Usage: scripts/check-calls.sh <plugin-dir>
# Runs `claude plugin validate` and fails when ./register.tsx calls a `$` member
# outside the allow list, or when the validator reports any env access.
set -u

ALLOWED='
$.command.register
$.ui.open
$.ui.close
$.ui.resolve
$.ui.toast
$.ui.panes
$.session.usage
$.session.surfaces
$.session.root
$.agent.list
$.clock.now
$.clock.every
$.clock.after
$.fs.read
$.fs.stat
$.fs.list
$.state.get
$.state.set
'

dir="${1:-.}"
out="$(claude plugin validate "$dir" 2>&1)"

if printf '%s\n' "$out" | grep -qE 'env (reads|writes):'; then
  echo "env access reported by the validator:" >&2
  printf '%s\n' "$out" | grep -E 'env (reads|writes):' >&2
  exit 1
fi

line="$(printf '%s\n' "$out" | grep -E '^[[:space:]]*❯ \./register\.tsx calls:' | head -n 1)"
if [ -z "$line" ]; then
  echo "calls ok (no calls reported)"
  exit 0
fi

calls="$(printf '%s\n' "$line" | sed -e 's/^.*calls:[[:space:]]*//' -e 's/([^)]*)//g' | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$')"

bad=""
while IFS= read -r call; do
  if ! printf '%s\n' "$ALLOWED" | grep -qxF -- "$call"; then
    bad="$bad $call"
  fi
done <<CALLS
$calls
CALLS

if [ -n "$bad" ]; then
  echo "calls outside the allow list:$bad" >&2
  exit 1
fi
echo "calls ok"
