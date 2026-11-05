#!/usr/bin/env bash
# List every video on each channel's Videos tab (no Shorts) without downloading.
# Writes survey/<handle>.tsv with: id, duration (s), channel, title.
# Channels already surveyed are skipped, so re-running resumes.
# Usage: scripts/survey_channels.sh CHANNELS_FILE
set -uo pipefail

cd "$(dirname "$0")/.."
mkdir -p survey

while read -r url; do
  [[ -z "$url" ]] && continue
  handle="${url##*/}"
  out="survey/$handle.tsv"
  [[ -s "$out" ]] && continue
  .venv/bin/yt-dlp --js-runtimes node --flat-playlist --sleep-requests 1 \
    --print "%(id)s	%(duration)s	%(channel,playlist_channel,playlist_uploader)s	%(title)s" \
    "$url/videos" > "$out.part" 2> "survey/$handle.err" \
    && mv "$out.part" "$out"
  echo "$handle: $(wc -l < "${out}" 2>/dev/null || echo FAILED)"
  sleep 3
done < "$1"
