"""Embed episode metadata for semantic search.

    uv run python -m search.embed [--db PATH] [--model MODEL] [--limit N]

Two kinds of documents, both from the `episodes` table:

episode  title, description and chapter titles
chapter  episode title and chapter title, with the chapter's start and end

Writes embeddings/<model name>/: vectors.npy (float16, unit length, one row per
document), docs.jsonl (the documents, in the same order) and meta.json.
Everything is re-embedded on every run, but each batch is saved to parts/ as
it finishes, so a run that fails partway resumes where it stopped. parts/ is
keyed by a hash of all the document texts and cleared when they change.
"""

import argparse
import hashlib
import json
import shutil
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .openrouter import api_key, embed

ROOT = Path(__file__).parent.parent / "embeddings"
MAX_CHARS = 6000  # well inside the model's context, even for Arabic
BATCH = 64


def out_dir(model):
    return ROOT / model.split("/")[-1]


def build_docs(conn, limit=None):
    docs = []
    rows = conn.execute(
        "SELECT id, title, description, chapters, duration FROM episodes ORDER BY id"
        + (f" LIMIT {int(limit)}" if limit else "")
    )
    for episode_id, title, description, chapters, duration in rows:
        title = title or ""
        chapters = json.loads(chapters or "[]")
        text = "\n".join([title, description or "", *(c["title"] for c in chapters)])
        docs.append({"kind": "episode", "episode_id": episode_id, "start": 0, "end": duration,
                     "text": text.strip()[:MAX_CHARS]})
        for n, c in enumerate(chapters):
            docs.append({"kind": "chapter", "episode_id": episode_id, "chapter": n,
                         "start": c["start"], "end": c["end"], "text": f"{title} | {c['title']}"})
    return docs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--model", default="baai/bge-m3")
    parser.add_argument("--limit", type=int, help="only the first N episodes, for quick checks")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    built_at = json.loads(conn.execute("SELECT value FROM build_info WHERE key = 'built_at'").fetchone()[0])
    docs = build_docs(conn, args.limit)
    batches = [docs[i:i + BATCH] for i in range(0, len(docs), BATCH)]
    print(f"{len(docs)} documents in {len(batches)} batches with {args.model}")

    out = out_dir(args.model)
    parts_dir = out / "parts"
    fingerprint = hashlib.sha1("\0".join(d["text"] for d in docs).encode()).hexdigest()
    stamp = parts_dir / "fingerprint"
    if stamp.exists() and stamp.read_text() != fingerprint:
        shutil.rmtree(parts_dir)
    parts_dir.mkdir(parents=True, exist_ok=True)
    stamp.write_text(fingerprint)

    todo = [i for i in range(len(batches)) if not (parts_dir / f"{i}.npy").exists()]
    if len(todo) < len(batches):
        print(f"resuming: {len(batches) - len(todo)} batches already done")

    key = api_key()
    started, done = time.time(), 0

    def work(i):
        vectors = embed(args.model, [d["text"] for d in batches[i]], key)
        np.save(parts_dir / f"{i}.tmp.npy", vectors.astype(np.float16))
        (parts_dir / f"{i}.tmp.npy").rename(parts_dir / f"{i}.npy")
        return len(batches[i])

    with ThreadPoolExecutor(args.workers) as pool:
        for n in pool.map(work, todo):
            done += n
            if done % (BATCH * 100) < BATCH:
                print(f"  {done} documents in {time.time() - started:.0f}s", flush=True)

    vectors = np.concatenate([np.load(parts_dir / f"{i}.npy") for i in range(len(batches))])
    np.save(out / "vectors.npy", vectors)
    with (out / "docs.jsonl").open("w", encoding="utf-8") as f:
        for d in docs:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    (out / "meta.json").write_text(json.dumps(
        {"model": args.model, "built_at": built_at, "docs": len(docs), "dims": vectors.shape[1]}, indent=2))
    shutil.rmtree(parts_dir)
    print(f"{vectors.shape} -> {out}")


if __name__ == "__main__":
    main()
