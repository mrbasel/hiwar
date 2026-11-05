#!/usr/bin/env bash
# Download Arabic captions (json3) + metadata for YouTube videos/playlists.
# Pass 1: auto-captions (ar-orig) + info.json for every video not in done.txt.
# Pass 2: human-made Arabic subtitles (ar) for any downloaded video whose
#         info.json lists them and that doesn't have an .ar.json3 yet.
# Pass 3: info.json files written this run for videos with no Arabic track at all
#         are logged to no_arabic_subs.txt and deleted (they stay in done.txt).
# Files go to data/<playlist title>/ (or data/<channel>/ for single videos);
# set DIR_TEMPLATE (a yt-dlp template) to override, e.g. '%(channel)s'.
# Extra yt-dlp options before the URLs apply to pass 1 only.
# Usage: scripts/download_subs.sh [YT-DLP OPTIONS] URL [URL...]
set -euo pipefail

cd "$(dirname "$0")/.."

started=$(mktemp)
trap 'rm -f "$started"' EXIT

common=(
  --js-runtimes node
  --skip-download --sub-format json3
  --sleep-requests 1.5 --sleep-subtitles 5
  --sleep-interval 5 --max-sleep-interval 15
  --ignore-errors
)

.venv/bin/yt-dlp "${common[@]}" \
  -o "data/${DIR_TEMPLATE:-%(playlist_title,channel)s}/%(upload_date)s_%(id)s.%(ext)s" \
  --write-auto-subs --sub-langs "ar-orig" \
  --write-info-json --no-write-playlist-metafiles \
  --download-archive done.txt --force-write-archive \
  "$@" || echo "pass 1 finished with errors (see above)" >&2

mapfile -d '' -t manual < <(
  find data -name '*.info.json' -print0 | while IFS= read -r -d '' f; do
    [[ -e "${f%.info.json}.ar.json3" ]] && continue
    jq -e '.subtitles.ar' "$f" >/dev/null && printf '%s\0' "$f"
  done
)

echo "pass 2: ${#manual[@]} video(s) with human-made Arabic subtitles to fetch" >&2
for f in "${manual[@]}"; do
  # Save next to the existing info.json; % is escaped for the output template.
  base="${f%.info.json}"
  .venv/bin/yt-dlp "${common[@]}" --write-subs --sub-langs ar \
    -o "${base//%/%%}.%(ext)s" "$(jq -r '.webpage_url' "$f")" \
    || echo "pass 2 failed for $f" >&2
done

# Only drop videos YouTube has no Arabic track for; failed downloads keep their
# info.json so pass 2 can retry them.
removed=0
while IFS= read -r -d '' f; do
  jq -e '.automatic_captions["ar-orig"] or .subtitles.ar' "$f" >/dev/null && continue
  jq -r --arg p "$(basename "$(dirname "$f")")" \
    '"\(.id)\t\(.upload_date)\t\(.duration)\t\($p)"' "$f" >> no_arabic_subs.txt
  rm -- "$f"
  removed=$((removed + 1))
done < <(find data -name '*.info.json' -newer "$started" -print0)
echo "pass 3: removed $removed video(s) with no Arabic transcript" >&2
