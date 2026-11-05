"""Remove sound tags and boilerplate from an episode's segments.

Sound tags: `[موسيقى]`, `[ضحك]`, etc. Boilerplate: show intros and outros,
production credits, sponsor ads and promos for other shows, found as runs of
NGRAM words that appear in at least MIN_EPISODES episodes of the same channel.
Matches up to MAX_GAP words apart are merged, so short variations inside an ad
are removed too. Shorter runs catch more ad fragments but also remove real
speech (e.g. two "النبي صلى الله عليه وسلم" close together).

N-grams are kept as 64-bit hashes (`hash()` of a tuple), so the boilerplate set
of one channel must be built and used in the same process.
`>>` speaker-change marks are kept.
"""

import re

import numpy as np

from .normalize import match_key

NGRAM = 8
MIN_EPISODES = 10
MAX_GAP = 5
TAG = re.compile(r"\[[^\]]*\]")


def strip_tags(text):
    return re.sub(r"\s+", " ", TAG.sub(" ", text)).strip()


def episode_keys(segments):
    return [k for seg in segments for w in strip_tags(seg["text"]).split() if (k := match_key(w))]


def ngram_hashes(keys):
    """Unique hashes of every NGRAM-word run in one episode."""
    hashes = (hash(tuple(keys[i:i + NGRAM])) for i in range(len(keys) - NGRAM + 1))
    return np.unique(np.fromiter(hashes, dtype=np.int64))


def find_boilerplate(per_episode_hashes):
    """Hashes of the runs found in at least MIN_EPISODES episodes."""
    if len(per_episode_hashes) < MIN_EPISODES:
        return set()
    values, counts = np.unique(np.concatenate(per_episode_hashes), return_counts=True)
    return set(values[counts >= MIN_EPISODES].tolist())


def clean_segments(segments, boilerplate):
    """(cleaned segments, number of boilerplate words removed)."""
    # One entry per word: (segment index, word, match key or "" for marks like ">>").
    words = [
        (i, w, match_key(w))
        for i, seg in enumerate(segments)
        for w in strip_tags(seg["text"]).split()
    ]
    keyed = [n for n, (_, _, k) in enumerate(words) if k]
    hit = [False] * len(keyed)
    if boilerplate:
        for j in range(len(keyed) - NGRAM + 1):
            if hash(tuple(words[n][2] for n in keyed[j:j + NGRAM])) in boilerplate:
                hit[j:j + NGRAM] = [True] * NGRAM

    # Merge hits into passages, bridging gaps of up to MAX_GAP words.
    removed, j = set(), 0
    while j < len(keyed):
        if not hit[j]:
            j += 1
            continue
        end = j
        while end + 1 < len(keyed) and any(hit[end + 1:end + 2 + MAX_GAP]):
            end += 1 + hit[end + 1:end + 2 + MAX_GAP].index(True)
        removed.update(range(keyed[j], keyed[end] + 1))
        j = end + 1

    kept = [[] for _ in segments]
    for n, (i, w, _) in enumerate(words):
        if n not in removed:
            kept[i].append(w)

    cleaned = []
    for seg, ws in zip(segments, kept):
        text = re.sub(r"(>>\s*)+", ">> ", " ".join(ws)).strip()
        if not re.search(r"\w", text):  # nothing left but ">>" or punctuation
            continue
        cleaned.append({**seg, "text": text})
    return cleaned, sum(1 for n in removed if words[n][2])
