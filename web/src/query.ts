// Turns what the user typed into a safe FTS5 MATCH expression: sections that
// contain all the words. Every word is quoted after normalizing, so user input
// can't break the FTS5 syntax.

import { words } from "./normalize.js";

export interface ParsedQuery {
  match: string;
  terms: string[]; // for finding moments and highlighting
}

export function parseQuery(input: string): ParsedQuery | null {
  const terms = [...new Set(words(input))];
  if (!terms.length) return null;
  return { match: terms.map((t) => `"${t}"`).join(" AND "), terms };
}
