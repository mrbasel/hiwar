"""Merge caption lines into utterances (the `segments` stored in the DB).

YouTube caption lines are cut wherever the screen line fills up (median 7
words, under 3 s), so phrases are often split across lines. Consecutive lines
are joined until one of:
- a speaker change (the next line starts with `>>`)
- a pause of at least MIN_PAUSE seconds before the next line
- sentence-ending punctuation, once the utterance has MIN_SENTENCE_WORDS words
  (only human captions are punctuated)
- the utterance would grow past MAX_SECONDS or MAX_WORDS

A `>>` in the middle of a line stays inside the utterance; only line starts
carry timestamps.
"""

import re

MIN_PAUSE = 1.0
MIN_SENTENCE_WORDS = 8
MAX_SECONDS = 15
MAX_WORDS = 40
SENTENCE_END = re.compile(r"[.!?؟…]\W*$")


def word_count(text):
    return sum(1 for w in text.split() if w != ">>")


def merge_lines(lines):
    utterances = []
    current, words = None, 0
    for line in lines:
        n = word_count(line["text"])
        if current is not None:
            pause = line["start"] - current["end"]
            ended = SENTENCE_END.search(current["text"]) and words >= MIN_SENTENCE_WORDS
            too_long = line["end"] - current["start"] > MAX_SECONDS or words + n > MAX_WORDS
            if line["text"].startswith(">>") or pause >= MIN_PAUSE or ended or too_long:
                utterances.append(current)
                current = None
        if current is None:
            current, words = dict(line), n
        else:
            current["text"] += " " + line["text"]
            current["end"] = max(current["end"], line["end"])
            words += n
    if current is not None:
        utterances.append(current)
    return utterances
