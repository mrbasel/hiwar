"""Add downloaded episodes to the database.

Called by `pipeline.update` after downloading. Builds every video with an
info.json that isn't in the database yet, except those from sources still
backfilling (a channel's boilerplate is learned from its whole history, so a
new channel waits until all of it is downloaded) or dropped as 'no_captions'.

Episodes without a usable Arabic transcript (no captions, captions in another
language, or nothing left after cleaning) are added too, with empty sections
from their chapters, so their titles can still be found.

Per channel (one worker each): hash the 8-word runs of every downloaded
episode of the channel, old and new, to find its boilerplate; then clean each
pending episode, merge its caption lines into utterances and cut it into
sections. Episodes already in the database are never changed. Each channel is
committed on its own, so an interrupted build resumes on the next run.

Into an empty database, this builds everything: that's how to rebuild.
"""

import sys
from collections import Counter, defaultdict

from . import db
from .clean import clean_segments, episode_keys, find_boilerplate, ngram_hashes
from .parse import find_transcript, read_info
from .sections import build_sections, title_sections
from .utterances import merge_lines


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def process_channel(task):
    """Boilerplate from all of one channel's episodes, then build the selected ones.

    Returns (built, stats, errors): built is a list of (episode, sections,
    words removed, reason), with the reason an episode has no transcript.
    Videos that couldn't be read aren't in it and stay queued.
    """
    data_dir, paths, selected = task
    stats = Counter()
    errors = []

    hashes = []
    for path in paths:
        try:
            segments, _ = find_transcript(data_dir / path)
        except Exception as e:  # malformed, or deleted since
            segments = None
            errors.append(f"{path}: {e!r}")
        if segments:
            hashes.append(ngram_hashes(episode_keys(segments)))
    boilerplate = find_boilerplate(hashes)
    del hashes
    stats["boilerplate_ngrams"] = len(boilerplate)

    built = []
    for _, path in selected:
        base = data_dir / path
        try:
            ep = read_info(base.with_name(base.name + ".info.json"))
            segments, source = find_transcript(base)
        except Exception as e:
            stats["unreadable"] += 1
            errors.append(f"{path}: {e!r}")
            continue
        removed, reason = 0, None
        if segments is None:
            sections, reason = [], "no Arabic transcript"
        else:
            segments, removed = clean_segments(segments, boilerplate)
            sections = build_sections(merge_lines(segments), ep["chapters"])
            if not sections:
                reason = "empty after cleaning"
        if reason:
            sections, source = title_sections(ep["chapters"], ep["duration"]), None
            stats["title_only"] += 1
        else:
            stats[f"source_{source}"] += 1
            stats["words_removed"] += removed
        built.append(({**ep, "transcript_source": source}, sections, removed, reason))
        stats["episodes"] += 1
    return built, stats, errors


# Videos waiting to be built. 'skipped' ones were left out by older builds,
# before episodes without a transcript were added.
QUEUED = "v.status IN ('downloaded', 'no_captions', 'skipped') AND v.path IS NOT NULL"


def count_held(conn):
    """Queued videos whose source is still backfilling."""
    return conn.execute(
        "SELECT count(*) FROM videos v JOIN sources s ON s.url = v.source"
        f" WHERE {QUEUED} AND s.status = 'backfilling'"
    ).fetchone()[0]


def pick(by_channel, limit):
    """Up to `limit` videos, round-robin over channels, evenly spread over each channel's dates."""
    if limit is None:
        return {v for vs in by_channel.values() for v in vs}
    channels = sorted(by_channel.values(), key=len, reverse=True)
    quota = Counter()
    while sum(quota.values()) < limit and any(quota[i] < len(c) for i, c in enumerate(channels)):
        for i, c in enumerate(channels):
            if quota[i] < len(c) and sum(quota.values()) < limit:
                quota[i] += 1
    chosen = set()
    for i, vs in enumerate(channels):
        vs = sorted(vs, key=lambda v: v[2] or "")
        k = quota[i]
        chosen.update(vs[int((j + 0.5) * len(vs) / k)] for j in range(k))
    return chosen


def build_pending(conn, data_dir, pool, limit=None):
    """Build the queued videos. --limit N builds only N of them, for quick checks."""
    built_ids = {row[0] for row in conn.execute("SELECT id FROM episodes")}
    pending = defaultdict(list)
    for video_id, channel_id, path, date in conn.execute(
        "SELECT v.id, v.channel_id, v.path, v.upload_date FROM videos v"
        " LEFT JOIN sources s ON s.url = v.source"
        f" WHERE {QUEUED} AND coalesce(s.status, '') NOT IN ('backfilling', 'no_captions')"
    ):
        if video_id in built_ids:  # e.g. queued again by hand
            db.set_video_status(conn, video_id, "built")
        else:
            pending[channel_id].append((video_id, path, date))
    conn.commit()
    selected = pick(pending, limit)
    held = count_held(conn)
    log(f"building {len(selected)} episodes in {len(pending)} channels"
        + (f" ({held} more wait for their source to finish backfilling)" if held else ""))

    tasks = []
    for channel_id, videos in pending.items():
        chosen = [(v, p) for v, p, d in videos if (v, p, d) in selected]
        if not chosen:
            continue
        paths = [p for (p,) in conn.execute(
            "SELECT path FROM videos WHERE channel_id IS ? AND path IS NOT NULL"
            " AND status IN ('downloaded', 'built', 'skipped')",
            (channel_id,),
        )]
        tasks.append((data_dir, paths, chosen))
    # Biggest channels first, so the last workers don't start a long one alone.
    tasks.sort(key=lambda t: len(t[1]), reverse=True)

    totals, errors, per_channel = Counter(), [], {}
    for built, stats, errs in pool.imap_unordered(process_channel, tasks):
        errors += errs
        totals.update(stats)
        for episode, sections, removed, reason in built:
            db.insert_channel(conn, episode)
            db.insert_episode(conn, episode, sections, removed)
            db.set_video_status(conn, episode["id"], "built", reason)
        conn.commit()
        if built:
            name = built[0][0]["channel"] or built[0][0]["channel_id"]
            per_channel[name] = stats["episodes"]
            log(f"  {name}: {stats['episodes']} episodes ({stats['title_only']} without a transcript), "
                f"{stats['boilerplate_ngrams']} boilerplate runs, {stats['words_removed']} words removed")
    totals.pop("boilerplate_ngrams", None)
    return totals, per_channel, errors
