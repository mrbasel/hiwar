"""Loading the eval files: queries, method runs and judgments.

Judgments are keyed by time span (episode_id, start, end), not by section, so
they survive rebuilds that cut sections differently. A result takes the grade
of the judged span that covers most of it, if that covers at least half.

Model grades (eval/llm_judgments.jsonl, from eval.llm_judge) fill in what
you haven't graded, but only where they're trustworthy: the judge model is
confident and the check model gives the same grade. The rest get the
tiebreak model's grade, which is weaker: on such cases it matched about half
of your grades. Your own grades always win.
"""

import json
from collections import defaultdict
from pathlib import Path

EVAL_DIR = Path(__file__).parent
QUERIES = EVAL_DIR / "queries.jsonl"
RUNS = EVAL_DIR / "runs"
JUDGMENTS = EVAL_DIR / "judgments.jsonl"
LLM_JUDGMENTS = EVAL_DIR / "llm_judgments.jsonl"

MIN_OVERLAP = 0.5

# Accepted model grades. Calibrated against 46 of your grades: 32 accepted,
# all matching yours. Re-check with `eval.llm_judge calibrate` when changing.
PROMPT_VERSION = 2
JUDGE_MODEL = "typesafe/jev-1.14"
CHECK_MODEL = "anthropic/claude-haiku-5.5"
MIN_CONFIDENCE = 0.5
# Grades what the two above don't settle (`eval.llm_judge tiebreak`). On 33 of
# your grades they didn't settle it matched 16; Haiku 17, Jev 13, a median of
# the three 16.
TIEBREAK_MODEL = "claude-code/claude-opus-5-5"


def read_jsonl(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]


def load_queries():
    return read_jsonl(QUERIES)


def load_runs():
    """{method: {qid: run line}} for every file in runs/."""
    return {
        path.stem: {line["qid"]: line for line in read_jsonl(path)}
        for path in sorted(RUNS.glob("*.jsonl"))
    }


def load_judgments():
    """{(qid, episode_id): [(start, end, grade)]}. judgments.jsonl is append-only;
    a later line for the same span replaces an earlier one."""
    latest = {}
    for j in read_jsonl(JUDGMENTS):
        latest[(j["qid"], j["episode_id"], j["start"], j["end"])] = j["grade"]
    spans = defaultdict(list)
    for (qid, episode_id, start, end), grade in latest.items():
        spans[(qid, episode_id)].append((start, end, grade))
    return spans


def load_model_grades():
    """Accepted model grades, in the same shape as load_judgments()."""
    lines = {}
    for j in read_jsonl(LLM_JUDGMENTS):
        if j["prompt_version"] == PROMPT_VERSION and j["model"] in (JUDGE_MODEL, CHECK_MODEL):
            lines[(j["model"], j["qid"], j["episode_id"], j["start"], j["end"])] = j
    spans = defaultdict(list)
    for (model, qid, episode_id, start, end), j in lines.items():
        check = lines.get((CHECK_MODEL, qid, episode_id, start, end))
        if model == JUDGE_MODEL and j["confidence"] >= MIN_CONFIDENCE and check and check["grade"] == j["grade"]:
            spans[(qid, episode_id)].append((start, end, j["grade"]))
    return spans


def load_tiebreak_grades():
    """The tiebreak model's grades, in the same shape as load_judgments()."""
    lines = {}
    for j in read_jsonl(LLM_JUDGMENTS):
        if j["prompt_version"] == PROMPT_VERSION and j["model"] == TIEBREAK_MODEL:
            lines[(j["qid"], j["episode_id"], j["start"], j["end"])] = j["grade"]
    spans = defaultdict(list)
    for (qid, episode_id, start, end), grade in lines.items():
        spans[(qid, episode_id)].append((start, end, grade))
    return spans


def load_grades(unconfirmed=True):
    """Every known grade: {qid: {(episode_id, start, end): (grade, source)}}.

    source is "you", "confirmed" (an accepted model grade) or, with
    unconfirmed=True, "tiebreak" (the tiebreak model's grade) or "jev" (the
    judge model's grade where neither of those exists). Queries with
    same_need_as also get that query's grades.
    """
    grades = defaultdict(dict)
    if unconfirmed:
        for j in read_jsonl(LLM_JUDGMENTS):
            if j["model"] == JUDGE_MODEL and j["prompt_version"] == PROMPT_VERSION:
                grades[j["qid"]][(j["episode_id"], j["start"], j["end"])] = (j["grade"], "jev")
        for (qid, episode_id), items in load_tiebreak_grades().items():
            for start, end, grade in items:
                grades[qid][(episode_id, start, end)] = (grade, "tiebreak")
    for source, spans in (("confirmed", load_model_grades()), ("you", load_judgments())):
        for (qid, episode_id), items in spans.items():
            for start, end, grade in items:
                grades[qid][(episode_id, start, end)] = (grade, source)
    for q in load_queries():
        if q.get("same_need_as"):
            grades[q["id"]] = {**grades[q["same_need_as"]], **grades[q["id"]]}
    return grades


def add_judgment(qid, result, grade):
    line = {"qid": qid, "episode_id": result["episode_id"],
            "start": result["start"], "end": result["end"], "grade": grade}
    with JUDGMENTS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


def grade_of(judgments, qid, result):
    """Grade for a result, or None if it isn't judged."""
    length = max(result["end"] - result["start"], 1e-9)
    best, best_overlap = None, 0.0
    for start, end, grade in judgments.get((qid, result["episode_id"]), []):
        overlap = min(end, result["end"]) - max(start, result["start"])
        if overlap > best_overlap:
            best, best_overlap = grade, overlap
    return best if best_overlap / length >= MIN_OVERLAP else None
