"""Semantic search over the documents written by `search.embed`.

Brute force: the query vector against every document vector. Results are
sections, like the other methods: a chapter hit becomes the section that
overlaps it most, and an episode hit the episode's first section.

Query vectors are cached in embeddings/<model>/queries.jsonl, keyed by the
exact query text, so repeated runs over the eval queries make no API calls.
"""

import json
from functools import cache

import numpy as np

from .embed import out_dir
from .openrouter import api_key, embed


@cache
def load(model):
    out = out_dir(model)
    vectors = np.load(out / "vectors.npy").astype(np.float32)
    docs = [json.loads(line) for line in (out / "docs.jsonl").open(encoding="utf-8")]
    return vectors, docs


@cache
def query_cache(model):
    path = out_dir(model) / "queries.jsonl"
    if not path.exists():
        return {}
    lines = (json.loads(line) for line in path.open(encoding="utf-8"))
    return {q["text"]: np.array(q["vector"], dtype=np.float32) for q in lines}


def embed_query(model, query):
    cached = query_cache(model)
    if query not in cached:
        vector = embed(model, [query], api_key())[0]
        with (out_dir(model) / "queries.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"text": query, "vector": vector.tolist()}, ensure_ascii=False) + "\n")
        cached[query] = vector
    return cached[query]


def to_section(conn, doc):
    if doc["kind"] == "chapter":
        return conn.execute(
            """SELECT idx, start_time, end_time FROM sections
               WHERE episode_id = ? AND start_time < ? AND end_time > ?
               ORDER BY min(end_time, ?) - max(start_time, ?) DESC LIMIT 1""",
            (doc["episode_id"], doc["end"], doc["start"], doc["end"], doc["start"]),
        ).fetchone()
    return conn.execute(
        "SELECT idx, start_time, end_time FROM sections WHERE episode_id = ? ORDER BY idx LIMIT 1",
        (doc["episode_id"],),
    ).fetchone()


def search(conn, query, k, model):
    vectors, docs = load(model)
    scores = vectors @ embed_query(model, query)
    results, seen = [], set()
    for i in np.argsort(-scores):
        section = to_section(conn, docs[i])
        if section is None or (docs[i]["episode_id"], section[0]) in seen:
            continue
        seen.add((docs[i]["episode_id"], section[0]))
        idx, start, end = section
        results.append({"episode_id": docs[i]["episode_id"], "idx": idx, "start": start, "end": end,
                        "score": round(float(scores[i]), 4), "doc": docs[i]["kind"]})
        if len(results) == k:
            break
    return results
