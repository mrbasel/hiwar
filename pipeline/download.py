"""Download Arabic captions + metadata with yt-dlp, and classify what came back.

A source is a channel (its Videos tab) or a playlist. For each video of at
least MIN_DURATION, yt-dlp writes `<folder>/<upload date>_<id>.info.json` and
the Arabic auto captions (`.ar-orig.json3`); human-made Arabic subtitles
(`.ar.json3`) take a second call, made only when the metadata lists them.
Channels go to `data/<channel>/`, playlists to `data/<playlist title>/`,
unless the source sets its own folder.

Videos already in the database are skipped through a yt-dlp archive file
written from the `videos` table; yt-dlp checks it against the channel listing,
so known videos cost no requests. Videos younger than CAPTION_DELAY are left
for a later run, since YouTube adds auto captions some hours after upload.

yt-dlp is stopped as soon as YouTube rate-limits or asks for a bot check.
"""

import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from .parse import TRANSCRIPT_SOURCES, base_of

YT_DLP = Path(sys.executable).with_name("yt-dlp")
MIN_DURATION = 20 * 60
CAPTION_DELAY = 24 * 3600
# Where each caption track is listed in info.json.
LISTED_IN = {"ar": "subtitles", "ar-orig": "automatic_captions"}
# Not "Sign in to confirm your age", which is just one age-restricted video.
BLOCKED = re.compile(r"HTTP Error 429|confirm you.re not a bot|rate-limited by YouTube")
LISTING_FAILED = re.compile(r"^ERROR: \[youtube:tab\]")
INFO_WRITTEN = re.compile(r"^\[info\] Writing video metadata as JSON to: (.+)$")
INFO_NAME = re.compile(r"^(?:\d{8}|NA)_(.+)\.info\.json$")

COMMON = [
    "--js-runtimes", "node",
    "--skip-download", "--sub-format", "json3",
    "--sleep-requests", "1.5", "--sleep-subtitles", "5",
    "--sleep-interval", "5", "--max-sleep-interval", "15",
    "--ignore-errors", "--no-write-playlist-metafiles",
]


@dataclass
class Run:
    written: list = field(default_factory=list)  # info.json paths
    blocked: bool = False
    listing_failed: bool = False
    no_captions: bool = False  # stopped by the `probe` check


def video_id(info_path):
    m = INFO_NAME.match(Path(info_path).name)
    return m and m[1]


def has_arabic(info):
    return any(t in (info.get(key) or {}) for t, key in LISTED_IN.items())


def run(args, log, probe=None):
    """Run yt-dlp, copying its output to `log`.

    With `probe`, stop once that many videos were written and none of them
    lists an Arabic track.
    """
    result = Run()
    with subprocess.Popen(
        [str(YT_DLP), *COMMON, *args],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True,
    ) as proc:
        for line in proc.stdout:
            log.write(line)
            line = line.rstrip("\n")
            if m := INFO_WRITTEN.match(line):
                result.written.append(Path(m[1]))
                # The earlier files are complete once yt-dlp has moved on to another.
                if probe and len(result.written) == probe + 1 and not any(
                    has_arabic(read_json(p) or {}) for p in result.written[:probe]
                ):
                    result.no_captions = True
            elif LISTING_FAILED.match(line):
                result.listing_failed = True
            if BLOCKED.search(line):
                result.blocked = True
            if result.blocked or result.no_captions:
                os.killpg(proc.pid, signal.SIGTERM)
                break
        proc.wait()
    log.flush()
    return result


def download_source(url, kind, data_dir, archive, log, folder=None, recent=None, probe=None):
    """New videos of one source. `recent` limits a channel to its newest N videos."""
    if folder:
        folder = folder.replace("%", "%%")  # literal, not an output template
    else:
        folder = "%(channel)s" if kind == "channel" else "%(playlist_title)s"
    args = [
        "-o", f"{data_dir}/{folder}/%(upload_date)s_%(id)s.%(ext)s",
        "--write-auto-subs", "--sub-langs", "ar-orig", "--write-info-json",
        "--download-archive", str(archive),
        "--match-filter", f"duration >= {MIN_DURATION} & timestamp <? {int(time.time()) - CAPTION_DELAY}",
    ]
    if recent:
        args += ["--playlist-end", str(recent)]
    return run([*args, f"{url}/videos" if kind == "channel" else url], log, probe)


def fetch_tracks(info_path, tracks, url, log):
    """Download the given caption tracks ('ar', 'ar-orig') next to an info.json."""
    base = base_of(Path(info_path))
    result = Run()
    for track in tracks:
        write = "--write-subs" if track == "ar" else "--write-auto-subs"
        # % is escaped for the output template.
        out = str(base).replace("%", "%%") + ".%(ext)s"
        r = run([write, "--sub-langs", track, "-o", out, url], log)
        if r.blocked:
            result.blocked = True
            break
    return result


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def classify(info_path, data_dir):
    """Video row for a downloaded info.json, or None if it can't be read (yet).

    status: 'downloaded' (every listed Arabic track is on disk), 'failed' (a
    listed track is missing; `missing` says which) or 'no_captions'.
    """
    info_path = Path(info_path)
    info = read_json(info_path)
    if not info or "id" not in info:
        return None
    base = base_of(info_path)
    listed = [t for t, key in LISTED_IN.items() if t in (info.get(key) or {})]
    have = [t for t, _ in TRANSCRIPT_SOURCES if base.with_name(f"{base.name}.{t}.json3").exists()]
    missing = [t for t in listed if t not in have]
    if not listed and not have:
        status = "no_captions"
    elif missing:
        status = "failed"
    else:
        status = "downloaded"
    return {
        "id": info["id"],
        "channel_id": info.get("channel_id"),
        "upload_date": info.get("upload_date"),
        "url": info.get("webpage_url") or f"https://www.youtube.com/watch?v={info['id']}",
        "path": str(base.relative_to(data_dir)),
        "status": status,
        "have": have,
        "missing": missing,
        "reason": f"missing {', '.join(missing)}" if missing else None,
    }
