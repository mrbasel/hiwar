"""Arabic spelling normalization, shared by indexing and queries.

Removes diacritics and tatweel, unifies alef forms (أ/إ/آ/ٱ → ا), ة → ه and
ى → ي, and turns Arabic-Indic digits into ASCII. Apply the same function to
search queries, or they won't match the index.
"""

import re

DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u0640]")  # harakat, superscript alef, tatweel
LETTERS = str.maketrans(
    "\u0623\u0625\u0622\u0671\u0629\u0649" "٠١٢٣٤٥٦٧٨٩" "۰۱۲۳۴۵۶۷۸۹",
    "\u0627\u0627\u0627\u0627\u0647\u064A" "0123456789" "0123456789",
)
NON_WORD = re.compile(r"[^\u0621-\u064A0-9a-z]")


def normalize(text):
    return DIACRITICS.sub("", text).translate(LETTERS).lower()


def match_key(word):
    """Loose form of one word, so human and auto captions of the same ad match."""
    return NON_WORD.sub("", normalize(word))
