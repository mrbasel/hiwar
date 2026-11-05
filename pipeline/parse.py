"""Read one downloaded episode: metadata from `.info.json`, timed segments from `.json3`.

Human captions (`.ar.json3`) are preferred over auto captions (`.ar-orig.json3`).
Tracks that aren't mostly Arabic are ignored (some tracks labeled `ar` are
actually English). Speaker changes become a `>>` mark in the text: human
captions already have it, auto captions flag the word with `isSpeakerChange`.
"""

import json
import re
from pathlib import Path

TRANSCRIPT_SOURCES = [("ar", "human"), ("ar-orig", "auto")]
MIN_ARABIC_RATIO = 0.8
LAST_WORD_S = 0.3  # rough length of a line's last word, when only word starts are known


def base_of(info_path):
    return info_path.with_name(info_path.name.removesuffix(".info.json"))


def read_info(info_path):
    """Episode metadata, or None if the episode has no transcript file at all."""
    info_path = Path(info_path)
    base = base_of(info_path)
    if not any(base.with_name(f"{base.name}.{s}.json3").exists() for s, _ in TRANSCRIPT_SOURCES):
        return None
    info = json.loads(info_path.read_text(encoding="utf-8"))
    date = info.get("upload_date") or ""
    folder = info_path.parent.name
    channel = info.get("channel") or info.get("uploader") or info.get("uploader_id")
    return {
        "id": info["id"],
        "channel_id": info.get("channel_id"),
        "channel": channel,
        "handle": info.get("uploader_id"),
        "channel_url": info.get("channel_url"),
        # Playlist downloads are named after the show; channel downloads after the channel.
        "show": channel if folder == "NA" else folder,
        "title": info.get("title"),
        "date": f"{date[:4]}-{date[4:6]}-{date[6:]}" if len(date) == 8 else None,
        "url": info.get("webpage_url"),
        "duration": info.get("duration"),
        "description": info.get("description"),
        "chapters": [
            {"title": c["title"], "start": c["start_time"], "end": c["end_time"]}
            for c in info.get("chapters") or []
        ],
        "path": str(base),
    }


def is_arabic(segments):
    text = "".join(seg["text"] for seg in segments)
    arabic = len(re.findall(r"[\u0600-\u06FF]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return arabic / max(arabic + latin, 1) >= MIN_ARABIC_RATIO


def find_transcript(base):
    """(segments, source) from the best Arabic track, or (None, None)."""
    base = Path(base)
    for suffix, source in TRANSCRIPT_SOURCES:
        path = base.with_name(f"{base.name}.{suffix}.json3")
        if not path.exists():
            continue
        segments = read_segments(path)
        if segments and is_arabic(segments):
            return segments, source
    return None, None


def read_segments(path):
    events = json.loads(Path(path).read_text(encoding="utf-8"))["events"]
    segments = []
    for event in events:
        parts = event.get("segs") or []
        text = "".join(
            (" >> " if seg.get("isSpeakerChange") else "") + seg.get("utf8", "") for seg in parts
        )
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        start = event["tStartMs"] / 1000
        end = (event["tStartMs"] + event.get("dDurationMs", 0)) / 1000
        # Auto captions give each word's start; end the line just after its
        # last word, so pauses before the next line show up as gaps.
        offsets = [seg["tOffsetMs"] for seg in parts if "tOffsetMs" in seg]
        if offsets:
            end = min(end, start + max(offsets) / 1000 + LAST_WORD_S)
        segments.append({"start": start, "end": end, "text": text})

    # Auto-caption events stay on screen past the next one; clip the overlap.
    for seg, nxt in zip(segments, segments[1:]):
        if nxt["start"] > seg["start"]:
            seg["end"] = min(seg["end"], nxt["start"])
    for seg in segments:
        seg["start"] = round(seg["start"], 2)
        seg["end"] = round(seg["end"], 2)
    return segments
