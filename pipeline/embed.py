"""Embed episode metadata for semantic search.

    uv run python -m pipeline.embed [--db PATH] [--model MODEL] [--limit N]

Two kinds of documents, both from the `episodes` table:

episode  title, description and chapter titles
chapter  episode title and chapter title, with the chapter's start and end

Both go in one table in the database, embeddings_<model name>
(embeddings_bge_m3 for baai/bge-m3), one row per document: its unit-length
vector as float16, its channel, and the section a hit on it opens. A chapter's
is the section that overlaps it most, an episode's its first section; NULL if
there's none. Searches load the whole table into memory: unfiltered ones go
through an HNSW index of it (see pipeline.hnsw), rebuilt at the end of every
run that changed the table, and ones limited to some channels scan their rows.
`embedding_models` records each model's table and the build it was last
brought up to date with.

Documents are keyed by a hash of their kind, episode, times and text, and only
new ones are embedded; ones no longer built from the database are dropped.
Each batch is committed as it finishes, so a run that fails partway resumes
where it stopped. Sections are looked up again on every run, without API calls.
Runs take scripts/update.sh's lock, so the two never write at once.
"""

import argparse
import fcntl
import hashlib
import json
import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import hnsw
from .openrouter import api_key, embed

ROOT = Path(__file__).parent.parent / "embeddings"
LOCK = Path(__file__).parent.parent / "logs/update/.lock"
MAX_CHARS = 6000  # well inside the model's context, even for Arabic
BATCH = 64

TABLE = """
CREATE TABLE IF NOT EXISTS {table} (
    id INTEGER PRIMARY KEY,
    kind TEXT,                         -- 'episode' or 'chapter'
    episode_id TEXT,
    channel_id TEXT,
    section_id INTEGER,
    start_time REAL,
    end_time REAL,
    doc_hash TEXT UNIQUE,
    vector BLOB                        -- little-endian float16, unit length
)
"""


def out_dir(model):
    return ROOT / model.split("/")[-1]


def index_path(model):
    return out_dir(model) / "hnsw.usearch"


def table_name(model):
    return "embeddings_" + re.sub(r"\W", "_", model.split("/")[-1])


def build_docs(conn, limit=None):
    docs = []
    rows = conn.execute(
        "SELECT id, coalesce(channel_id, ''), title, description, chapters, duration FROM episodes ORDER BY id"
        + (f" LIMIT {int(limit)}" if limit else "")
    )
    for episode_id, channel_id, title, description, chapters, duration in rows:
        title = title or ""
        chapters = json.loads(chapters or "[]")
        text = "\n".join([title, description or "", *(c["title"] for c in chapters)])
        docs.append({"kind": "episode", "episode_id": episode_id, "channel_id": channel_id,
                     "start": 0, "end": duration, "text": text.strip()[:MAX_CHARS]})
        for c in chapters:
            docs.append({"kind": "chapter", "episode_id": episode_id, "channel_id": channel_id,
                         "start": c["start"], "end": c["end"], "text": f"{title} | {c['title']}"})
    for d in docs:
        key = json.dumps([d["kind"], d["episode_id"], d["start"], d["end"], d["text"]], ensure_ascii=False)
        d["hash"] = hashlib.sha1(key.encode()).hexdigest()
    return docs


def section_id(conn, doc):
    if doc["kind"] == "chapter":
        row = conn.execute(
            """SELECT id FROM sections
               WHERE episode_id = ? AND start_time < ? AND end_time > ?
               ORDER BY min(end_time, ?) - max(start_time, ?) DESC LIMIT 1""",
            (doc["episode_id"], doc["end"], doc["start"], doc["end"], doc["start"]),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT id FROM sections WHERE episode_id = ? ORDER BY idx LIMIT 1", (doc["episode_id"],)
        ).fetchone()
    return row and row[0]


def insert(conn, table, docs, vectors):
    conn.executemany(
        f"""INSERT INTO {table} (kind, episode_id, channel_id, section_id, start_time, end_time,
                                 doc_hash, vector)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [(d["kind"], d["episode_id"], d["channel_id"], d["section_id"], d["start"], d["end"], d["hash"],
          v.astype("<f2").tobytes()) for d, v in zip(docs, vectors)],
    )


def sync(conn, table, docs, keep_stale=False):
    """Drops stale rows and updates kept ones; returns the documents still to embed."""
    current = {d["hash"]: d for d in docs}
    stored = {h: (rowid, channel, section) for rowid, h, channel, section in
              conn.execute(f"SELECT id, doc_hash, channel_id, section_id FROM {table}")}
    stale = [rowid for h, (rowid, _, _) in stored.items() if h not in current]
    if stale and not keep_stale:
        conn.executemany(f"DELETE FROM {table} WHERE id = ?", [(r,) for r in stale])
        print(f"dropped {len(stale)} documents no longer in the database")
    changed = 0
    for h, (rowid, channel, section) in stored.items():
        d = current.get(h)
        if d and (d["channel_id"], d["section_id"]) != (channel, section):
            conn.execute(f"UPDATE {table} SET channel_id = ?, section_id = ? WHERE id = ?",
                         (d["channel_id"], d["section_id"], rowid))
            changed += 1
    if changed:
        print(f"moved {changed} documents to other sections or channels")
    conn.commit()
    return [d for h, d in current.items() if h not in stored]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--model", default="baai/bge-m3")
    parser.add_argument("--limit", type=int, help="only the first N episodes, for quick checks; drops nothing")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    lock = LOCK.open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("an update is running; try again when it's done")

    conn = sqlite3.connect(args.db, timeout=60)
    table = table_name(args.model)
    conn.execute(TABLE.format(table=table))
    conn.execute("""CREATE TABLE IF NOT EXISTS embedding_models (
                        model TEXT PRIMARY KEY, table_name TEXT, built_at TEXT)""")
    built_at = json.loads(conn.execute("SELECT value FROM build_info WHERE key = 'built_at'").fetchone()[0])
    docs = build_docs(conn, args.limit)
    for d in docs:
        d["section_id"] = section_id(conn, d)

    todo = sync(conn, table, docs, keep_stale=bool(args.limit))
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    print(f"{len(docs)} documents, {len(todo)} to embed in {len(batches)} batches with {args.model}")

    key = api_key() if todo else None
    started, done = time.time(), 0
    with ThreadPoolExecutor(args.workers) as pool:
        work = lambda batch: embed(args.model, [d["text"] for d in batch], key)  # noqa: E731
        for batch, vectors in zip(batches, pool.map(work, batches)):
            insert(conn, table, batch, vectors)
            conn.commit()
            done += len(batch)
            if done % (BATCH * 100) < BATCH:
                print(f"  {done} documents in {time.time() - started:.0f}s", flush=True)

    if args.limit:
        return  # the table isn't up to date with the build
    conn.execute("INSERT OR REPLACE INTO embedding_models VALUES (?, ?, ?)", (args.model, table, built_at))
    conn.commit()
    print(f"{table}: {conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]} documents")
    hnsw.build(conn, table, index_path(args.model))


if __name__ == "__main__":
    main()
