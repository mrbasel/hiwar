"""Semantic search over the documents `pipeline.embed` keeps in the database.

Brute force: the query vector against every document vector, held in memory;
or, with hnsw=True, the documents the HNSW index (pipeline.hnsw) finds, as the
site does for searches over every channel. Results are sections, like the
other methods: each document is stored with the section a hit on it opens, a
chapter's the section that overlaps it most and an episode's its first section.

Query vectors are cached in embeddings/<model>/queries.jsonl, keyed by the
exact query text, so repeated runs over the eval queries make no API calls.
"""

import json
from functools import cache

import numpy as np

from pipeline import hnsw as hnsw_index
from pipeline.embed import index_path, out_dir
from pipeline.openrouter import api_key, embed

HNSW_CANDIDATES = 1600  # as in services/api/src/search/semantic.ts


@cache
def load(conn, model):
    """Vectors, kinds, section ids and table ids of the model's documents with a section."""
    table = conn.execute("SELECT table_name FROM embedding_models WHERE model = ?", (model,)).fetchone()[0]
    rows = conn.execute(
        f"SELECT vector, kind, section_id, id FROM {table} WHERE section_id IS NOT NULL ORDER BY id").fetchall()
    vectors = np.frombuffer(b"".join(r[0] for r in rows), dtype="<f2").reshape(len(rows), -1)
    positions = {r[3]: i for i, r in enumerate(rows)}
    return vectors.astype(np.float32), [r[1] for r in rows], [r[2] for r in rows], positions


@cache
def load_hnsw(conn, model):
    table = conn.execute("SELECT table_name FROM embedding_models WHERE model = ?", (model,)).fetchone()[0]
    index = hnsw_index.load(index_path(model))
    if not hnsw_index.is_current(index, hnsw_index.table_ids(conn, table)):
        raise SystemExit(f"{index_path(model)} is missing or out of date; run pipeline.embed")
    return index


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


def search(conn, query, k, model, hnsw=False):
    vectors, kinds, sections, positions = load(conn, model)
    q = embed_query(model, query)
    if hnsw:
        keys = load_hnsw(conn, model).search(q, HNSW_CANDIDATES).keys
        order = [positions[key] for key in keys.tolist() if key in positions]
        scores = dict(zip(order, (vectors[order] @ q).tolist()))
    else:
        scores = vectors @ q
        order = np.argsort(-scores)
    results, seen = [], set()
    for i in order:
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
