import { episodeById, sectionsOfEpisode, segmentsOfEpisode, type UtteranceRow } from "../db/queries.js";
import { link } from "../links.js";

export function presentEpisode(id: string) {
  const e = episodeById(id);
  if (!e) return undefined;

  const bySection = new Map<number, UtteranceRow[]>();
  for (const seg of segmentsOfEpisode(id)) {
    if (!bySection.has(seg.section_id)) bySection.set(seg.section_id, []);
    bySection.get(seg.section_id)!.push(seg);
  }

  return {
    episode: {
      id: e.id,
      title: e.title,
      show: e.show,
      channel: e.channel_id ? { id: e.channel_id, name: e.channel_name, url: e.channel_url } : null,
      date: e.date,
      duration: e.duration,
      url: e.url,
      description: (e.description ?? "").replace(/\s*\n\s*\n\s*/g, "\n\n").trim(),
      has_transcript: e.transcript_source !== null,
    },
    sections: sectionsOfEpisode(id).map((s) => ({
      id: s.id,
      idx: s.idx,
      title: s.title,
      start: s.start_time,
      end: s.end_time,
      link: link(e.url, s.start_time),
      segments: (bySection.get(s.id) ?? []).map((seg) => ({
        idx: seg.idx,
        start: seg.start_time,
        link: link(e.url, seg.start_time),
        text: seg.text,
        speaker_change: seg.speaker_change === 1,
      })),
    })),
  };
}
