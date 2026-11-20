"""Build, embed and publish the uploads waiting in the server's inbox.

    python -m pipeline.worker [--db PATH] [--lock PATH] [--model MODEL] [--batch N]

Runs on the server, started by `rawi-ingest add` after an upload and by a
timer. Takes BATCH uploads at a time, oldest first: builds each in memory
(pipeline/episode.py), embeds all their documents with OpenRouter, then adds
each episode in a transaction of its own that also takes it out of the inbox,
so the API can show it at once. An upload of an episode that's already
published replaces it.

An upload that can't be built is recorded as a failed video and dropped. If
embedding fails, the batch stays in the inbox with the error and the run
stops; uploads that failed MAX_ATTEMPTS runs are left there (`rawi-ingest
plan` counts them). One run at a time: a second one exits at once. The lock
is RAWI_WORKER_LOCK if set, so a switch to another database can wait for it.
"""

import argparse
import fcntl
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .episode import build_episode
from .openrouter import api_key, embed
from .serve_db import connect, delete_episode, insert_episode, now, set_info, unpack

BATCH = 50
EMBED_BATCH = 64
EMBED_WORKERS = 4
MAX_ATTEMPTS = 5


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def build_all(conn, rows):
    """Built episodes of the uploads; those that can't be built are dropped as failed videos."""
    built = []
    for video_id, folder, info, captions in rows:
        try:
            built.append(build_episode(unpack(info), folder, unpack(captions) if captions else {}))
        except Exception as e:
            log(f"  {video_id}: can't build it: {e!r}")
            conn.execute("UPDATE videos SET status = 'failed', reason = ?, updated_at = ? WHERE id = ?",
                         (f"upload can't be built: {e!r}"[:500], now(), video_id))
            conn.execute("DELETE FROM inbox WHERE video_id = ?", (video_id,))
    conn.commit()
    return built


def embed_all(texts, model, key):
    batches = [texts[i:i + EMBED_BATCH] for i in range(0, len(texts), EMBED_BATCH)]
    with ThreadPoolExecutor(EMBED_WORKERS) as pool:
        return np.concatenate(list(pool.map(lambda b: embed(model, b, key), batches)))


def publish(conn, built, vectors):
    """Add each episode with its vectors, one transaction each. Returns how many replaced one."""
    replaced, i = 0, 0
    for b in built:
        ep = b["episode"]
        n = sum(d["section"] is not None for d in b["docs"])
        with conn:
            replaced += delete_episode(conn, ep["id"])
            insert_episode(conn, b, vectors[i:i + n])
            conn.execute(
                "UPDATE videos SET status = 'built', reason = ?, channel_id = ?, updated_at = ? WHERE id = ?",
                (b["reason"], ep["channel_id"], now(), ep["id"]))
            conn.execute("DELETE FROM inbox WHERE video_id = ?", (ep["id"],))
            set_info(conn, published_at=now())
        i += n
    return replaced


def run(conn, model, batch):
    """Work through the inbox. Returns (episodes published, whether embedding failed)."""
    key, done = None, 0
    while True:
        rows = conn.execute(
            "SELECT video_id, folder, info, captions FROM inbox WHERE attempts < ?"
            " ORDER BY received_at, video_id LIMIT ?", (MAX_ATTEMPTS, batch)).fetchall()
        if not rows:
            return done, False
        built = build_all(conn, rows)
        if not built:
            continue
        docs = [d for b in built for d in b["docs"] if d["section"] is not None]
        try:
            key = key or api_key()
            vectors = embed_all([d["text"] for d in docs], model, key) if docs else np.zeros((0, 0))
        except Exception as e:
            log(f"embedding failed, leaving {len(built)} uploads for the next run: {e}")
            conn.executemany("UPDATE inbox SET attempts = attempts + 1, error = ? WHERE video_id = ?",
                             [(str(e)[:500], b["episode"]["id"]) for b in built])
            conn.commit()
            return done, True
        replaced = publish(conn, built, vectors)
        done += len(built)
        log(f"published {len(built)} episodes ({len(docs)} documents)"
            + (f", {replaced} of them replacing older versions" if replaced else ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=os.environ.get("DB_PATH", "rawi.db"))
    parser.add_argument("--lock", default=os.environ.get("RAWI_WORKER_LOCK"))
    parser.add_argument("--model", default="baai/bge-m3")
    parser.add_argument("--batch", type=int, default=BATCH)
    args = parser.parse_args()

    lock = open(args.lock or f"{args.db}.worker-lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("another run is working through the inbox")
        return

    conn = connect(args.db)
    row = conn.execute("SELECT value FROM build_info WHERE key = 'model'").fetchone()
    if not row:
        set_info(conn, model=args.model)
        conn.commit()
    elif json.loads(row[0]) != args.model:
        raise SystemExit(f"{args.db} holds {json.loads(row[0])} vectors, not {args.model}")
    started = time.time()
    done, failed = run(conn, args.model, args.batch)
    if done or failed:
        log(f"done in {time.time() - started:.0f}s: {done} episodes published")
    conn.close()
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
