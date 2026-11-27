"""Download new episodes from every source in sources.toml and add them to the database.

    scripts/update.sh [--no-download] [--source URL] [--limit N] [--workers N]
    scripts/update.sh --status

One run:
1. Adds new entries of sources.toml to `sources` as 'backfilling', and records any
   info.json in data/ that the database doesn't know about yet.
2. Retries caption downloads that failed in earlier runs (up to MAX_ATTEMPTS).
3. Downloads each source, playlists first so a show that's also on a listed
   channel lands in its own folder:
   - backfilling: every video. A run that gets through the whole list marks
     the source 'complete'. If its first PROBE new videos all lack Arabic
     captions, it's marked 'no_captions', their files are deleted, and it's
     left alone from then on.
   - complete: a channel's newest RECENT videos, or all of them if it wasn't
     checked for FULL_CHECK_DAYS; a playlist (usually oldest first) in full.
   Sources with `enabled = false` are skipped.
   On a rate limit or bot check, downloading stops; the next run picks up.
4. Fetches metadata (info.json only, no captions) for videos known to have no
   captions and none on disk, METADATA_PER_RUN per run: their titles and
   chapters are worth searching even without a transcript. A video that has
   gained captions since is fetched like a failed one on the next run.
5. Builds the downloaded episodes into the database (see pipeline/build.py).

Exits 0 when everything went through, 2 when downloading stopped on a rate
limit, 1 on errors. yt-dlp output is appended to logs/sources/<source>.log.

To rebuild from scratch, run it with --no-download against a new DB_PATH (or
after deleting the old one): every info.json in data/ is queued and built.
"""

import argparse
import os
import sys
import tempfile
import time
import tomllib
from collections import Counter
from functools import partial
from multiprocessing import Pool
from pathlib import Path

from . import db
from .build import build_pending, count_held
from .download import classify, download_source, fetch_tracks, run, video_id

ROOT = Path(__file__).resolve().parent.parent
RECENT = 50
FULL_CHECK_DAYS = 7
PROBE = 40
MAX_ATTEMPTS = 5
METADATA_PER_RUN = 300  # YouTube rate-limits at ~330 extractions per session; resumes next run


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)


SOURCE_KEYS = {"url", "name", "group", "notes", "enabled", "folder"}


def read_sources(path):
    """The enabled sources in sources.toml, playlists first, each with its `kind` added."""
    with open(path, "rb") as f:
        entries = tomllib.load(f).get("source", [])
    sources, seen = [], set()
    for n, entry in enumerate(entries, 1):
        if unknown := set(entry) - SOURCE_KEYS:
            sys.exit(f"{path}: source {n} has unknown keys: {', '.join(sorted(unknown))}")
        if "url" not in entry:
            sys.exit(f"{path}: source {n} has no url")
        url = entry["url"].strip().rstrip("/")
        if url in seen:
            sys.exit(f"{path}: {url} is listed twice")
        seen.add(url)
        if entry.get("enabled", True):
            sources.append({**entry, "url": url, "kind": "playlist" if "list=" in url else "channel"})
    return sorted(sources, key=lambda s: s["kind"] != "playlist")


def label(url):
    return url.split("list=", 1)[1].split("&")[0] if "list=" in url else url.rsplit("/", 1)[-1]


def sync_sources(conn, sources):
    added = 0
    for src in sources:
        added += conn.execute(
            "INSERT OR IGNORE INTO sources (url, kind, status, added_at) VALUES (?, ?, 'backfilling', ?)",
            (src["url"], src["kind"], db.now()),
        ).rowcount
    conn.commit()
    if added:
        log(f"{added} new sources in sources.toml")


def scan_data(conn, data_dir, pool):
    """Record the info.json files in data/ that aren't in `videos` (all of them, into a new DB)."""
    known = {row[0] for row in conn.execute("SELECT id FROM videos")}
    built = {row[0] for row in conn.execute("SELECT id FROM episodes")}
    paths = [p for p in sorted(data_dir.glob("*/*.info.json")) if video_id(p) not in known]
    if not paths:
        return []
    log(f"recording {len(paths)} info.json files from {data_dir} ...")
    counts, errors = Counter(), []
    for path, video in zip(paths, pool.imap(partial(classify, data_dir=data_dir), paths, chunksize=16)):
        if video is None:
            errors.append(f"{path}: unreadable info.json")
        elif video["id"] not in known:  # the same video can be in two folders
            known.add(video["id"])
            if video["id"] in built:
                video["status"] = "built"
            db.save_video(conn, video)
            counts[video["status"]] += 1
    conn.commit()
    log("  " + ", ".join(f"{n} {status}" for status, n in sorted(counts.items())))
    return errors


