"""The server's database: what the site reads, and what's needed to keep it up to date.

channels, episodes  as in podcasts.db, without the counts
sections     without their text; `segments` holds the section's utterances
             as zlib-compressed JSON, [[idx, start, end, text, speaker_change], ...]
sections_fts the FTS5 index over the same text as podcasts.db's, contentless:
             it ranks and matches, and the API cuts snippets from the segments.
             contentless_delete lets an episode's rows be deleted.
vectors      the documents of pipeline/episode.py that open a section, each
             as its sign bits (1 bit per dimension, for a fast first pass) and
             as int8 with a scale (vector ≈ int8 * scale, for rescoring the
             best of them). Ids only grow, so the API loads new ones by id.
deleted_vectors  ids of vectors deleted since the API loaded them, in order
sources, videos  download state, as in podcasts.db, without the files' paths:
             what the downloader (on another machine) asks for before a run
inbox        uploads waiting for pipeline/worker.py: an info.json's fields and
             caption tracks, zlib-compressed JSON
build_info   `model`, `published_at` (the last change to episodes), and from
             a seed, podcasts.db's

Written by pipeline/ingest.py and pipeline/worker.py on the server, and once
by pipeline/export.py, which seeds it from podcasts.db. The API only reads it,
and picks up changes while it runs. Episodes are added and deleted, never
changed: a fixed one is deleted and added again.
"""

import json
import os
import sqlite3
import time
import zlib

import numpy as np

from .db import section_norms, utterance

SCHEMA = """
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT,
    url TEXT
);

CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    show TEXT,
    title TEXT,
    date TEXT,
    duration REAL,
    url TEXT,
    description TEXT,
    chapters TEXT,
    transcript_source TEXT
);
CREATE INDEX IF NOT EXISTS episodes_channel ON episodes(channel_id, date);

CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY,
    episode_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT,
    start_time REAL,
    end_time REAL,
    segments BLOB,
    UNIQUE (episode_id, idx)
);

CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
    heading_norm, text_norm,
    content='', contentless_delete=1,
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT,
    episode_id TEXT,
    channel_id TEXT,
    section_id INTEGER,
    doc_hash TEXT,
    bits BLOB,
    int8 BLOB,
    scale REAL
);
CREATE INDEX IF NOT EXISTS vectors_episode ON vectors(episode_id);

CREATE TABLE IF NOT EXISTS deleted_vectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vector_id INTEGER
);

CREATE TABLE IF NOT EXISTS sources (
    url TEXT PRIMARY KEY,
    kind TEXT,
    status TEXT,
    captions_seen INTEGER DEFAULT 0,
    added_at TEXT,
    checked_at TEXT,
    last_new_at TEXT
);

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    source TEXT,
    channel_id TEXT,
    upload_date TEXT,
    status TEXT,                       -- 'queued' (in the inbox), 'built', 'failed', 'no_captions' or 'deleted'
    reason TEXT,
    attempts INTEGER DEFAULT 0,
    first_seen TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS videos_status ON videos(status);

CREATE TABLE IF NOT EXISTS inbox (
    video_id TEXT PRIMARY KEY,
    source TEXT,
    folder TEXT,                       -- where yt-dlp put it, which names playlists' shows
    info BLOB,
    captions BLOB,
    received_at TEXT,
    attempts INTEGER DEFAULT 0,        -- worker runs that failed on it
    error TEXT
);

CREATE TABLE IF NOT EXISTS build_info (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

# For contentless_delete.
MIN_SQLITE = (3, 43, 0)


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def connect(path):
    """An existing database; pipeline/export.py makes new ones."""
    if not os.path.exists(path):
        raise SystemExit(f"no database at {path}: seed one with pipeline.export")
    if sqlite3.sqlite_version_info < MIN_SQLITE:
        raise SystemExit(f"SQLite {sqlite3.sqlite_version} is too old: the full-text index needs 3.43")
    conn = sqlite3.connect(path, timeout=60)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.executescript(SCHEMA)
    return conn


def set_info(conn, **values):
    conn.executemany(
        "INSERT OR REPLACE INTO build_info VALUES (?, ?)",
        [(k, json.dumps(v, ensure_ascii=False)) for k, v in values.items()],
    )


def pack(value):
    return zlib.compress(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode(), 9)


def unpack(blob):
    return json.loads(zlib.decompress(blob))


def quantize(vectors):
    """Sign bits (packed, little-endian), int8 rows and their scales: vector ≈ int8 * scale."""
    bits = np.packbits(vectors > 0, axis=1, bitorder="little")
    scales = np.abs(vectors).max(axis=1) / 127
    int8 = np.round(vectors / scales[:, None]).astype(np.int8)
    return bits, int8, scales.astype(np.float32)


def insert_episode(conn, built, vectors):
    """Add one episode from pipeline/episode.build_episode, with its docs' vectors
    (one row per doc that opens a section, in order). Doesn't commit."""
    ep, sections = built["episode"], built["sections"]
    conn.execute("INSERT OR IGNORE INTO channels VALUES (?, ?, ?)",
                 (ep["channel_id"], ep["channel"], ep["channel_url"]))
    conn.execute(
        "INSERT INTO episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ep["id"], ep["channel_id"], ep["show"], ep["title"], ep["date"], ep["duration"], ep["url"],
         ep["description"], json.dumps(ep["chapters"], ensure_ascii=False), ep["transcript_source"]),
    )
    section_ids, seg_idx = [], 0
    for n, section in enumerate(sections, 1):
        segments = []
        for seg in section["segments"]:
            segments.append([seg_idx, seg["start"], seg["end"], *utterance(seg)])
            seg_idx += 1
        section_id = conn.execute(
            "INSERT INTO sections (episode_id, idx, title, start_time, end_time, segments) VALUES (?, ?, ?, ?, ?, ?)",
            (ep["id"], n, section["title"], section["start"], section["end"], pack(segments) if segments else None),
        ).lastrowid
        conn.execute("INSERT INTO sections_fts (rowid, heading_norm, text_norm) VALUES (?, ?, ?)",
                     (section_id, *section_norms(ep["title"], section)))
        section_ids.append(section_id)

    docs = [d for d in built["docs"] if d["section"] is not None]
    if len(docs) != len(vectors):
        raise ValueError(f"{ep['id']}: {len(docs)} docs open a section, but {len(vectors)} vectors")
    if docs:
        bits, int8, scales = quantize(np.asarray(vectors, dtype=np.float32))
        conn.executemany(
            "INSERT INTO vectors (kind, episode_id, channel_id, section_id, doc_hash, bits, int8, scale)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(d["kind"], d["episode_id"], d["channel_id"], section_ids[d["section"]], d["hash"],
              bits[i].tobytes(), int8[i].tobytes(), float(scales[i])) for i, d in enumerate(docs)],
        )


def delete_episode(conn, episode_id):
    """Remove an episode, its sections, index rows and vectors. True if it was there. Doesn't commit."""
    conn.execute(
        "INSERT INTO deleted_vectors (vector_id) SELECT id FROM vectors WHERE episode_id = ? ORDER BY id",
        (episode_id,))
    conn.execute("DELETE FROM vectors WHERE episode_id = ?", (episode_id,))
    conn.execute("DELETE FROM sections_fts WHERE rowid IN (SELECT id FROM sections WHERE episode_id = ?)",
                 (episode_id,))
    conn.execute("DELETE FROM sections WHERE episode_id = ?", (episode_id,))
    return conn.execute("DELETE FROM episodes WHERE id = ?", (episode_id,)).rowcount > 0
