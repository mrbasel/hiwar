"""Grade pooled results with a model, after checking it agrees with you.

    uv run python -m eval.llm_judge calibrate [--models M ...]
    uv run python -m eval.llm_judge judge [--models M ...] [--depth N]

calibrate  grades the results you already graded and reports how often each
           model agrees with you, and where it doesn't.
judge      grades the rest of the pool (top N of every run) that you haven't,
           with the judge and check models; eval.data decides which of
           those grades are accepted.

Sections of episodes without a transcript have no text, so the models are
shown the episode's title and description and the section title instead,
with their own instructions; those grades are marked "input": "metadata".

Grades go to eval/llm_judgments.jsonl with the model and PROMPT_VERSION, and
are reused on later runs. Bump PROMPT_VERSION (in eval.data) after changing
the prompt so old grades aren't mixed in. Your own grades always take
precedence.

Decision models (typesafe/jev-*) go through OpenRouter's Decisions API and
return a probability per grade; claude-code/<model> runs `claude -p` with that
model (and claude-code/<model>:<effort> with that effort level) on your
Claude subscription; anything else is called as a chat model
and asked for a short reason and a grade. The key comes from
OPENROUTER_API_KEY, or opencode's saved OpenRouter key.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .data import (
    CHECK_MODEL, JUDGE_MODEL, LLM_JUDGMENTS, PROMPT_VERSION,
    grade_of, load_judgments, load_model_grades, load_queries, load_runs, model_lines,
)
from .judge import pool

OPENCODE_AUTH = Path.home() / ".local/share/opencode/auth.json"
API = "https://openrouter.ai/api"

INSTRUCTIONS = """How well does section_text serve someone who searched for query, \
whose intent is described by need? section_text is a ~7 minute section of an \
Arabic podcast transcript (auto-captions, often dialect, no punctuation, with \
transcription errors). Judge the section on its own, not the whole episode. \
Judge against need, not whether the query words appear. Judge the text, not \
the section title, which is often inherited from a longer chapter. The topics \
listed in need are examples, not a checklist: a section that discusses the \
subject directly counts even if it covers only some of them. The speaker's \
opinion doesn't matter; a skeptical or critical discussion of the subject is \
still about it. Grading rules written in need take precedence."""

METADATA_INSTRUCTIONS = """How well does the section of a podcast episode \
described here serve someone who searched for query, whose intent is \
described by need? The episode has no transcript, so all there is to go on \
is episode_title, episode_description and section_title, which is a chapter \
title, or the episode title if the episode has no chapters. Grade the section \
as you would its transcript when these make clear what it covers, and lower \
when they only hint at it. Judge against need, not whether the query words \
appear. The topics listed in need are examples, not a checklist. The \
speaker's opinion doesn't matter. Grading rules written in need take \
precedence."""
MAX_DESCRIPTION_CHARS = 3000

LEVELS = [
    "Not relevant: the section does not serve the need, even if the query words appear in it.",
    "Partially relevant: the section touches the need only briefly or from the side, "
    "such as a passing mention, a related topic, or a different angle than asked.",
    "Highly relevant: a good part of the section, a minute or more, directly addresses the need.",
]

def chat_prompt(instructions):
    return f"""{instructions}

Grades:
0 = {LEVELS[0]}
1 = {LEVELS[1]}
2 = {LEVELS[2]}

