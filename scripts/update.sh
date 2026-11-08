#!/usr/bin/env bash
# Download new episodes from every source in sources.toml and add them to
# podcasts.db (see pipeline/update.py). Meant to be run by a scheduler: if a
# previous run still holds the lock, exits at once. Output also goes to
# logs/update/<date>_<time>.log.
# Exit status: 0 ok, 2 stopped downloading on a rate limit, 1 errors.
# Usage: scripts/update.sh [--no-download] [--source URL] [--limit N] [--workers N]
#        scripts/update.sh --status
set -uo pipefail

cd "$(dirname "$0")/.."

if [[ " $* " == *" --status "* ]]; then
  exec .venv/bin/python -m pipeline.update "$@"
fi

mkdir -p logs/update
exec 9> logs/update/.lock
if ! flock -n 9; then
  echo "another update is still running" >&2
  exit 0
fi

.venv/bin/python -m pipeline.update "$@" 2>&1 | tee "logs/update/$(date +%F_%H%M%S).log"
exit "${PIPESTATUS[0]}"
