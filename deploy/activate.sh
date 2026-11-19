#!/usr/bin/env bash
#
# activate.sh — switch the site to a new release or data export, on the server
#
# Points /srv/rawi/current (release) or /srv/rawi/data/current (data) at DIR,
# restarts the API and waits for /api/health to report semantic search. If it
# doesn't come up, points the link back at what it was and restarts again.
# Then removes all but the newest few. Installed as /usr/local/bin/rawi-activate
# by ansible/app.yml; run by the GitHub deploy workflow and scripts/deploy-data.sh.
#
# Usage:
#   rawi-activate release /srv/rawi/releases/<sha>
#   rawi-activate data /srv/rawi/data/<timestamp>
#
set -euo pipefail

ROOT=/srv/rawi
HEALTH=http://127.0.0.1:3000/api/health
KEEP_RELEASES=5
KEEP_DATA=2 # each export is ~1.4 GB

kind=${1:?usage: rawi-activate release|data DIR}
target=$(realpath "${2:?usage: rawi-activate release|data DIR}")
case $kind in
  release) link=$ROOT/current; parent=$ROOT/releases; keep=$KEEP_RELEASES ;;
  data) link=$ROOT/data/current; parent=$ROOT/data; keep=$KEEP_DATA ;;
  *) echo "unknown kind: $kind" >&2; exit 2 ;;
esac
[[ $(dirname "$target") == "$parent" ]] || { echo "$target is not in $parent" >&2; exit 2; }

point() {
  ln -sfn "$1" "$link.tmp"
  mv -T "$link.tmp" "$link"
}

healthy() {
  for _ in $(seq 60); do
    if curl -fsS --max-time 2 "$HEALTH" 2>/dev/null | grep -q '"semantic":true'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

previous=$(readlink "$link" || true)
touch "$target" # newest, so pruning keeps it even if it's an older commit
point "$target"
echo "$link -> $target"

# Until both a release and data are in place there's nothing to start.
if [[ ! -e $ROOT/current || ! -e $ROOT/data/current ]]; then
  echo "no $( [[ -e $ROOT/current ]] && echo data || echo release ) yet: not starting the API"
  exit 0
fi

sudo -n systemctl restart rawi
if healthy; then
  echo "healthy: $(curl -fsS "$HEALTH")"
else
  echo "the API didn't come up healthy; recent logs:" >&2
  sudo -n journalctl -u rawi -n 30 --no-pager >&2 || true
  if [[ -n $previous && -e $previous ]]; then
    echo "rolling back to $previous" >&2
    point "$previous"
    sudo -n systemctl restart rawi
    healthy && echo "rolled back" >&2 || echo "and the rollback isn't healthy either" >&2
  fi
  exit 1
fi

# Newest first by modification time, never the one now live or an upload.
find "$parent" -mindepth 1 -maxdepth 1 -type d ! -name incoming -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- \
  | grep -vxF "$target" | tail -n +"$keep" | while read -r old; do
    echo "removing $old"
    rm -rf "$old"
  done
