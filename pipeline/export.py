"""Export podcasts.db as the server's database (see pipeline/serve_db.py).

    uv run python -m pipeline.export [--db PATH] [--out PATH] [--model MODEL]

Seeds the server's database, and makes the snapshot a bulk rebuild ships
(changed sectioning, a new model). From the server's side it's the same as
having added every episode one by one: episodes, sections, the full-text
index and the model's quantized vectors, plus the download state, so the
downloader picks up where podcasts.db left off. Section ids are podcasts.db's.

The file is built next to --out and renamed into place, so a running API
keeps the one it opened. Takes scripts/update.sh's lock, so it reads one
consistent state of the database.
"""

import argparse
import fcntl
import os
import sqlite3
import time
from pathlib import Path

import numpy as np

from .embed import LOCK, table_name
from .serve_db import SCHEMA, pack, quantize, set_info


def copy_tables(out):
    out.execute("INSERT INTO channels SELECT id, name, url FROM src.channels")
    out.execute(
        "INSERT INTO episodes SELECT id, channel_id, show, title, date, duration, url, description,"
        " chapters, transcript_source FROM src.episodes")
    out.execute("INSERT INTO sources SELECT url, kind, status, captions_seen, added_at, checked_at, last_new_at"
                " FROM src.sources")
    out.execute(
        "INSERT INTO videos SELECT id, source, channel_id, upload_date, status, reason, attempts, first_seen,"
        " updated_at FROM src.videos")
    out.execute("INSERT INTO build_info SELECT key, value FROM src.build_info")


def copy_sections(out):
    """Sections with their segments, read in the segments' key order and grouped."""
    rows = out.execute(
        "SELECT section_id, idx, start_time, end_time, text, speaker_change"
        " FROM src.segments ORDER BY episode_id, idx")
    blobs, section, segs = {}, None, []

    def flush():
        if segs:
            blobs[section] = pack(segs)

    for section_id, idx, start, end, text, speaker in rows:
        if section_id != section:
            flush()
            section, segs = section_id, []
        segs.append([idx, start, end, text, speaker])
    flush()
    sections = out.execute(
        "SELECT id, episode_id, idx, title, start_time, end_time FROM src.sections ORDER BY id").fetchall()
    out.executemany("INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?, ?)", [(*s, blobs.get(s[0])) for s in sections])
    return len(blobs)


def copy_fts(out):
    out.execute(
        "INSERT INTO sections_fts (rowid, heading_norm, text_norm)"
        " SELECT id, heading_norm, text_norm FROM src.sections")
    out.execute("INSERT INTO sections_fts (sections_fts) VALUES ('optimize')")


def copy_vectors(out, model):
    """Documents that open a section, quantized; returns their count and dimensions."""
    table = table_name(model)
    rows = out.execute(
        f"SELECT kind, episode_id, channel_id, section_id, doc_hash, vector FROM src.{table}"
        " WHERE section_id IS NOT NULL ORDER BY id").fetchall()
    vectors = np.frombuffer(b"".join(r[5] for r in rows), dtype="<f2").reshape(len(rows), -1).astype(np.float32)
    bits, int8, scales = quantize(vectors)
    out.executemany(
        "INSERT INTO vectors (kind, episode_id, channel_id, section_id, doc_hash, bits, int8, scale)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(*r[:5], bits[i].tobytes(), int8[i].tobytes(), float(scales[i])) for i, r in enumerate(rows)],
    )
    return vectors.shape


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--out", default="rawi.db")
    parser.add_argument("--model", default="baai/bge-m3")
    args = parser.parse_args()

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    lock = LOCK.open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("an update is running; try again when it's done")

    out_path = Path(args.out)
    tmp = out_path.with_name(out_path.name + ".tmp")
    tmp.unlink(missing_ok=True)
    started = time.time()
    out = sqlite3.connect(f"file:{tmp}", uri=True)  # uri, for attaching the database read-only
    out.execute("PRAGMA journal_mode = OFF")
    out.execute("PRAGMA synchronous = OFF")
    out.executescript(SCHEMA)
    out.execute("ATTACH ? AS src", (f"file:{Path(args.db).resolve()}?mode=ro",))

    def step(name, fn, *a):
        t = time.time()
        result = fn(*a)
        print(f"{name}: {time.time() - t:.0f}s", flush=True)
        return result

    step("episodes and channels", copy_tables, out)
    n = step("sections and segments", copy_sections, out)
    step("full-text index", copy_fts, out)
    count, dims = step("vectors", copy_vectors, out, args.model)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    set_info(out, exported_at=stamp, published_at=stamp, model=args.model)
    out.commit()
    out.execute("DETACH src")
    step("analyze", out.execute, "ANALYZE")
    # Set in the file, so the API can open it read-only while the server writes.
    out.execute("PRAGMA journal_mode = WAL")
    out.close()
    os.replace(tmp, out_path)
    size = out_path.stat().st_size / 1e9
    print(f"{out_path}: {n} sections with segments, {count} vectors of {dims} dimensions,"
          f" {size:.2f} GB in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
