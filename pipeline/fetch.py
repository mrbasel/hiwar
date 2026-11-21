"""Download new episodes and send them to the server: one run of the downloader.

    python -m pipeline.fetch [--data DIR] [--source URL] [--metadata-limit N]

Runs on another machine (e.g. a home server), as
YouTube blocks the server's IP. The server's database is the source of
truth. A run starts with its plan (`rawi-ingest plan`: sources and every
video it knows) and brings a local state database (DIR/state.db,
podcasts.db's schema) in line with it; what's only local is which files in
DIR belong to which video. Then it downloads as scripts/update.sh does
(steps 1-4 in pipeline/update.py), without building, and sends the server
what it doesn't have yet with `rawi-ingest add`: downloaded videos, to
publish (those without captions too, for their titles and chapters); videos
whose captions failed or that have none, as outcomes; and each source's new
state. It sends after each source, so a long backfill is published as it
goes, and once more at the end; what a broken run or connection didn't send
goes on the next run.

RAWI_SSH is the command that reaches rawi-ingest, e.g. `ssh -i KEY
rawi-writer@HOST`; on the server, that key can run nothing else.
Requests to YouTube are paced as in pipeline/download.py, and a run stops at
the first rate limit; one run at a time.

Exits 0 when everything went through, 2 when downloading stopped on a rate
limit, 1 on errors. The downloaded files stay in DIR, as the raw archive.
"""

import argparse
import fcntl
import json
import os
import shlex
import subprocess
import sys
import time
from multiprocessing import Pool
from pathlib import Path

from . import db
from .parse import INFO_KEYS, TRANSCRIPT_SOURCES
from .update import METADATA_PER_RUN, download_all, fetch_metadata, retry_failed, scan_data

UPLOADS_PER_CALL = 20  # each is about 1 MB of JSON
DONE = ("built", "queued", "deleted")  # on the server: nothing left to send
SOURCE_STATE = ("status", "captions_seen", "checked_at", "last_new_at")


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)


def ingest(args, records=None):
    """Run rawi-ingest on the server; its stdout. Raises if it fails outright."""
    command = shlex.split(os.environ["RAWI_SSH"]) + args
    data = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records) if records else None
    result = subprocess.run(command, input=data, capture_output=True, text=True)
    if result.stderr.strip():
        log("  server: " + result.stderr.strip().replace("\n", "\n  server: "))
    if result.returncode not in (0, 1):  # 1: some records rejected, reported above
        raise RuntimeError(f"rawi-ingest {' '.join(args)} failed with status {result.returncode}")
    return result.stdout, result.returncode == 0


def reconcile(conn, plan):
    """Make the local state the server's, keeping the local files' paths.

    Videos the server has done with become 'built' locally (they only matter
    for the download archive). Local ones it doesn't know are kept, to be sent;
    'built' ones among them, which a replaced server database lost, are sent
    again if their files are here.
    """
    conn.execute("DELETE FROM sources")
    conn.executemany(
        "INSERT INTO sources (url, kind, status, captions_seen, checked_at, last_new_at) VALUES (?, ?, ?, ?, ?, ?)",
        [(s["url"], s["kind"], *(s[k] for k in SOURCE_STATE)) for s in plan["sources"]])
    server = {vid: (status, attempts, reason) for vid, status, attempts, reason in plan["videos"]}
    t = db.now()
    for vid, (status, attempts, reason) in server.items():
        conn.execute(
            "INSERT INTO videos (id, status, reason, attempts, first_seen, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT (id) DO UPDATE SET status = excluded.status, reason = excluded.reason,"
            " attempts = excluded.attempts",
            (vid, "built" if status in DONE else status, reason, attempts, t, t))
    lost = [(vid,) for (vid,) in conn.execute(
        "SELECT id FROM videos WHERE status = 'built' AND path IS NOT NULL") if vid not in server]
    conn.executemany("UPDATE videos SET status = 'downloaded' WHERE id = ?", lost)
    conn.commit()
    return server


def upload(data_dir, vid, source, path):
    """A video record from its files in DIR."""
    base = data_dir / path
    info = json.loads(base.with_name(base.name + ".info.json").read_text(encoding="utf-8"))
    captions = {}
    for suffix, _ in TRANSCRIPT_SOURCES:
        track = base.with_name(f"{base.name}.{suffix}.json3")
        if track.exists():
            captions[suffix] = json.loads(track.read_text(encoding="utf-8"))
    return {"type": "video", "id": vid, "source": source, "folder": base.parent.name,
            "info": {k: info.get(k) for k in INFO_KEYS}, "captions": captions}


