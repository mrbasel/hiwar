"""Build one episode in memory, from its metadata and captions.

This is what the server's worker (pipeline/worker.py) does with an upload.
`make_sections` is shared with pipeline/build.py: clean the transcript, merge
its lines into utterances and cut it into sections, or fall back to sections
from the chapters alone. `episode_docs` are the documents pipeline/embed.py
embeds for an episode, and `doc_section` the section a hit on one opens,
found from the sections' times as embed.py finds it in the database.
"""

import hashlib
import json

from .clean import clean_segments
from .parse import episode_info, pick_transcript
from .sections import build_sections, title_sections
from .utterances import merge_lines

MAX_CHARS = 6000  # of a document, well inside the model's context, even for Arabic


def make_sections(ep, segments, source, boilerplate=frozenset()):
    """(sections, transcript source, words removed, reason it has no transcript).

    Without a usable transcript, the sections come from the chapters and the
    source is None.
    """
    removed, reason = 0, None
    if segments is None:
        sections, reason = [], "no Arabic transcript"
    else:
        segments, removed = clean_segments(segments, boilerplate)
        sections = build_sections(merge_lines(segments), ep["chapters"])
        if not sections:
            reason = "empty after cleaning"
    if reason:
        return title_sections(ep["chapters"], ep["duration"]), None, removed, reason
    return sections, source, removed, None


def episode_docs(ep):
    """The episode's own document and one per chapter, each with its hash."""
    title = ep["title"] or ""
    channel_id = ep["channel_id"] or ""
    # As stored in the database, so hashes match whichever side computes them.
    duration = None if ep["duration"] is None else float(ep["duration"])
    text = "\n".join([title, ep["description"] or "", *(c["title"] for c in ep["chapters"])])
    docs = [{"kind": "episode", "episode_id": ep["id"], "channel_id": channel_id,
             "start": 0, "end": duration, "text": text.strip()[:MAX_CHARS]}]
    for c in ep["chapters"]:
        docs.append({"kind": "chapter", "episode_id": ep["id"], "channel_id": channel_id,
                     "start": c["start"], "end": c["end"], "text": f"{title} | {c['title']}"})
    for d in docs:
        key = json.dumps([d["kind"], d["episode_id"], d["start"], d["end"], d["text"]], ensure_ascii=False)
        d["hash"] = hashlib.sha1(key.encode()).hexdigest()
    return docs


def doc_section(doc, sections):
    """Index in `sections` of the one a hit on `doc` opens, or None.

    A chapter's is the section that overlaps it most, an episode's its first.
    """
    if doc["kind"] != "chapter":
        return 0 if sections else None
    best, most = None, None
    for i, s in enumerate(sections):
        if s["start"] < doc["end"] and s["end"] > doc["start"]:
            overlap = min(s["end"], doc["end"]) - max(s["start"], doc["start"])
            if most is None or overlap > most:
                best, most = i, overlap
    return best


def build_episode(info, folder, tracks):
    """Episode, sections and documents from an info.json's contents, the folder
    yt-dlp put it in, and its caption tracks ({'ar': json3, 'ar-orig': json3},
    either or both missing).

    Returns {episode, sections, docs, reason}, each doc with the index of its
    section (or None) as `section`, and reason why there's no transcript.
    """
    ep = episode_info(info, folder)
    segments, source = pick_transcript(tracks.get)
    sections, source, _, reason = make_sections(ep, segments, source)
    ep["transcript_source"] = source
    docs = episode_docs(ep)
    for d in docs:
        d["section"] = doc_section(d, sections)
    return {"episode": ep, "sections": sections, "docs": docs, "reason": reason}
