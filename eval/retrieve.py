"""Run search methods over the eval queries and save their rankings.

    uv run python -m eval.retrieve [METHOD ...] [--db PATH] [-k N]

Writes eval/runs/<method>.jsonl with one line per query: the ranked sections
and how long the search took. Each run records which build it ran against
(`built_at` from build_info); only compare runs from the same build.
"""

import argparse
import json
import sqlite3
import time

from .data import RUNS, load_queries
from .methods import METHODS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("methods", nargs="*", default=list(METHODS), help="default: all")
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("-k", type=int, default=50, help="results kept per query")
    args = parser.parse_args()

    unknown = set(args.methods) - set(METHODS)
    if unknown:
        parser.error(f"unknown methods: {', '.join(sorted(unknown))}")

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    built_at = json.loads(conn.execute("SELECT value FROM build_info WHERE key = 'built_at'").fetchone()[0])
    queries = load_queries()
    RUNS.mkdir(exist_ok=True)

    for name in args.methods:
        search = METHODS[name]
        lines, times, empty = [], [], 0
        for q in queries:
            started = time.perf_counter()
            results = search(conn, q["q"], args.k)
            took_ms = round((time.perf_counter() - started) * 1000, 1)
            times.append(took_ms)
            empty += not results
            lines.append({"qid": q["id"], "method": name, "built_at": built_at,
                          "took_ms": took_ms, "results": results})
        path = RUNS / f"{name}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for line in lines:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
        times.sort()
        print(f"{name}: {len(queries)} queries, {empty} with no results, "
              f"p50 {times[len(times) // 2]} ms, max {times[-1]} ms -> {path}")


if __name__ == "__main__":
    main()
