#!/usr/bin/env bash
# Resume scripts/download_channels.sh with every channel in
# logs/channels_batch1.txt that hasn't finished yet (plus Mazeej, to retry its
# rate-limited videos). done.txt makes each channel pick up where it stopped.
# Usage: scripts/resume_channels.sh
set -euo pipefail

cd "$(dirname "$0")/.."

grep ' done ' logs/channels_runner.log | awk '{print $4}' | sort -u > logs/channels_done.txt
{ grep -vFf logs/channels_done.txt logs/channels_batch1.txt
  echo "https://www.youtube.com/@MazeejStudios"
} | awk '!seen[$0]++' > logs/channels_batch1_rest.txt

echo "$(date '+%F %T') resuming $(wc -l < logs/channels_batch1_rest.txt) channels" >> logs/channels_runner.log
exec scripts/download_channels.sh logs/channels_batch1_rest.txt >> logs/channels_runner.log 2>&1
