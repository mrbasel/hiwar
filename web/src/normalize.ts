// Port of pipeline/normalize.py. Queries must be normalized exactly like the
// index was, or they won't match.

const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g; // harakat, superscript alef, tatweel
const FROM = "\u0623\u0625\u0622\u0671\u0629\u0649" + "٠١٢٣٤٥٦٧٨٩" + "۰۱۲۳۴۵۶۷۸۹";
const TO = "\u0627\u0627\u0627\u0627\u0647\u064A" + "0123456789" + "0123456789";
const LETTERS = new Map([...FROM].map((ch, i) => [ch, TO[i]]));

export function normalize(text: string): string {
  let out = "";
  for (const ch of text.replace(DIACRITICS, "")) out += LETTERS.get(ch) ?? ch;
  return out.toLowerCase();
}

// Normalized words, split roughly like FTS5's unicode61 tokenizer.
export function words(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}
