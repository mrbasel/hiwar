#!/usr/bin/env bash
# Replace the server's database with one exported from podcasts.db
# (pipeline/export.py): upload rawi.db next to the live one, then
# rawi-activate (see deploy/activate.sh) switches to it, restarts the API and
# checks it, or switches back.
#
# Once seeded, the server's database is the source of truth: whatever it got
# since (episodes the downloader sent, download state) is lost unless
# podcasts.db has it too. So this is for seeding it and for bulk rebuilds;
# pause the downloader while it runs. New episodes go in with rawi-ingest.
#
# Uploads go to data/incoming first, so an interrupted one resumes, and the
# live rawi.db is rsync's basis, so only changed blocks are sent.
# The server is the `rawi` host in ~/.ssh/config unless RAWI_HOST is set.
# Usage: scripts/deploy-data.sh [--no-export] [--no-activate]
set -euo pipefail

cd "$(dirname "$0")/.."

HOST=${RAWI_HOST:-rawi}
DATA=/srv/rawi/data
export=1 activate=1
for arg in "$@"; do
  case $arg in
    --no-export) export=0 ;;
    --no-activate) activate=0 ;;
    *) echo "usage: $0 [--no-export] [--no-activate]" >&2; exit 2 ;;
  esac
done

if ((export)); then
  .venv/bin/python -m pipeline.export
fi
[[ -f rawi.db ]] || { echo "no rawi.db: run without --no-export" >&2; exit 1; }

# Group-writable: rawi-writer keeps its write-ahead log next to the database.
ssh "$HOST" mkdir -p -m 2775 "$DATA/incoming"
rsync --partial --times --compress --info=progress2 --chmod=F664 \
  --copy-dest="$DATA/current" rawi.db "$HOST:$DATA/incoming/"

stamp=$(date +%Y%m%d-%H%M%S)
ssh "$HOST" mv -T "$DATA/incoming" "$DATA/$stamp"
if ((activate)); then
  ssh "$HOST" rawi-activate data "$DATA/$stamp"
else
  echo "uploaded to $DATA/$stamp; put it live with: rawi-activate data $DATA/$stamp"
fi
