"""Semantic search over the documents `search.embed` keeps in the database.

Brute force: the query vector against every document vector, held in memory.
Results are sections, like the other methods: each document is stored with
the section a hit on it opens, a chapter's the section that overlaps it most
and an episode's its first section.

Query vectors are cached in embeddings/<model>/queries.jsonl, keyed by the
exact query text, so repeated runs over the eval queries make no API calls.
"""

import json
from functools import cache

import numpy as np

from .embed import out_dir
from .openrouter import api_key, embed


@cache
def load(conn, model):
    """Vectors, kinds and section ids of the model's documents with a section."""
    table = conn.execute("SELECT table_name FROM embedding_models WHERE model = ?", (model,)).fetchone()[0]
    rows = conn.execute(
        f"SELECT vector, kind, section_id FROM {table} WHERE section_id IS NOT NULL ORDER BY id").fetchall()
    vectors = np.frombuffer(b"".join(r[0] for r in rows), dtype="<f2").reshape(len(rows), -1)
    return vectors.astype(np.float32), [r[1] for r in rows], [r[2] for r in rows]


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


def search(conn, query, k, model):
    vectors, kinds, sections = load(conn, model)
    scores = vectors @ embed_query(model, query)
    results, seen = [], set()
    for i in np.argsort(-scores):
        if sections[i] in seen:
            continue
        seen.add(sections[i])
        section = conn.execute(
            "SELECT episode_id, idx, start_time, end_time FROM sections WHERE id = ?", (sections[i],)).fetchone()
        if section is None:  # episode gone from the database
            continue
        episode_id, idx, start, end = section
        results.append({"episode_id": episode_id, "idx": idx, "start": start, "end": end,
                        "score": round(float(scores[i]), 4), "doc": kinds[i]})
        if len(results) == k:
            break
    return results
