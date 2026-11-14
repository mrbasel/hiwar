// Every word is quoted, so user input can't break the FTS5 syntax.

import { words } from "../normalize.js";

export interface ParsedQuery {
  match: string;
  terms: string[];
}

export function parseQuery(input: string): ParsedQuery | null {
  const terms = [...new Set(words(input))];
  if (!terms.length) return null;
  return { match: terms.map((t) => `"${t}"`).join(" AND "), terms };
}
