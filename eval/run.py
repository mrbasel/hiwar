"""Score search methods against the graded results.

    uv run python -m eval.run [METHOD ...] [--strict] [--queries]

Reads eval/runs/<method>.jsonl (from eval.retrieve) and every known grade
(eval.data.load_grades) and prints, per method, overall and per query type:

nDCG@10   quality of the first page, 0-1. Uses the 0/1/2 grades, so a 2
          near the top counts more than a 1; 1.0 means the best known
          results, in the best order.
MRR       1/rank of the first relevant result (grade 1 or 2), averaged:
          1.0 = always first, 0.5 = usually second.
P@5       share of the top 5 that is relevant.
R@10      share of all known relevant results that are in the top 10.
judged    share of the top 10 that has a grade. Ungraded results count as
          not relevant, so below ~90% the scores are too low; grade more.
unconf    share of the grades used that are Jev's alone (not yours, not
          confirmed by the check model). --strict ignores those grades.

Queries with no known relevant result are left out of the averages (and
listed); a query where the method returns nothing scores 0.
"""

import argparse
import math
from collections import defaultdict

from .data import MIN_OVERLAP, load_grades, load_queries, load_runs

K = 10


def lookup(spans, result):
    """(grade, source) of the graded span covering most of the result, or None."""
    length = max(result["end"] - result["start"], 1e-9)
    best, best_overlap = None, 0.0
    for (episode_id, start, end), value in spans.items():
        if episode_id != result["episode_id"]:
            continue
        overlap = min(end, result["end"]) - max(start, result["start"])
        if overlap > best_overlap:
            best, best_overlap = value, overlap
    return best if best_overlap / length >= MIN_OVERLAP else None


def dcg(grades):
    return sum(g / math.log2(i + 2) for i, g in enumerate(grades))


def score_query(results, spans):
    top = [lookup(spans, r) for r in results[:K]]
    grades = [v[0] if v else 0 for v in top]
    known = sorted((g for g, _ in spans.values()), reverse=True)
    relevant = sum(g > 0 for g in known)
    ideal = dcg(known[:K])
    first = next((i for i, g in enumerate(grades) if g > 0), None)
    used = [v for v in top if v]
    return {
        "ndcg": dcg(grades) / ideal if ideal else None,
        "mrr": 1 / (first + 1) if first is not None else 0.0,
        "p5": sum(g > 0 for g in grades[:5]) / 5,
        "r10": sum(g > 0 for g in grades) / relevant if relevant else None,
        "judged": len(used) / len(top) if top else None,
        "unconf": sum(src == "jev" for _, src in used),
        "graded": len(used),
        "relevant": relevant,
        "empty": not results,
    }


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float("nan")


def row(label, scores):
    n = len(scores)
    graded = sum(s["graded"] for s in scores)
    unconf = sum(s["unconf"] for s in scores) / graded if graded else 0
    return (f"{label:<12}{n:>4}{mean(s['ndcg'] for s in scores):>9.3f}{mean(s['mrr'] for s in scores):>7.3f}"
            f"{mean(s['p5'] for s in scores):>7.3f}{mean(s['r10'] for s in scores):>7.3f}"
            f"{mean(s['judged'] for s in scores):>8.0%}{unconf:>8.0%}{sum(s['empty'] for s in scores):>7}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("methods", nargs="*", help="default: every run in eval/runs/")
    parser.add_argument("--strict", action="store_true", help="only your grades and confirmed model grades")
    parser.add_argument("--queries", action="store_true", help="also print a line per query")
    args = parser.parse_args()

    queries = load_queries()
    runs = load_runs()
    grades = load_grades(unconfirmed=not args.strict)
    methods = args.methods or list(runs)

    header = f"{'':<12}{'n':>4}{'nDCG@10':>9}{'MRR':>7}{'P@5':>7}{'R@10':>7}{'judged':>8}{'unconf':>8}{'empty':>7}"
    for name in methods:
        run = runs[name]
        built = {line["built_at"] for line in run.values()}
        times = sorted(line["took_ms"] for line in run.values())
        p95 = times[min(len(times) - 1, math.ceil(0.95 * len(times)) - 1)]
        print(f"\n== {name}  (build {', '.join(sorted(built))}; "
              f"latency p50 {times[len(times) // 2]:.0f} ms, p95 {p95:.0f} ms)")

        scored, skipped = [], []
        by_type = defaultdict(list)
        for q in queries:
            s = score_query(run[q["id"]]["results"], grades.get(q["id"], {}))
            if not s["relevant"]:
                skipped.append(q)
                continue
            scored.append((q, s))
            by_type[q["type"]].append(s)

        print(header)
        print(row("all", [s for _, s in scored]))
        for t in sorted(by_type, key=lambda t: -len(by_type[t])):
            print(row(t, by_type[t]))
        if skipped:
            print("no known relevant results, not scored: "
                  + ", ".join(f"{q['id']} {q['q']}" for q in skipped))

        if args.queries:
            print(f"\n{'query':<40}{'nDCG@10':>9}{'MRR':>7}{'P@5':>7}{'R@10':>7}{'judged':>8}{'rel':>6}")
            for q, s in sorted(scored, key=lambda p: p[1]["ndcg"]):
                label = f"{q['id']} {q['q']}"[:38]
                print(f"{label:<40}{s['ndcg']:>9.3f}{s['mrr']:>7.3f}{s['p5']:>7.3f}"
                      f"{s['r10']:>7.3f}{s['judged']:>8.0%}{s['relevant']:>6}" if not s["empty"] else
                      f"{label:<40}{'no results':>9}{'':>29}{s['relevant']:>6}")


if __name__ == "__main__":
    main()
