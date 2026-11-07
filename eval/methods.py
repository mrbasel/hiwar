"""Search methods under evaluation.

Each method takes (conn, query, k) and returns up to k sections, best first,
as dicts with episode_id, idx, start, end and score. Register new methods in
METHODS so `eval.retrieve` runs them.
"""

import re

from pipeline.normalize import normalize

# Same as web/src/search.ts, so the baseline is what the site serves.
HEADING_WEIGHT = 3
TEXT_WEIGHT = 1

WORD = re.compile(r"[^\W_]+")  # letters and digits, like web/src/normalize.ts words()


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


METHODS = {
    "bm25": bm25,
}
