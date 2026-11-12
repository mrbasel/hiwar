"""SQLite schema and writes.

sources   channels and playlists from sources.toml, with their download status
videos    every video we've looked at and what happened to it; the download
          archive (videos here are never fetched again) and the build queue
episodes  one row per video; those without a usable Arabic transcript have
          empty sections from their chapters and no segments
sections  chapter-sized blocks of an episode; what gets searched and read
segments  utterances (caption lines merged at speaker changes and pauses,
          ~5-15 s each) with timestamps, for citing a moment
sections_fts  FTS5 index over the normalized episode title + section title and text

`text` columns are for display; `*_norm` columns hold the same text after
`normalize()` and are what the index sees. Times are seconds from the start.
The schema is created on open, so an empty file becomes a new database.
"""

import json
import re
import sqlite3
import time

from .normalize import normalize

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    url TEXT PRIMARY KEY,              -- as written in sources.toml
    kind TEXT,                         -- 'channel' (its Videos tab) or 'playlist'
    status TEXT,                       -- 'backfilling', 'complete' or 'no_captions'
    captions_seen INTEGER DEFAULT 0,   -- 1 once a video with Arabic captions came from it
    added_at TEXT,
    checked_at TEXT,                   -- last run that listed it without a rate limit
    last_new_at TEXT                   -- last run that found a new video
);

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,               -- YouTube video id
    source TEXT,                       -- sources.url it was downloaded from; NULL if found in data/
    channel_id TEXT,
    path TEXT,                         -- data/-relative path without extension; NULL once deleted
    upload_date TEXT,                  -- YYYYMMDD
    status TEXT,                       -- 'downloaded', 'failed', 'no_captions', 'built' or 'skipped' (by old builds)
    reason TEXT,                       -- which track failed, or why it was built without a transcript
    attempts INTEGER DEFAULT 0,        -- caption downloads retried after failing
    first_seen TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS videos_channel ON videos(channel_id);

CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT,
    handle TEXT,
    url TEXT
);

CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,               -- YouTube video id
    channel_id TEXT REFERENCES channels(id),
    show TEXT,
    title TEXT,
    date TEXT,                         -- YYYY-MM-DD
    duration REAL,
    url TEXT,
    description TEXT,
    chapters TEXT,                     -- JSON list of {title, start, end}, as on YouTube
    transcript_source TEXT,            -- 'human' or 'auto'; NULL without a transcript
    word_count INTEGER,                -- after cleaning
    boilerplate_words INTEGER          -- removed by cleaning
);
CREATE INDEX IF NOT EXISTS episodes_channel ON episodes(channel_id, date);

CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    idx INTEGER NOT NULL,              -- 1-based position in the episode
    title TEXT,
    start_time REAL,
    end_time REAL,
    text TEXT,                         -- one line per speaker turn
    heading_norm TEXT,                 -- episode title + section title
    text_norm TEXT,
    UNIQUE (episode_id, idx)
);

CREATE TABLE IF NOT EXISTS segments (
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    idx INTEGER NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    start_time REAL,
    end_time REAL,
    text TEXT,
    speaker_change INTEGER,            -- 1 if a new speaker starts this utterance
    PRIMARY KEY (episode_id, idx)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS segments_section ON segments(section_id);

CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
    heading_norm, text_norm,
    content='sections', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS build_info (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def connect(path):
    # WAL lets the web server keep reading while an update writes.
    conn = sqlite3.connect(path, timeout=60)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.executescript(SCHEMA)
    return conn


def read_build_info(conn):
    return {k: json.loads(v) for k, v in conn.execute("SELECT key, value FROM build_info")}


def write_build_info(conn, info):
    conn.executemany(
        "INSERT OR REPLACE INTO build_info VALUES (?, ?)",
        [(k, json.dumps(v, ensure_ascii=False)) for k, v in info.items()],
    )


def save_video(conn, video, source=None):
    """Insert or update one video from `download.classify()` (path relative to data/)."""
    t = now()
    conn.execute(
        "INSERT INTO videos (id, source, channel_id, path, upload_date, status, reason, first_seen, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT (id) DO UPDATE SET source = coalesce(excluded.source, source),"
        " channel_id = excluded.channel_id, path = excluded.path, upload_date = excluded.upload_date,"
        " status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at",
        (video["id"], source, video["channel_id"], video["path"], video["upload_date"],
         video["status"], video.get("reason"), t, t),
    )


def set_video_status(conn, video_id, status, reason=None):
    conn.execute(
        "UPDATE videos SET status = ?, reason = ?, updated_at = ? WHERE id = ?",
        (status, reason, now(), video_id),
    )


def insert_channel(conn, channel):
    conn.execute(
        "INSERT OR IGNORE INTO channels VALUES (?, ?, ?, ?)",
        (channel["channel_id"], channel["channel"], channel["handle"], channel["channel_url"]),
    )


def insert_episode(conn, episode, sections, boilerplate_words):
    words = sum(len(s["text"].split()) for s in sections)
    conn.execute(
        "INSERT INTO episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            episode["id"], episode["channel_id"], episode["show"], episode["title"],
            episode["date"], episode["duration"], episode["url"], episode["description"],
            json.dumps(episode["chapters"], ensure_ascii=False), episode["transcript_source"],
            words, boilerplate_words,
        ),
    )
    seg_idx = 0
    for n, section in enumerate(sections, 1):
        heading_norm = normalize(f"{episode['title'] or ''} | {section['title']}")
        text_norm = normalize(section["text"])
        section_id = conn.execute(
            "INSERT INTO sections (episode_id, idx, title, start_time, end_time, text, heading_norm, text_norm)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                episode["id"], n, section["title"], section["start"], section["end"],
                section["text"], heading_norm, text_norm,
            ),
        ).lastrowid
        conn.execute(
            "INSERT INTO sections_fts (rowid, heading_norm, text_norm) VALUES (?, ?, ?)",
            (section_id, heading_norm, text_norm),
        )
        rows = []
        for seg in section["segments"]:
            rows.append((
                episode["id"], seg_idx, section_id, seg["start"], seg["end"],
                re.sub(r"\s*>>\s*", " ", seg["text"]).strip(), int(seg["text"].startswith(">>")),
            ))
            seg_idx += 1
        conn.executemany("INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