def write_archive(conn, path):
    """yt-dlp download archive with every video in the database."""
    with open(path, "w") as f:
        for (vid,) in conn.execute("SELECT id FROM videos"):
            f.write(f"youtube {vid}\n")


def finish_video(conn, video, source, log_file):
    """Fetch missing caption tracks of a just-downloaded video and save it. True if rate-limited."""
    blocked = False
    info_path = Path(video["base"] + ".info.json")
    if video["status"] == "failed":
        blocked = fetch_tracks(info_path, video["missing"], video["url"], log_file).blocked
        video = classify(info_path, Path(video["data_dir"])) or video
    db.save_video(conn, video, source)
    return video["status"], blocked


def record(conn, paths, data_dir, source, log_file, blocked):
    """Save the videos yt-dlp just wrote. Returns (status counts, rate-limited)."""
    counts = Counter()
    for path in paths:
        video = classify(path, data_dir)
        if video is None:  # cut off mid-write; not in the archive, so it's fetched again
            continue
        video["base"] = str(path)[: -len(".info.json")]
        video["data_dir"] = str(data_dir)
        if blocked and video["status"] == "failed":
            db.save_video(conn, video, source)  # retried next run
            status = "failed"
        else:
            status, hit = finish_video(conn, video, source, log_file)
            blocked = blocked or hit
        counts[status] += 1
        if status == "downloaded":
            conn.execute("UPDATE sources SET captions_seen = 1 WHERE url = ?", (source,))
    conn.commit()
    return counts, blocked


def retry_failed(conn, data_dir, log_dir):
    """Fetch caption tracks that failed before. True if rate-limited."""
    rows = conn.execute(
        "SELECT id, path, attempts FROM videos WHERE status = 'failed' AND path IS NOT NULL AND attempts < ?",
        (MAX_ATTEMPTS,),
    ).fetchall()
    if not rows:
        return False
    log(f"retrying captions of {len(rows)} videos")
    counts = Counter()
    with open(log_dir / "_retries.log", "a") as f:
        f.write(f"\n=== {db.now()}\n")
        for vid, path, attempts in rows:
            info_path = data_dir / f"{path}.info.json"
            video = classify(info_path, data_dir)
            if video is None:
                counts["unreadable"] += 1
                continue
            blocked = False
            if video["status"] == "failed":
                blocked = fetch_tracks(info_path, video["missing"], video["url"], f).blocked
                video = classify(info_path, data_dir) or video
            attempts += 1
            if video["status"] == "failed" and attempts >= MAX_ATTEMPTS and video["have"]:
                # Build from the track we have rather than not at all.
                video["status"], video["reason"] = "downloaded", f"gave up on {', '.join(video['missing'])}"
            db.save_video(conn, video)
            conn.execute("UPDATE videos SET attempts = ? WHERE id = ?", (attempts, vid))
            conn.commit()
            counts[video["status"]] += 1
            if blocked:
                log("  rate-limited; stopping downloads, the next run continues")
                return True
    log("  " + ", ".join(f"{n} {status}" for status, n in sorted(counts.items())))
    return False


