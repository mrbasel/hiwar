#!/bin/sh
#
# ingest.sh — pipeline/ingest.py from the live release, with the server's settings
#
# Installed as /usr/local/bin/rawi-ingest by ansible/app.yml. Runs as
# rawi-writer, the only user that writes the database:
#   sudo -u rawi-writer rawi-ingest plan
#   sudo -u rawi-writer rawi-ingest delete <video id>
# The downloader's ssh key runs it as a forced command (see pipeline/ingest.py).
#
set -eu
set -a
. /etc/rawi/pipeline.env
set +a
# The API's user shares the database through the deploy group.
umask 002
cd /srv/rawi/current
exec .venv/bin/python -m pipeline.ingest "$@"
