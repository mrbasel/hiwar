"""The server's side of downloading: what to fetch, and taking in what was fetched.

    rawi-ingest plan               sources and every known video, as JSON
    rawi-ingest add < RECORDS      take in NDJSON records (below), then start the worker
    rawi-ingest delete ID...       unpublish episodes; never fetched again

The downloader runs elsewhere (YouTube blocks the server's IP) and reaches
this over ssh, with a key that may run nothing else; the subcommand then
comes from SSH_ORIGINAL_COMMAND, and can't be `delete`. It asks for the `plan` before a run: sources
from sources.toml with their state (new ones start as 'backfilling'), and
every video id the server knows with its status and attempts, which is the
download archive. Then it sends what it found, one record per line:

  {"type": "video", "id", "source", "folder", "info", "captions"}
      a download, queued for pipeline/worker.py. `info` is the info.json's
      fields in parse.INFO_KEYS, `folder` where yt-dlp put it (it names
      playlists' shows), `captions` the Arabic tracks that came, by name
      ({"ar": json3, "ar-orig": json3}; none for metadata only)
  {"type": "outcome", "id", "source", "channel_id", "upload_date", "status", "reason", "attempts"}
      a video that won't be built, or not yet: status 'no_captions', or
      'failed' when a track it lists didn't download
  {"type": "source", "url", "status", "captions_seen", "checked_at", "last_new_at"}
      a source's state after its run; fields left out stay as they are

Records are checked and written one at a time. A bad one is reported on
stderr and skipped, and the exit status is 1. After any video, the worker is
started to publish them in the background: on the server, writing the file
in RAWI_WORKER_TRIGGER starts it (a systemd path unit watches it).
"""

import json
import os
import re
import shlex
import sys
from pathlib import Path

from .parse import INFO_KEYS
from .serve_db import connect, delete_episode, now, pack, set_info
from .update import read_sources
from .worker import MAX_ATTEMPTS

ROOT = Path(__file__).resolve().parent.parent
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
OUTCOMES = {"failed", "no_captions"}
SOURCE_FIELDS = {"status", "captions_seen", "checked_at", "last_new_at"}
SOURCE_STATUSES = {"backfilling", "complete", "no_captions"}
TRACKS = {"ar", "ar-orig"}


class BadRecord(Exception):
    pass


def plan(conn, sources):
    for src in sources:
        conn.execute("INSERT OR IGNORE INTO sources (url, kind, status, added_at) VALUES (?, ?, 'backfilling', ?)",
                     (src["url"], src["kind"], now()))
    conn.commit()
    state = {row[0]: row for row in conn.execute(
        "SELECT url, status, captions_seen, checked_at, last_new_at FROM sources")}
    waiting, stuck = conn.execute(
        "SELECT count(*), coalesce(sum(attempts >= ?), 0) FROM inbox", (MAX_ATTEMPTS,)).fetchone()
    return {
        "sources": [
            {**{k: v for k, v in src.items() if k in ("url", "kind", "name", "folder")},
             **dict(zip(("status", "captions_seen", "checked_at", "last_new_at"), state[src["url"]][1:]))}
            for src in sources
        ],
        "videos": [list(row) for row in conn.execute("SELECT id, status, attempts, reason FROM videos")],
        "inbox": {"waiting": waiting, "stuck": stuck},
    }


def check_id(record):
    if not isinstance(record.get("id"), str) or not VIDEO_ID.match(record["id"]):
        raise BadRecord(f"bad video id: {record.get('id')!r}")


def add_video(conn, record):
    check_id(record)
    info, captions = record.get("info"), record.get("captions") or {}
    if not isinstance(info, dict) or info.get("id") != record["id"]:
        raise BadRecord("info missing, or for another video")
    if not isinstance(record.get("folder"), str) or not record["folder"]:
        raise BadRecord("no folder")
    if not isinstance(captions, dict) or set(captions) - TRACKS:
        raise BadRecord(f"captions must be tracks among {sorted(TRACKS)}")
    if not all(isinstance(t, dict) and isinstance(t.get("events"), list) for t in captions.values()):
        raise BadRecord("a caption track isn't json3")
    if conn.execute("SELECT status FROM videos WHERE id = ?", (record["id"],)).fetchone() == ("deleted",):
        raise BadRecord("deleted from the site; not added again")
    t = now()
    conn.execute(
        "INSERT OR REPLACE INTO inbox (video_id, source, folder, info, captions, received_at) VALUES (?, ?, ?, ?, ?, ?)",
        (record["id"], record.get("source"), record["folder"], pack({k: info.get(k) for k in INFO_KEYS}),
         pack(captions) if captions else None, t))
    conn.execute(
        "INSERT INTO videos (id, source, channel_id, upload_date, status, first_seen, updated_at)"
        " VALUES (?, ?, ?, ?, 'queued', ?, ?)"
        " ON CONFLICT (id) DO UPDATE SET source = coalesce(excluded.source, source),"
        " channel_id = excluded.channel_id, upload_date = excluded.upload_date, status = 'queued',"
        " reason = NULL, updated_at = excluded.updated_at",
        (record["id"], record.get("source"), info.get("channel_id"), info.get("upload_date"), t, t))