def unsent(conn, server, plan_sources, data_dir):
    """(videos to upload, outcomes, source updates) the server doesn't have yet."""
    uploads, outcomes = [], []
    rows = conn.execute(
        "SELECT id, source, channel_id, path, upload_date, status, reason, attempts FROM videos"
        " WHERE status IN ('downloaded', 'no_captions', 'failed')")
    for vid, source, channel_id, path, upload_date, status, reason, attempts in rows:
        known = server.get(vid)
        if known and known[0] in DONE:
            continue
        if status != "failed" and path and (data_dir / f"{path}.info.json").exists():
            uploads.append((vid, source, path))
        elif not known or known[:2] != (status, attempts):
            outcomes.append({"type": "outcome", "id": vid, "source": source, "channel_id": channel_id,
                             "upload_date": upload_date, "status": status, "reason": reason,
                             "attempts": attempts})
    local = {row[0]: row[1:] for row in conn.execute(
        "SELECT url, " + ", ".join(SOURCE_STATE) + " FROM sources")}
    sources = [{"type": "source", "url": s["url"], **dict(zip(SOURCE_STATE, local[s["url"]]))}
               for s in plan_sources if tuple(s[k] for k in SOURCE_STATE) != local[s["url"]]]
    return uploads, outcomes, sources


def send(conn, server, plan_sources, data_dir):
    """Send what the server doesn't have, and note what it now has in `server`
    and `plan_sources`, so it isn't sent again. Returns whether all of it was taken."""
    uploads, outcomes, sources = unsent(conn, server, plan_sources, data_dir)
    if not (uploads or outcomes or sources):
        return True
    log(f"sending {len(uploads)} videos, {len(outcomes)} outcomes and {len(sources)} source updates")
    ok = True
    for i in range(0, len(uploads), UPLOADS_PER_CALL):
        sent = uploads[i:i + UPLOADS_PER_CALL]
        ok &= ingest(["add"], [upload(data_dir, *u) for u in sent])[1]
        # Rejected ones too: sending them again wouldn't change the answer.
        server.update((vid, ("queued", 0, None)) for vid, _, _ in sent)
    if outcomes or sources:
        ok &= ingest(["add"], outcomes + sources)[1]
        server.update((o["id"], (o["status"], o["attempts"], o["reason"])) for o in outcomes)
        by_url = {s["url"]: s for s in plan_sources}
        for s in sources:
            by_url[s["url"]].update({k: s[k] for k in SOURCE_STATE})
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("/data"))
    ap.add_argument("--source", help="only download this source (its url in sources.toml)")
    ap.add_argument("--metadata-limit", type=int, default=METADATA_PER_RUN,
                    help="videos without captions to fetch metadata for this run")
    args = ap.parse_args()
    if "RAWI_SSH" not in os.environ:
        ap.error("set RAWI_SSH to the command that reaches rawi-ingest")

    data_dir = args.data.resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    lock = open(data_dir / ".lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("another run is still going")
        return

    t0 = time.time()
    plan = json.loads(ingest(["plan"])[0])
    sources = plan["sources"]
    if args.source and args.source.rstrip("/") not in {s["url"] for s in sources}:
        ap.error(f"{args.source} is not one of the server's sources")
    conn = db.connect(data_dir / "state.db")
    server = reconcile(conn, plan)
    log(f"the server knows {len(server)} videos and {len(sources)} sources;"
        f" {plan['inbox']['waiting']} uploads wait to be published")

    log_dir = data_dir / "logs"
    log_dir.mkdir(exist_ok=True)
    errors = []
    with Pool(2) as pool:
        errors += scan_data(conn, data_dir, pool)
    blocked = retry_failed(conn, data_dir, log_dir)
    def send_now():
        try:
            if not send(conn, server, sources, data_dir):
                errors.append("the server rejected some records (see above)")
        except Exception as e:
            errors.append(f"couldn't send to the server; the next run will: {e}")

    if not blocked:
        blocked, errs = download_all(conn, sources, data_dir, log_dir, args.source and args.source.rstrip("/"),
                                     after_source=send_now)
        errors += errs
    if not blocked:
        blocked = fetch_metadata(conn, data_dir, log_dir, args.metadata_limit)
    send_now()
    conn.close()

    log(f"done in {time.time() - t0:.0f}s" + (", stopped on a rate limit" if blocked else ""))
    for err in errors:
        log(f"  error: {err}")
    sys.exit(1 if errors else 2 if blocked else 0)


if __name__ == "__main__":
    main()
