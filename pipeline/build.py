"""Build the podcasts database from the raw downloads in `data/`.

    uv run python -m pipeline.build DATA_DIR DB_PATH [--limit N] [--workers N]

Always rebuilds from scratch: writes `DB_PATH.tmp` and renames it over DB_PATH
only when the build succeeds, so a failed run never leaves a half-built DB.
`data/` is only read.

1. Read every `.info.json` that has a transcript file next to it.
2. Per channel (one worker each): hash the 8-word runs of every episode to
   find that channel's boilerplate, then clean each episode, merge its
   caption lines into utterances and cut it into sections.
3. Insert into SQLite and build the full-text index.

--limit N builds only N episodes, spread over channels and dates, for quick
checks. Boilerplate is still learned from every episode of each channel, so
the cleaning matches a full build.
"""

import argparse
import os
import sys
import time
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path

from . import db
from .clean import clean_segments, episode_keys, find_boilerplate, ngram_hashes
from .parse import find_transcript, read_info
from .sections import build_sections
from .utterances import merge_lines


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def read_info_safe(path):
    try:
        return read_info(path), None
    except Exception as e:  # half-written by a running download, or malformed
        return None, f"{path}: {e!r}"


def process_channel(task):
    """Boilerplate for one channel, then (episode, sections, removed) for the selected episodes."""
    episodes, selected = task
    stats = Counter()
    errors = []

    hashes = []
    for ep in episodes:
        try:
            segments, _ = find_transcript(ep["path"])
        except Exception as e:
            segments = None
            errors.append(f"{ep['path']}: {e!r}")
        if segments:
            hashes.append(ngram_hashes(episode_keys(segments)))
    boilerplate = find_boilerplate(hashes)
    del hashes
    stats["boilerplate_ngrams"] = len(boilerplate)

    results = []
    for ep in episodes:
        if ep["id"] not in selected:
            continue
        try:
            segments, source = find_transcript(ep["path"])
        except Exception:
            stats["transcript_unreadable"] += 1  # already logged in the first pass
            continue
        if segments is None:
            stats["not_arabic"] += 1
            continue
        segments, removed = clean_segments(segments, boilerplate)
        segments = merge_lines(segments)
        sections = build_sections(segments, ep["chapters"])
        if not sections:
            stats["empty_after_cleaning"] += 1
            continue
        results.append(({**ep, "transcript_source": source}, sections, removed))
        stats["episodes"] += 1
        stats[f"source_{source}"] += 1
        stats["words_removed"] += removed
    return episodes[0], results, stats, errors


def pick(by_channel, limit):
    """Up to `limit` episode ids, round-robin over channels, evenly spread over each channel's dates."""
    if limit is None:
        return {ep["id"] for eps in by_channel.values() for ep in eps}
    channels = sorted(by_channel.values(), key=len, reverse=True)
    quota = Counter()
    while sum(quota.values()) < limit and any(quota[i] < len(c) for i, c in enumerate(channels)):
        for i, c in enumerate(channels):
            if quota[i] < len(c) and sum(quota.values()) < limit:
                quota[i] += 1
    chosen = set()
    for i, eps in enumerate(channels):
        eps = sorted(eps, key=lambda e: e["date"] or "")
        k = quota[i]
        chosen.update(eps[int((j + 0.5) * len(eps) / k)]["id"] for j in range(k))
    return chosen


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("db_path", type=Path)
    ap.add_argument("--limit", type=int, help="only build this many episodes")
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1),
                    help="parallel processes (each holds one channel's hashes in memory)")
    args = ap.parse_args()
    t0 = time.time()

    info_paths = sorted(args.data_dir.glob("*/*.info.json"))
    log(f"reading {len(info_paths)} info.json files ...")
    episodes, errors, seen = [], [], set()
    totals = Counter(info_files=len(info_paths))
    with Pool(args.workers) as pool:
        for ep, err in pool.imap_unordered(read_info_safe, info_paths, chunksize=16):
            if err:
                errors.append(err)
                totals["unreadable"] += 1
            elif ep is None:
                totals["no_transcript"] += 1
            elif ep["id"] in seen:
                totals["duplicates"] += 1
            else:
                seen.add(ep["id"])
                episodes.append(ep)

        by_channel = defaultdict(list)
        for ep in sorted(episodes, key=lambda e: e["path"]):
            by_channel[ep["channel_id"]].append(ep)
        selected = pick(by_channel, args.limit)
        log(f"{len(episodes)} episodes with transcripts in {len(by_channel)} channels; building {len(selected)}")

        tmp = args.db_path.with_name(args.db_path.name + ".tmp")
        tmp.unlink(missing_ok=True)
        conn = db.create(tmp)
        per_channel = {}
        # Biggest channels first, so the last workers don't start a long one alone.
        tasks = [
            (eps, {e["id"] for e in eps} & selected)
            for eps in sorted(by_channel.values(), key=len, reverse=True)
        ]
        for first, results, stats, errs in pool.imap_unordered(process_channel, tasks):
            errors += errs
            totals.update(stats)
            db.insert_channel(conn, first)
            for episode, sections, removed in results:
                db.insert_episode(conn, episode, sections, removed)
            conn.commit()
            name = first["channel"] or first["channel_id"]
            per_channel[name] = dict(stats)
            log(f"  {name}: {stats['episodes']} episodes, {stats['boilerplate_ngrams']} boilerplate runs, "
                f"{stats['words_removed']} words removed")

    counts = {
        t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ("channels", "episodes", "sections", "segments")
    }
    words = conn.execute("SELECT coalesce(sum(word_count), 0) FROM episodes").fetchone()[0]
    if counts["episodes"] == 0:
        conn.close()
        sys.exit("no episodes built; keeping the old database")

    totals.pop("boilerplate_ngrams", None)
    info = {
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "seconds": round(time.time() - t0),
        "data_dir": str(args.data_dir),
        "limit": args.limit,
        "counts": counts,
        "words": words,
        "totals": dict(totals),
        "per_channel": per_channel,
        "errors": errors,
    }
    log("building full-text index ...")
    db.finish(conn, info)
    os.replace(tmp, args.db_path)

    log(f"\ndone in {info['seconds']}s -> {args.db_path}")
    log("  " + ", ".join(f"{v} {k}" for k, v in counts.items()) + f", {words:,} words")
    log("  " + ", ".join(f"{v} {k}" for k, v in sorted(totals.items())))
    for err in errors[:10]:
        log(f"  error: {err}")
    if len(errors) > 10:
        log(f"  ... {len(errors) - 10} more errors in build_info")


if __name__ == "__main__":
    main()
