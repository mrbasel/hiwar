export const episodeKeys = {
  all: ["episodes"] as const,
  detail: (id: string) => ["episodes", id] as const,
  recommendations: (id: string) => ["episodes", id, "recommendations"] as const,
};

// Plain text throughout: unlike search results, nothing here is highlighted.

export interface Utterance {
  idx: number;
  start: number;
  link: string;
  text: string;
  speaker_change: boolean;
}

export interface TranscriptSection {
  id: number;
  idx: number;
  title: string | null;
  start: number;
  end: number;
  link: string;
  segments: Utterance[];
}

export interface EpisodeDetail {
  id: string;
  title: string | null;
  show: string;
  channel: { id: string; name: string | null; url: string | null } | null;
  date: string;
  duration: number | null;
  url: string;
  description: string;
  has_transcript: boolean;
}

export interface EpisodeResponse {
  episode: EpisodeDetail;
  sections: TranscriptSection[];
}

export interface RecommendedEpisode {
  id: string;
  title: string | null;
  show: string;
  date: string;
  duration: number | null;
  url: string;
}