def fetch_metadata(conn, data_dir, log_dir, limit=METADATA_PER_RUN):
    """Fetch info.json only for videos with no captions. True if rate-limited.

    Sources dropped as 'no_captions' are left out, like their downloads: they
    were likely not Arabic podcasts. Each video is tried up to MAX_ATTEMPTS
    times, so ones that are gone don't block the queue.
    """
    ids = [vid for (vid,) in conn.execute(
        "SELECT v.id FROM videos v LEFT JOIN sources s ON s.url = v.source"
        " WHERE v.status = 'no_captions' AND v.path IS NULL"
        " AND coalesce(s.status, '') != 'no_captions' AND v.attempts < ?"
        " ORDER BY v.upload_date LIMIT ?",
        (MAX_ATTEMPTS, limit),
    )]
    if not ids:
        return False
    log(f"fetching metadata of {len(ids)} videos without captions")
    fd, batch = tempfile.mkstemp(prefix="podcasts-metadata-", suffix=".txt")
    with os.fdopen(fd, "w") as f:
        f.writelines(f"https://www.youtube.com/watch?v={vid}\n" for vid in ids)
    counts = Counter()
    try:
        with open(log_dir / "_metadata.log", "a") as f:
            f.write(f"\n=== {db.now()}\n")
            result = run([
                "--write-info-json", "--no-write-playlist-metafiles",
                # Same layout as downloaded videos, so folders don't split in two.
                "-o", f"{data_dir}/%(channel)s/%(upload_date)s_%(id)s.%(ext)s",
                # No archive: every one of these ids is already in it.
                "--batch-file", batch,
                # Nothing is downloaded, so don't wait between videos.
                "--sleep-interval", "1", "--max-sleep-interval", "3",
            ], f)
    finally:
        os.unlink(batch)
    for path in result.written:
        video = classify(path, data_dir)
        if video is None:  # cut off mid-write; not recorded, so tried again
            continue
        db.save_video(conn, video)
        counts[video["status"]] += 1
    if not result.blocked:  # a killed batch never reached most of these
        conn.executemany("UPDATE videos SET attempts = attempts + 1 WHERE id = ?", [(v,) for v in ids])
    conn.commit()
    log("  " + ", ".join(f"{n} {status}" for status, n in sorted(counts.items())))
    if result.blocked:
        log("  rate-limited while fetching metadata; the next run continues")
    return result.blocked


def download_all(conn, sources, data_dir, log_dir, only=None, after_source=None):
    """Download every source in turn, calling after_source() after each one.
    Returns (rate-limited, errors)."""
    errors = []
    fd, archive = tempfile.mkstemp(prefix="podcasts-archive-", suffix=".txt")
    os.close(fd)
    try:
        for src in sources:
            url, kind = src["url"], src["kind"]
            if only and url != only:
                continue
            status, captions_seen, checked_at = conn.execute(
                "SELECT status, captions_seen, checked_at FROM sources WHERE url = ?", (url,)
            ).fetchone()
            if status == "no_captions":
                continue
            stale = not checked_at or time.time() - time.mktime(
                time.strptime(checked_at, "%Y-%m-%d %H:%M:%S")) > FULL_CHECK_DAYS * 86400
            full = status == "backfilling" or kind == "playlist" or stale
            write_archive(conn, archive)
            name = src.get("name") or label(url)
            with open(log_dir / f"{label(url)}.log", "a") as f:
                f.write(f"\n=== {db.now()} {'all videos' if full else f'newest {RECENT}'}\n")
                f.flush()
                run = download_source(url, kind, data_dir, archive, f, folder=src.get("folder"),
                                      recent=None if full else RECENT,
                                      probe=None if captions_seen else PROBE)
                counts, blocked = record(conn, run.written, data_dir, url, f, run.blocked)

            notes = []
            if run.no_captions:
                # Likely not an Arabic podcast: don't add its videos by title either.
                for path in run.written:
                    path.unlink(missing_ok=True)
                conn.execute("UPDATE videos SET path = NULL WHERE source = ? AND status = 'no_captions'", (url,))
                conn.execute("UPDATE sources SET status = 'no_captions' WHERE url = ?", (url,))
                notes.append(f"first {PROBE} new videos have no Arabic captions; skipping this source from now on")
            elif not blocked and not run.listing_failed:
                conn.execute("UPDATE sources SET checked_at = ? WHERE url = ?", (db.now(), url))
                if status == "backfilling":
                    conn.execute("UPDATE sources SET status = 'complete' WHERE url = ?", (url,))
                    notes.append("backfill complete")
            if run.listing_failed:
                errors.append(f"{url}: couldn't list its videos (see logs/sources/{label(url)}.log)")
                notes.append("couldn't list videos")
            if counts["downloaded"] or counts["failed"]:
                conn.execute("UPDATE sources SET last_new_at = ? WHERE url = ?", (db.now(), url))
            conn.commit()
            new = sum(counts.values())
            if new or notes or blocked:
                detail = ", ".join(f"{n} {s}" for s, n in sorted(counts.items()))
                log(f"{name}: {new} new" + (f" ({detail})" if new else "")
                    + "".join(f"; {note}" for note in notes))
            if after_source:
                after_source()
            if blocked:
                log(f"rate-limited on {name}; stopping downloads, the next run continues from here")
                return True, errors
    finally:
        os.unlink(archive)
    return False, errors


