#!/usr/bin/env bash
# Export podcasts.db for the site (pipeline/export.py) and put it live on the
# server: upload serve.db next to the live one, then rawi-activate (see
# deploy/activate.sh) switches to it, restarts the API and checks it, or
# switches back. Run after scripts/update.sh and pipeline.embed.
#
# Uploads go to data/incoming first, so an interrupted one resumes, and the
# live serve.db is rsync's basis, so only changed blocks are sent.
# The server is the `rawi` host in ~/.ssh/config unless RAWI_HOST is set.
# Usage: scripts/deploy-data.sh [--no-export]
set -euo pipefail

cd "$(dirname "$0")/.."

HOST=${RAWI_HOST:-rawi}
DATA=/srv/rawi/data

if [[ ${1:-} != --no-export ]]; then
  .venv/bin/python -m pipeline.export
fi
[[ -f serve.db ]] || { echo "no serve.db: run without --no-export" >&2; exit 1; }

ssh "$HOST" mkdir -p "$DATA/incoming"
rsync --partial --times --compress --info=progress2 --chmod=F644 \
  --copy-dest="$DATA/current" serve.db "$HOST:$DATA/incoming/"

stamp=$(date +%Y%m%d-%H%M%S)
ssh "$HOST" "mv -T $DATA/incoming $DATA/$stamp && rawi-activate data $DATA/$stamp"
