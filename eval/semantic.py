"""Semantic search over the documents `pipeline.embed` keeps in the database.

Brute force: the query vector against every document vector, held in memory;
or, with quantized=True, as the site searches (services/api/src/search/semantic.ts):
the documents nearest by the Hamming distance of their sign bits, rescored
with int8 vectors (see pipeline.export). Results are sections, like the
other methods: each document is stored with the section a hit on it opens, a
chapter's the section that overlaps it most and an episode's its first section.

Query vectors are cached in embeddings/<model>/queries.jsonl, keyed by the
exact query text, so repeated runs over the eval queries make no API calls.
"""

import json
from functools import cache

import numpy as np

from pipeline.embed import out_dir
from pipeline.export import quantize
from pipeline.openrouter import api_key, embed

# As in services/api/src/search/semantic.ts.
RESCORED_PER_DOC = 20
MIN_RESCORED = 4000


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
def load_quantized(conn, model):
    vectors = load(conn, model)[0]
    _, int8, scales = quantize(vectors)
    return vectors > 0, int8.astype(np.float32) * scales[:, None]


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


def search(conn, query, k, model, quantized=False):
    vectors, kinds, sections, _ = load(conn, model)
    q = embed_query(model, query)
    if quantized:
        # The site takes 4k docs (k sections) and widens if they cover fewer; at
        # this depth they always cover them.
        signs, rescored = load_quantized(conn, model)
        n = max(4 * k * RESCORED_PER_DOC, MIN_RESCORED)
        distances = (signs != (q > 0)).sum(axis=1)
        candidates = np.flatnonzero(distances <= np.sort(distances)[n - 1])
        scores = dict(zip(candidates.tolist(), (rescored[candidates] @ q).tolist()))
        order = sorted(scores, key=scores.get, reverse=True)
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