def print_status(conn, sources):
    """Sources in sources.toml; disabled or removed ones are listed by their url."""
    names = {s["url"]: s.get("name") or label(s["url"]) for s in sources}
    print(f"{'source':40} {'kind':8} {'status':12} {'checked':19}  last new")
    for url, kind, status, checked, last_new in conn.execute(
        "SELECT url, kind, status, checked_at, last_new_at FROM sources ORDER BY status, url"
    ):
        name = names.get(url, f"({url}, not enabled)")
        print(f"{name:40} {kind:8} {status:12} {checked or '-':19}  {last_new or '-'}")
    print("\nvideos: " + ", ".join(
        f"{n} {status}" for status, n in conn.execute("SELECT status, count(*) FROM videos GROUP BY status")
    ))
    held = count_held(conn)
    if held:
        print(f"{held} downloaded videos wait for their source to finish backfilling")
    backlog = conn.execute(
        "SELECT count(*) FROM videos WHERE status = 'no_captions' AND path IS NULL"
    ).fetchone()[0]
    if backlog:
        print(f"{backlog} videos without captions wait for metadata")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sources", type=Path, default=ROOT / "sources.toml")
    ap.add_argument("--db", type=Path, default=ROOT / "podcasts.db")
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--no-download", action="store_true", help="only build what's already downloaded")
    ap.add_argument("--source", help="only download this source (its url in sources.toml)")
    ap.add_argument("--limit", type=int, help="only build this many episodes, for quick checks")
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1),
                    help="parallel processes (each holds one channel's hashes in memory)")
    ap.add_argument("--metadata-limit", type=int, default=METADATA_PER_RUN,
                    help="videos without captions to fetch metadata for this run")
    ap.add_argument("--status", action="store_true", help="show each source's status and exit")
    args = ap.parse_args()

    data_dir = args.data.resolve()
    sources = read_sources(args.sources)
    if args.source and args.source.rstrip("/") not in {s["url"] for s in sources}:
        ap.error(f"{args.source} is not an enabled source in {args.sources}")
    conn = db.connect(args.db)
    sync_sources(conn, sources)
    if args.status:
        print_status(conn, sources)
        return

    t0 = time.time()
    errors, blocked = [], False
    log_dir = ROOT / "logs" / "sources"
    log_dir.mkdir(parents=True, exist_ok=True)
    with Pool(args.workers) as pool:
        errors += scan_data(conn, data_dir, pool)
        if not args.no_download:
            blocked = retry_failed(conn, data_dir, log_dir)
            if not blocked:
                blocked, errs = download_all(conn, sources, data_dir, log_dir,
                                             args.source and args.source.rstrip("/"))
                errors += errs
            if not blocked:  # new episodes matter more than title-only ones
                blocked = fetch_metadata(conn, data_dir, log_dir, args.metadata_limit)
        totals, per_channel, build_errors = build_pending(conn, data_dir, pool, args.limit)
        errors += build_errors

    counts = {
        t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ("channels", "episodes", "sections", "segments")
    }
    words = conn.execute("SELECT coalesce(sum(word_count), 0) FROM episodes").fetchone()[0]
    old = db.read_build_info(conn)
    run = {
        "at": db.now(),
        "seconds": round(time.time() - t0),
        "rate_limited": blocked,
        "totals": dict(totals),
        "per_channel": per_channel,
        "errors": errors,
    }
    # built_at changes only when episodes are added, so eval runs stay comparable until then.
    conn.execute("DELETE FROM build_info")
    db.write_build_info(conn, {
        "built_at": db.now() if totals["episodes"] else old.get("built_at"),
        "counts": counts,
        "words": words,
        "last_run": run,
    })
    conn.commit()
    conn.execute("PRAGMA optimize")
    conn.close()

    log(f"done in {run['seconds']}s: {totals['episodes']} episodes added")
    log("  " + ", ".join(f"{v} {k}" for k, v in counts.items()) + f", {words:,} words")
    if totals:
        log("  " + ", ".join(f"{v} {k}" for k, v in sorted(totals.items())))
    for err in errors[:10]:
        log(f"  error: {err}")
    if len(errors) > 10:
        log(f"  ... {len(errors) - 10} more errors in build_info")
    sys.exit(1 if errors else 2 if blocked else 0)


if __name__ == "__main__":
    main()
