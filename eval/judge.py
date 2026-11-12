"""Local page for grading pooled search results 0/1/2.

    uv run python -m eval.judge [--db PATH] [--depth N] [--host HOST] [--port N]

The pool for a query is the top N results of every run in eval/runs/, plus
the best-ranked section of each of a run's top 10 episodes (so `eval.run
--episodes` has a grade for each), deduplicated and shuffled by episode, so
you can't tell which method or rank a result came from. An episode's sections
stay together, in the order they're in the episode, so you read it once. Grades are appended to eval/judgments.jsonl as you press keys.

Results with an accepted or tiebreak model grade (see eval.data) are marked
"auto" and skipped when moving to the next result, so you only review the
rest. The model's grade isn't shown; grade an auto result to override it.
"""

import argparse
import json
import random
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .data import (
    add_judgment, grade_of, load_judgments, load_model_grades, load_queries, load_runs, load_tiebreak_grades,
)

PAGE = Path(__file__).parent / "judge.html"


EPISODE_DEPTH = 10  # K in eval.run


def pool(runs, qid, depth):
    seen = {}
    for run in runs.values():
        results = run.get(qid, {}).get("results", [])
        firsts = {}
        for r in results:
            if len(firsts) == EPISODE_DEPTH:
                break
            firsts.setdefault(r["episode_id"], r)
        for r in results[:depth] + list(firsts.values()):
            seen.setdefault((r["episode_id"], r["idx"]), r)
    episodes = {}
    for r in seen.values():
        episodes.setdefault(r["episode_id"], []).append(r)
    groups = list(episodes.values())
    random.Random(qid).shuffle(groups)
    return [r for group in groups for r in sorted(group, key=lambda r: r["idx"])]


def auto_grades():
    spans = load_model_grades()
    for key, items in load_tiebreak_grades().items():
        spans[key] = spans[key] + items
    return spans


def make_handler(conn, depth):
    class Handler(BaseHTTPRequestHandler):
        def send(self, body, type="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", f"{type}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/":
                return self.send(PAGE.read_bytes(), "text/html")
            if url.path == "/api/queries":
                return self.send(self.queries())
            if url.path == "/api/pool":
                return self.send(self.items(parse_qs(url.query)["qid"][0]))
            self.send_error(404)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path != "/api/judge" or body["grade"] not in (0, 1, 2):
                return self.send_error(400)
            add_judgment(body["qid"], body["result"], body["grade"])
            self.send({"ok": True})

        def queries(self):
            runs, judgments, auto = load_runs(), load_judgments(), auto_grades()
            out = []
            for q in load_queries():
                items = pool(runs, q["id"], depth)
                judged = sum(grade_of(judgments, q["id"], r) is not None for r in items)
                review = sum(grade_of(judgments, q["id"], r) is None and grade_of(auto, q["id"], r) is None
                             for r in items)
                out.append({**q, "pooled": len(items), "judged": judged, "review": review})
            return out

        def items(self, qid):
            judgments, auto = load_judgments(), auto_grades()
            out = []
            for r in pool(load_runs(), qid, depth):
                row = conn.execute(
                    """SELECT e.title, e.show, e.date, e.url, s.id, s.title
                       FROM sections s JOIN episodes e ON e.id = s.episode_id
                       WHERE s.episode_id = ? AND s.idx = ?""",
                    (r["episode_id"], r["idx"]),
                ).fetchone()
                if row is None:  # run is from an older build
                    continue
                episode_title, show, date, url, section_id, section_title = row
                lines = conn.execute(
                    "SELECT start_time, text FROM segments WHERE section_id = ? ORDER BY idx", (section_id,),
                ).fetchall()
                out.append({
                    "result": {k: r[k] for k in ("episode_id", "idx", "start", "end")},
                    "grade": grade_of(judgments, qid, r),
                    "auto": grade_of(auto, qid, r) is not None,
                    "episode_title": episode_title, "show": show, "date": date,
                    "section_title": section_title,
                    "lines": [{"start": start, "text": text, "link": f"{url}&t={int(start)}s"}
                              for start, text in lines],
                    "link": f"{url}&t={int(r['start'])}s",
                })
            return out

        def log_message(self, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--depth", type=int, default=20, help="top N of each run to judge")
    parser.add_argument("--host", default="127.0.0.1", help="0.0.0.0 to reach it from other devices")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    server = HTTPServer((args.host, args.port), make_handler(conn, args.depth))
    print(f"Judging at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