Reply with only a JSON object: {{"reason": "<one short sentence>", "grade": <0, 1 or 2>}}"""


def instructions_for(state):
    return INSTRUCTIONS if "section_text" in state else METADATA_INSTRUCTIONS


def api_key():
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    return json.loads(OPENCODE_AUTH.read_text())["openrouter"]["key"]


def post(path, body, key, tries=4):
    req = urllib.request.Request(
        API + path, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": "rawi-eval/0.1"},  # the default Python agent is blocked
    )
    for attempt in range(tries):
        try:
            return json.load(urllib.request.urlopen(req, timeout=120))
        except urllib.error.HTTPError as err:
            if err.code not in (408, 429, 500, 502, 503, 504) or attempt == tries - 1:
                raise RuntimeError(f"{err.code}: {err.read()[:300]!r}") from err
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def ask_decision(model, state, key):
    r = post("/alpha/decisions", {"model": model, "state": state, "questions": {
        "relevance": {"type": "score", "instructions": instructions_for(state), "criteria": LEVELS}}}, key)
    answer = r["answers"]["relevance"]
    probs = {int(k): v for k, v in answer["probabilities"].items()}
    return {"grade": max(probs, key=probs.get), "probs": probs,
            "confidence": answer["confidence"], "served_by": r["model"]}


def ask_chat(model, state, key):
    r = post("/v1/chat/completions", {
        "model": model, "temperature": 0, "max_tokens": 4000,
        "messages": [{"role": "system", "content": chat_prompt(instructions_for(state))},
                     {"role": "user", "content": json.dumps(state, ensure_ascii=False)}],
    }, key)
    out = parse_reply(r["choices"][0]["message"]["content"] or "")
    return {"grade": out["grade"], "reason": out.get("reason", ""), "served_by": r.get("model", model)}


def parse_reply(text):
    match = re.search(r"\{.*\}", text, re.S)
    out = json.loads(match.group()) if match else {}
    if out.get("grade") not in (0, 1, 2):
        raise RuntimeError(f"unparseable reply: {text[:200]!r}")
    return out


class UsageLimit(RuntimeError):
    pass


# claude -p calls start at most once every PACE seconds, and stop for good after a
# usage limit, so a long run doesn't burn the subscription's 5-hour window.
PACE = 3.0
pace_lock = threading.Lock()
next_call = 0.0
limit_hit = threading.Event()


def wait_turn():
    global next_call
    with pace_lock:
        now = time.monotonic()
        delay = max(0.0, next_call - now)
        next_call = max(now, next_call) + PACE
    time.sleep(delay)


def ask_claude_code(model, state, key, tries=3):
    claude = shutil.which("claude") or str(Path.home() / ".local/bin/claude")
    name, _, effort = model.removeprefix("claude-code/").partition(":")
    cmd = [claude, "-p", "--model", name, *(["--effort", effort] if effort else []), "--system-prompt", chat_prompt(instructions_for(state)),
           "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json"]
    for attempt in range(tries):
        if limit_hit.is_set():
            raise UsageLimit("stopped after a usage limit")
        wait_turn()
        proc = subprocess.run(cmd, input=json.dumps(state, ensure_ascii=False), capture_output=True,
                              text=True, timeout=600, cwd="/tmp")
        try:
            r = json.loads(proc.stdout)
            if r.get("is_error"):
                if re.search(r"hit your .*limit", r.get("result") or ""):
                    limit_hit.set()
                    raise UsageLimit(r["result"])
                raise RuntimeError(r.get("result"))
            out = parse_reply(r["result"])
            return {"grade": out["grade"], "reason": out.get("reason", ""), "served_by": next(iter(r["modelUsage"]))}
        except UsageLimit:
            raise
        except Exception as err:
            if attempt == tries - 1:
                raise RuntimeError(f"{err}; stderr: {proc.stderr[:300]!r}") from err
        time.sleep(5 * 2 ** attempt)


def ask(model, state, key):
    if model.startswith("claude-code/"):
        return ask_claude_code(model, state, key)
    return (ask_decision if model.startswith("typesafe/") else ask_chat)(model, state, key)


def section_for(conn, episode_id, start, end):
    """The section covering most of a judged span: episode title, description
    and transcript source, section title and text."""
    return conn.execute(
        """SELECT e.title, e.description, e.transcript_source, s.title, s.text
           FROM sections s JOIN episodes e ON e.id = s.episode_id
           WHERE s.episode_id = ? AND s.start_time < ? AND s.end_time > ?
           ORDER BY min(s.end_time, ?) - max(s.start_time, ?) DESC LIMIT 1""",
        (episode_id, end, start, end, start),
    ).fetchone()


def cached(model):
    """{(qid, episode_id, start, end): line} for this model and prompt version."""
    out = {}
    for j in model_lines():
        if j["model"] == model:
            if "probs" in j:  # JSON turns the int grade keys into strings
                j["probs"] = {int(k): v for k, v in j["probs"].items()}
            out[(j["qid"], j["episode_id"], j["start"], j["end"])] = j
    return out


def grade_all(conn, model, todo, queries, key, workers=4):
    """Grade (qid, episode_id, start, end) spans not graded yet; return all grades."""
    def state(span):
        qid, episode_id, start, end = span
        episode_title, description, transcript, section_title, text = section_for(conn, episode_id, start, end)
        q = queries[qid]
        if transcript is None:
            return {"query": q["q"], "need": q["need"], "episode_title": episode_title,
                    "episode_description": (description or "")[:MAX_DESCRIPTION_CHARS],
                    "section_title": section_title}
        return {"query": q["q"], "need": q["need"], "episode_title": episode_title,
                "section_title": section_title, "section_text": text}

    have = cached(model)
    states = {span: state(span) for span in todo}  # read the DB here, not in the threads
    # a grade made before sections without a transcript were shown their metadata doesn't count
    missing = [t for t in todo if t not in have
               or ("section_text" not in states[t] and have[t].get("input") != "metadata")]

    def work(job):
        span, st = job
        try:
            return span, ask(model, st, key)
        except Exception as err:
            return span, err

    jobs = [(span, states[span]) for span in missing]
    failed = 0
    with ThreadPoolExecutor(workers) as ex, LLM_JUDGMENTS.open("a", encoding="utf-8") as f:
        for n, (span, result) in enumerate(ex.map(work, jobs), 1):
            if isinstance(result, Exception):
                failed += 1
                if not isinstance(result, UsageLimit) or str(result) != "stopped after a usage limit":
                    print(f"  failed {span}: {result}")
                continue
            line = {"qid": span[0], "episode_id": span[1], "start": span[2], "end": span[3],
                    "model": model, "prompt_version": PROMPT_VERSION,
                    **({} if "section_text" in states[span] else {"input": "metadata"}), **result}
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
            f.flush()
            have[span] = line
            if n % 25 == 0:
                print(f"  {model}: {n}/{len(missing)}")
    print(f"{model}: {len(todo) - len(missing)} cached, {len(missing) - failed} new, {failed} failed")
    if limit_hit.is_set():
        raise SystemExit("hit a usage limit; rerun later to grade the rest (graded results are kept)")
    return have


def report(model, pairs, queries, sections):
    """pairs: [(span, human grade, model line)]."""
    n = len(pairs)
    agree = sum(h == m["grade"] for _, h, m in pairs)
    far = sum(abs(h - m["grade"]) == 2 for _, h, m in pairs)
    bias = sum(m["grade"] - h for _, h, m in pairs) / n
    print(f"\n== {model}  ({n} results)")
    print(f"exact agreement   {agree}/{n} = {agree / n:.0%}")
    print(f"0 vs 2 mix-ups    {far}")
    print(f"mean (model - you) {bias:+.2f}   (+ = more lenient than you)")
    print(f"weighted kappa    {weighted_kappa([(h, m['grade']) for _, h, m in pairs]):.2f}")
    confusion = Counter((h, m["grade"]) for _, h, m in pairs)
    print("           model 0  model 1  model 2")
    for h in range(3):
        print(f"  you {h}  " + "".join(f"{confusion[(h, g)]:>9}" for g in range(3)))
    if all("confidence" in m for _, _, m in pairs):
        for t in (0.6, 0.8):
            sure = [(h, m) for _, h, m in pairs if m["confidence"] >= t]
            if sure:
                ok = sum(h == m["grade"] for h, m in sure)
                print(f"confidence >= {t}: {len(sure)}/{n} results, agreement {ok / len(sure):.0%}")
    print("disagreements:")
    for span, h, m in sorted(pairs, key=lambda p: p[0]):
        if h != m["grade"]:
            extra = m.get("reason") or f"p={m['probs']} conf={m['confidence']}"
            print(f"  {span[0]} {queries[span[0]]['q']} | {sections[span]} | you {h}, model {m['grade']} | {extra}")


def weighted_kappa(pairs, k=3):
    """Agreement beyond chance, with near misses (1 vs 2) penalized less than far ones (0 vs 2)."""
    n = len(pairs)
    observed = sum((a - b) ** 2 for a, b in pairs) / n
    ca, cb = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    expected = sum(ca[i] * cb[j] * (i - j) ** 2 for i in range(k) for j in range(k)) / n ** 2
    return 1 - observed / expected if expected else 1.0


def human_spans():
    return {(qid, ep, s, e): g for (qid, ep), spans in load_judgments().items() for s, e, g in spans}


def calibrate(conn, models, key, workers):
    queries = {q["id"]: q for q in load_queries()}
    human = human_spans()
    sections = {span: section_for(conn, span[1], span[2], span[3])[1] for span in human}
    for model in models:
        grades = grade_all(conn, model, list(human), queries, key, workers)
        report(model, [(s, h, grades[s]) for s, h in human.items() if s in grades], queries, sections)


def judge(conn, models, depth, key, workers, unresolved=False):
    """unresolved=True grades only what neither you nor the accepted model
    grades cover, for the tiebreak model."""
    queries = {q["id"]: q for q in load_queries()}
    runs, judgments, auto = load_runs(), load_judgments(), load_model_grades()
    todo = [
        (qid, r["episode_id"], r["start"], r["end"])
        for qid in queries
        for r in pool(runs, qid, depth)
        if grade_of(judgments, qid, r) is None and not (unresolved and grade_of(auto, qid, r) is not None)
    ]
    print(f"{len(todo)} pooled results without your grade" + (" or an accepted model grade" if unresolved else ""))
    for model in models:
        grade_all(conn, model, todo, queries, key, workers)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["calibrate", "judge", "tiebreak"])
    parser.add_argument("--models", nargs="+", default=[JUDGE_MODEL, CHECK_MODEL])
    parser.add_argument("--depth", type=int, default=20, help="top N of each run to judge")
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--workers", type=int, default=4, help="parallel model calls")
    parser.add_argument("--pace", type=float, default=PACE, help="min seconds between claude-code calls")
    args = parser.parse_args()
    globals()["PACE"] = args.pace

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    key = api_key()
    if args.mode == "calibrate":
        calibrate(conn, args.models, key, args.workers)
    else:
        judge(conn, args.models, args.depth, key, args.workers, unresolved=args.mode == "tiebreak")


if __name__ == "__main__":
    main()
