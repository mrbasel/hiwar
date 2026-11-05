"""SQLite schema and writes.

episodes  one row per video with a usable Arabic transcript
sections  chapter-sized blocks of an episode; what gets searched and read
segments  utterances (caption lines merged at speaker changes and pauses,
          ~5-15 s each) with timestamps, for citing a moment
sections_fts  FTS5 index over the normalized episode title + section title and text

`text` columns are for display; `*_norm` columns hold the same text after
`normalize()` and are what the index sees. Times are seconds from the start.
"""

import json
import re
import sqlite3

from .normalize import normalize

SCHEMA = """
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT,
    handle TEXT,
    url TEXT
);

CREATE TABLE episodes (
    id TEXT PRIMARY KEY,               -- YouTube video id
    channel_id TEXT REFERENCES channels(id),
    show TEXT,
    title TEXT,
    date TEXT,                         -- YYYY-MM-DD
    duration REAL,
    url TEXT,
    description TEXT,
    chapters TEXT,                     -- JSON list of {title, start, end}, as on YouTube
    transcript_source TEXT,            -- 'human' or 'auto'
    word_count INTEGER,                -- after cleaning
    boilerplate_words INTEGER          -- removed by cleaning
);
CREATE INDEX episodes_channel ON episodes(channel_id, date);

CREATE TABLE sections (
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

CREATE TABLE segments (
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    idx INTEGER NOT NULL,
    section_id INTEGER NOT NULL REFERENCES sections(id),
    start_time REAL,
    end_time REAL,
    text TEXT,
    speaker_change INTEGER,            -- 1 if a new speaker starts this utterance
    PRIMARY KEY (episode_id, idx)
) WITHOUT ROWID;
CREATE INDEX segments_section ON segments(section_id);

CREATE VIRTUAL TABLE sections_fts USING fts5(
    heading_norm, text_norm,
    content='sections', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE build_info (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def create(path):
    conn = sqlite3.connect(path)
    conn.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;" + SCHEMA)
    return conn


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
        heading = f"{episode['title'] or ''} | {section['title']}"
        section_id = conn.execute(
            "INSERT INTO sections (episode_id, idx, title, start_time, end_time, text, heading_norm, text_norm)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                episode["id"], n, section["title"], section["start"], section["end"],
                section["text"], normalize(heading), normalize(section["text"]),
            ),
        ).lastrowid
        rows = []
        for seg in section["segments"]:
            rows.append((
                episode["id"], seg_idx, section_id, seg["start"], seg["end"],
                re.sub(r"\s*>>\s*", " ", seg["text"]).strip(), int(seg["text"].startswith(">>")),
            ))
            seg_idx += 1
        conn.executemany("INSERT INTO segments VALUES (?, ?, ?, ?, ?, ?, ?)", rows)


def finish(conn, info):
    conn.execute("INSERT INTO sections_fts(sections_fts) VALUES ('rebuild')")
    conn.executemany(
        "INSERT INTO build_info VALUES (?, ?)",
        [(k, json.dumps(v, ensure_ascii=False)) for k, v in info.items()],
    )
    conn.commit()
    conn.execute("ANALYZE")
    conn.close()
