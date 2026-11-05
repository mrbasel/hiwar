"""Split a cleaned episode into sections (the text that is searched and read).

Sections follow the YouTube chapters. Chapters shorter than MIN_SECTION are
merged into the next one (or the previous one, at the end of the episode);
chapters longer than MAX_SECTION are split into equal parts of at most
TARGET_SECTION. Episodes without chapters are cut into TARGET_SECTION blocks.
Cuts go at a `>>` speaker change or the longest pause near the target time;
chapter starts, which are set by hand and often fall mid-sentence, are moved
the same way within CHAPTER_SNAP seconds.
"""

import math
import re

MIN_SECTION = 2 * 60
MAX_SECTION = 15 * 60
TARGET_SECTION = 10 * 60
CUT_WINDOW = 60  # how far from the target time a cut may move, in seconds
CHAPTER_SNAP = 15  # same, for chapter starts
NO_CHAPTER_TITLE = "الحلقة"


def assign_to_chapters(segments, chapters):
    """Split segments at the chapter starts, each moved to a nearby natural break."""
    bounds = [0]
    for chapter in chapters[1:]:
        bounds.append(max(bounds[-1], best_cut(segments, chapter["start"], CHAPTER_SNAP)))
    bounds.append(len(segments))
    spans = [
        {"title": c["title"], "segments": segments[a:b]}
        for c, a, b in zip(chapters, bounds, bounds[1:])
    ]
    return [s for s in spans if s["segments"]]


def duration(span):
    return span["segments"][-1]["end"] - span["segments"][0]["start"]


def merge_short(spans):
    merged, pending = [], None
    for span in spans:
        if pending:
            span = {
                "title": f"{pending['title']} + {span['title']}",
                "segments": pending["segments"] + span["segments"],
            }
            pending = None
        if duration(span) < MIN_SECTION:
            pending = span
        else:
            merged.append(span)
    if pending:
        if merged:
            last = merged[-1]
            last["title"] = f"{last['title']} + {pending['title']}"
            last["segments"] += pending["segments"]
        else:
            merged.append(pending)
    return merged


def best_cut(segments, target, window=CUT_WINDOW):
    """Index i such that the cut goes before segments[i], near `target` seconds."""
    if len(segments) < 2:
        return len(segments)
    candidates = [
        i for i in range(1, len(segments))
        if abs(segments[i]["start"] - target) <= window
    ]
    if not candidates:
        # No segment starts near the target: cut at the first one after it.
        return next((i for i in range(len(segments)) if segments[i]["start"] >= target), len(segments))

    def score(i):
        speaker_change = segments[i]["text"].startswith(">>")
        pause = segments[i]["start"] - segments[i - 1]["end"]
        return (speaker_change, pause)

    return max(candidates, key=score)


def split_long(span, limit):
    segments = span["segments"]
    if duration(span) <= limit or len(segments) < 2:
        return [span]
    parts = math.ceil(duration(span) / TARGET_SECTION)
    start = segments[0]["start"]
    cuts = []
    for k in range(1, parts):
        i = best_cut(segments, start + k * duration(span) / parts)
        if (cuts[-1] if cuts else 0) < i < len(segments):
            cuts.append(i)
    bounds = [0] + cuts + [len(segments)]
    pieces = [segments[a:b] for a, b in zip(bounds, bounds[1:])]
    return [
        {"title": f"{span['title']} ({n}/{len(pieces)})", "segments": piece}
        for n, piece in enumerate(pieces, 1)
    ]


def section_text(segments):
    text = " ".join(seg["text"] for seg in segments)
    return re.sub(r"\s*>>\s*", "\n", text).strip()  # one line per speaker turn


def build_sections(segments, chapters):
    """List of {title, start, end, text, segments}, covering every segment in order."""
    if not segments:
        return []
    if chapters:
        spans = merge_short(assign_to_chapters(segments, chapters))
        limit = MAX_SECTION
    else:
        spans = [{"title": NO_CHAPTER_TITLE, "segments": segments}]
        limit = TARGET_SECTION
    spans = [piece for span in spans for piece in split_long(span, limit)]
    return [
        {
            "title": span["title"],
            "start": span["segments"][0]["start"],
            "end": span["segments"][-1]["end"],
            "text": section_text(span["segments"]),
            "segments": span["segments"],
        }
        for span in spans
    ]
