"""Export the parts of podcasts.db the site reads into one smaller file.

    uv run python -m pipeline.export [--db PATH] [--out PATH] [--model MODEL]

The API only reads, so the export (serve.db by default) leaves out what the
pipeline needs to update the database, and stores the rest compactly:

channels, episodes  as in podcasts.db, without the chapters JSON and counts
sections     without their text; `segments` holds the section's utterances
             as zlib-compressed JSON, [[idx, start, end, text, speaker_change], ...]
sections_fts the same FTS5 index, contentless: it ranks and matches, and the
             API cuts snippets from the segments itself
vectors      the model's documents that open a section, each as its sign bits
             (1 bit per dimension, for a fast first pass) and as int8 with a
             scale (vector ≈ int8 * scale, for rescoring the best of them)
build_info   the database's, plus `exported_at` and `model`

The file is built next to --out and renamed into place, so a running API
keeps the one it opened. Takes scripts/update.sh's lock, so it reads one
consistent state of the database.
"""

import argparse
import fcntl
import json
import os
import sqlite3
import time
import zlib
from pathlib import Path

import numpy as np

from .embed import LOCK, table_name

SCHEMA = """
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT,
    url TEXT
);

CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    show TEXT,
    title TEXT,
    date TEXT,
    duration REAL,
    url TEXT,
    description TEXT,
    transcript_source TEXT
);
CREATE INDEX episodes_channel ON episodes(channel_id, date);

CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    episode_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT,
    start_time REAL,
    end_time REAL,
    segments BLOB,
    UNIQUE (episode_id, idx)
);

CREATE VIRTUAL TABLE sections_fts USING fts5(
    heading_norm, text_norm,
    content='',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE vectors (
    id INTEGER PRIMARY KEY,
    kind TEXT,
    episode_id TEXT,
    channel_id TEXT,
    section_id INTEGER,
    bits BLOB,
    int8 BLOB,
    scale REAL
);

CREATE TABLE build_info (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def copy_tables(out):
    out.execute("INSERT INTO channels SELECT id, name, url FROM src.channels")
    out.execute(
        "INSERT INTO episodes SELECT id, channel_id, show, title, date, duration, url, description,"
        " transcript_source FROM src.episodes")
    out.execute("INSERT INTO build_info SELECT key, value FROM src.build_info")


def copy_sections(out):
    """Sections with their segments, read in the segments' key order and grouped."""
    rows = out.execute(
        "SELECT section_id, idx, start_time, end_time, text, speaker_change"
        " FROM src.segments ORDER BY episode_id, idx")
    blobs, section, segs = {}, None, []

    def flush():
        if segs:
            data = json.dumps(segs, ensure_ascii=False, separators=(",", ":")).encode()
            blobs[section] = zlib.compress(data, 9)

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


def quantize(vectors):
    """Sign bits (packed, little-endian), int8 rows and their scales: vector ≈ int8 * scale."""
    bits = np.packbits(vectors > 0, axis=1, bitorder="little")
    scales = np.abs(vectors).max(axis=1) / 127
    int8 = np.round(vectors / scales[:, None]).astype(np.int8)
    return bits, int8, scales.astype(np.float32)


def copy_vectors(out, model):
    """Documents that open a section, quantized; returns their count and dimensions."""
    table = table_name(model)
    rows = out.execute(
        f"SELECT id, kind, episode_id, channel_id, section_id, vector FROM src.{table}"
        " WHERE section_id IS NOT NULL ORDER BY id").fetchall()
    vectors = np.frombuffer(b"".join(r[5] for r in rows), dtype="<f2").reshape(len(rows), -1).astype(np.float32)
    bits, int8, scales = quantize(vectors)
    out.executemany(
        "INSERT INTO vectors VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(*r[:5], bits[i].tobytes(), int8[i].tobytes(), float(scales[i])) for i, r in enumerate(rows)],
    )
    return vectors.shape


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--out", default="serve.db")
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
    out.executemany(
        "INSERT OR REPLACE INTO build_info VALUES (?, ?)",
        [("exported_at", json.dumps(time.strftime("%Y-%m-%d %H:%M:%S"))), ("model", json.dumps(args.model))],
    )
    out.commit()
    out.execute("DETACH src")
    step("analyze", out.execute, "ANALYZE")
    out.execute("PRAGMA journal_mode = DELETE")
    out.close()
    os.replace(tmp, out_path)
    size = out_path.stat().st_size / 1e9
    print(f"{out_path}: {n} sections with segments, {count} vectors of {dims} dimensions,"
          f" {size:.2f} GB in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
