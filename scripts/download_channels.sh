#!/usr/bin/env bash
# Download Arabic transcripts for every 20+ minute video on each channel's
# Videos tab, one channel at a time, into data/<channel name>/.
# If YouTube rate-limits or asks for a bot check, stop, wait, and retry the
# channel; done.txt makes every retry/re-run resume where it left off.
# If the first $probe new videos of a channel (newest first) all lack Arabic
# captions (auto or human-made), skip the rest of it and log it to
# logs/channels_no_captions.txt.
# Usage: scripts/download_channels.sh CHANNELS_FILE
set -uo pipefail

cd "$(dirname "$0")/.."

min_duration=1200
backoff=7200
probe=40
# Not "Sign in to confirm your age", which is just one age-restricted video.
blocked='HTTP Error 429|confirm you.re not a bot|rate-limited by YouTube'

# True when the log shows >= $probe info.json files and none of them list an
# Arabic track.
no_captions() {
  local paths
  mapfile -t paths < <(sed -n 's/^\[info\] Writing video metadata as JSON to: //p' "$1")
  (( ${#paths[@]} >= probe )) || return 1
  local f
  for f in "${paths[@]}"; do
    [[ -e "$f" ]] && jq -e '.automatic_captions["ar-orig"] or .subtitles.ar' "$f" >/dev/null && return 1
  done
  return 0
}

while read -r url; do
  [[ -z "$url" ]] && continue
  handle="${url##*/}"
  log="logs/channel_$handle.log"
  while true; do
    echo "$(date '+%F %T') start $handle"
    # Only check output from this attempt; the log may hold an earlier run.
    skip=$(( $(cat "$log" 2>/dev/null | wc -l) + 1 ))
    DIR_TEMPLATE='%(channel)s' scripts/download_subs.sh \
      --match-filter "duration >= $min_duration" "$url/videos" >> "$log" 2>&1 &
    pid=$!
    hit=0
    while kill -0 "$pid" 2>/dev/null; do
      sleep 30
      if tail -n +"$skip" "$log" | grep -qE "$blocked"; then
        hit=1
        pkill -P "$pid"; kill "$pid" 2>/dev/null
        break
      fi
      if no_captions <(tail -n +"$skip" "$log"); then
        echo "$(date '+%F %T') no captions in first $probe videos of $handle, skipping rest"
        echo "$handle" >> logs/channels_no_captions.txt
        # Stop pass 1 only; download_subs.sh still runs pass 3 to clean up.
        pkill -P "$pid"
        break
      fi
    done
    wait "$pid" 2>/dev/null
    (( hit )) || break
    echo "$(date '+%F %T') blocked on $handle, sleeping ${backoff}s"
    mv "$log" "$log.blocked.$(date +%s)"
    sleep "$backoff"
  done
  echo "$(date '+%F %T') done $handle"
done < "$1"
