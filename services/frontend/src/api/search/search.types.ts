export type Mode = "hybrid" | "keyword";

export interface SearchParams {
  q: string;
  page: number;
  mode: Mode;
  shows: string[]; // every channel if empty
}

export const searchKeys = {
  all: ["search"] as const,
  results: (params: SearchParams) => ["search", params] as const,
};

// Fields ending in _html, and the moment and snippet text, come escaped from
// the API with <mark> highlights.

export interface Moment {
  start: number;
  link: string;
  before: string;
  html: string;
  after: string;
}

export interface Episode {
  id: string;
  title: string | null;
  title_html: string;
  show: string;
  date: string;
  url: string;
  duration: number | null;
  has_transcript: boolean;
  description_html: string;
}

export interface SearchHit {
  section: {
    id: number;
    idx: number;
    title: string | null;
    title_html: string;
    start: number;
    end: number;
    link: string;
  };
  episode: Episode;
  score: number;
  snippet: string;
  moments: Moment[];
  matched_by?: ("keyword" | "semantic")[];
}

export interface SearchResponse {
  mode: Mode;
  query: string;
  total: number;
  page: number;
  limit: number;
  took_ms: number;
  results: SearchHit[];
}

// A page of results as the page shows it: the API's sections grouped by episode.

export interface EpisodeResult {
  episode: Episode;
  hits: SearchHit[];
}

export interface ResultsPage extends Omit<SearchResponse, "results"> {
  pages: number;
  episodes: EpisodeResult[];
}
