"""Search methods under evaluation.

Each method takes (conn, query, k) and returns up to k sections, best first,
as dicts with episode_id, idx, start, end and score. Register new methods in
METHODS so `eval.retrieve` runs them.
"""

import re

from pipeline.normalize import normalize
from . import semantic

# Same as services/api/src/db/queries.ts, so the baseline is what the site serves.
HEADING_WEIGHT = 3
TEXT_WEIGHT = 1

WORD = re.compile(r"[^\W_]+")  # letters and digits, like services/api/src/normalize.ts words()


def bm25(conn, query, k):
    """FTS5 over sections: every query word must match, ranked by BM25."""
    terms = list(dict.fromkeys(WORD.findall(normalize(query))))
    if not terms:
        return []
    rows = conn.execute(
        f"""SELECT s.episode_id, s.idx, s.start_time, s.end_time,
                   bm25(sections_fts, {HEADING_WEIGHT}, {TEXT_WEIGHT}) AS score
            FROM sections_fts JOIN sections s ON s.id = sections_fts.rowid
            WHERE sections_fts MATCH ?
            ORDER BY score
            LIMIT ?""",
        (" AND ".join(f'"{t}"' for t in terms), k),
    ).fetchall()
    return [
        {"episode_id": e, "idx": i, "start": s, "end": t, "score": round(sc, 4)}
        for e, i, s, t, sc in rows
    ]


def semantic_bge_m3(conn, query, k):
    """Embeddings of episode metadata (title, description, chapters) with BGE-M3."""
    return semantic.search(conn, query, k, "baai/bge-m3")


def semantic_bge_m3_quantized(conn, query, k):
    """semantic_bge_m3 over sign bits rescored with int8 vectors, as the site searches."""
    return semantic.search(conn, query, k, "baai/bge-m3", quantized=True)


RRF_K = 60  # the usual constant; larger flattens the gap between ranks
RRF_DEPTH = 50  # results taken from each method before fusing


def rrf(rankings, k):
    """Reciprocal rank fusion: each section scores sum(1 / (RRF_K + rank)) over the rankings."""
    scores, results = {}, {}
    for ranking in rankings:
        for rank, r in enumerate(ranking, 1):
            key = (r["episode_id"], r["idx"])
            scores[key] = scores.get(key, 0) + 1 / (RRF_K + rank)
            results.setdefault(key, r)
    best = sorted(scores, key=scores.get, reverse=True)[:k]
    return [{**{f: results[key][f] for f in ("episode_id", "idx", "start", "end")},
             "score": round(scores[key], 5)} for key in best]


def hybrid_bge_m3(conn, query, k):
    """BM25 and semantic_bge_m3, fused with RRF."""
    return rrf([bm25(conn, query, RRF_DEPTH), semantic_bge_m3(conn, query, RRF_DEPTH)], k)


def hybrid_bge_m3_quantized(conn, query, k):
    """BM25 and semantic_bge_m3_quantized, fused with RRF: what the site serves."""
    return rrf([bm25(conn, query, RRF_DEPTH), semantic_bge_m3_quantized(conn, query, RRF_DEPTH)], k)


METHODS = {
    "bm25": bm25,
    "semantic_bge_m3": semantic_bge_m3,
    "hybrid_bge_m3": hybrid_bge_m3,
    "semantic_bge_m3_quantized": semantic_bge_m3_quantized,
    "hybrid_bge_m3_quantized": hybrid_bge_m3_quantized,
}
