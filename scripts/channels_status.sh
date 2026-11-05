#!/usr/bin/env bash
# Progress of scripts/download_channels.sh.
cd "$(dirname "$0")/.."
echo "channels done: $(grep ' done ' logs/channels_runner.log | awk '{print $4}' | sort -u | wc -l) / $(grep -c . logs/channels_batch1.txt)"
echo "blocks: $(grep -c ' blocked ' logs/channels_runner.log)"
grep -E ' (start|blocked) ' logs/channels_runner.log | tail -1
echo "archived: $(wc -l < done.txt)"
echo "rate-limited videos: $(cat logs/channel_*.log 2>/dev/null | grep -c 'rate-limited by YouTube')"
echo "other errors: $(cat logs/channel_*.log 2>/dev/null | grep '^ERROR' | grep -vcE 'Private video|unavailable|members-only|Premieres|confirm your age|rate-limited by YouTube')"