def add_outcome(conn, record):
    check_id(record)
    if record.get("status") not in OUTCOMES:
        raise BadRecord(f"status must be one of {sorted(OUTCOMES)}")
    status = conn.execute("SELECT status FROM videos WHERE id = ?", (record["id"],)).fetchone()
    if status and status[0] in ("built", "queued", "deleted"):
        raise BadRecord(f"already {status[0]}")
    t = now()
    conn.execute(
        "INSERT INTO videos (id, source, channel_id, upload_date, status, reason, attempts, first_seen, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (id) DO UPDATE SET source = coalesce(excluded.source, source),"
        " channel_id = coalesce(excluded.channel_id, channel_id),"
        " upload_date = coalesce(excluded.upload_date, upload_date), status = excluded.status,"
        " reason = excluded.reason, attempts = excluded.attempts, updated_at = excluded.updated_at",
        (record["id"], record.get("source"), record.get("channel_id"), record.get("upload_date"),
         record["status"], record.get("reason"), int(record.get("attempts") or 0), t, t))


def add_source(conn, record):
    fields = {k: v for k, v in record.items() if k in SOURCE_FIELDS}
    if "status" in fields and fields["status"] not in SOURCE_STATUSES:
        raise BadRecord(f"source status must be one of {sorted(SOURCE_STATUSES)}")
    if not fields:
        raise BadRecord("nothing to update")
    columns = ", ".join(f"{k} = ?" for k in fields)
    if not conn.execute(f"UPDATE sources SET {columns} WHERE url = ?", (*fields.values(), record.get("url"))).rowcount:
        raise BadRecord(f"unknown source: {record.get('url')!r}")


HANDLERS = {"video": add_video, "outcome": add_outcome, "source": add_source}


def add(conn, lines):
    """Take in the records. Returns (counts by type, errors)."""
    counts, errors = dict.fromkeys(HANDLERS, 0), 0
    for n, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            handler = HANDLERS.get(record.get("type")) if isinstance(record, dict) else None
            if not handler:
                raise BadRecord("type must be one of " + ", ".join(HANDLERS))
            with conn:
                handler(conn, record)
            counts[record["type"]] += 1
        except (BadRecord, ValueError, TypeError) as e:
            print(f"record {n}: {e}", file=sys.stderr)
            errors += 1
    return counts, errors


def start_worker():
    trigger = os.environ.get("RAWI_WORKER_TRIGGER")
    if not trigger:
        print("RAWI_WORKER_TRIGGER not set: run `python -m pipeline.worker` to publish them", file=sys.stderr)
        return
    Path(trigger).write_text(now() + "\n")


def main():
    remote = not sys.argv[1:]
    args = sys.argv[1:] or shlex.split(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    command, rest = (args[0], args[1:]) if args else (None, [])
    allowed = ("plan", "add") if remote else ("plan", "add", "delete")
    if command not in allowed or (command == "delete") != bool(rest):
        sys.exit(__doc__.split("\n\n")[1])

    conn = connect(os.environ.get("DB_PATH", "rawi.db"))
    if command == "plan":
        json.dump(plan(conn, read_sources(ROOT / "sources.toml")), sys.stdout, ensure_ascii=False)
        print()
    elif command == "add":
        counts, errors = add(conn, sys.stdin)
        print(", ".join(f"{n} {kind}s" for kind, n in counts.items()) + f", {errors} rejected", file=sys.stderr)
        if counts["video"]:
            start_worker()
        sys.exit(1 if errors else 0)
    else:
        for episode_id in rest:
            with conn:
                found = delete_episode(conn, episode_id)
                conn.execute("UPDATE videos SET status = 'deleted', updated_at = ? WHERE id = ?", (now(), episode_id))
                if found:
                    set_info(conn, published_at=now())
            print(f"{episode_id}: {'deleted' if found else 'not published'}", file=sys.stderr)


if __name__ == "__main__":
    main()
