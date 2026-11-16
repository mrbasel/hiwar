import type { TranscriptSection, Utterance } from "#api/episodes";
import { Gloss } from "#components/ui/Gloss";
import { Timestamp } from "#components/ui/Timestamp";
import { arabic } from "#lib/format";

export const sectionAnchor = (idx: number) => `section-${idx}`;

const sectionTitle = (s: TranscriptSection) => s.title?.trim() || `الجزء ${arabic(s.idx)}`;

// Long monologues still break now and then, so each paragraph has a nearby timestamp.
const MAX_PARAGRAPH_SECONDS = 60;

// A new paragraph at each change of speaker, or once one has run a minute.
function paragraphs(segments: Utterance[]): { first: Utterance; text: string }[] {
  const out: { first: Utterance; text: string }[] = [];
  for (const seg of segments) {
    const last = out.at(-1);
    if (last && !seg.speaker_change && seg.start - last.first.start < MAX_PARAGRAPH_SECONDS)
      last.text += ` ${seg.text}`;
    else out.push({ first: seg, text: seg.text });
  }
  return out;
}

export function Transcript({ sections }: { sections: TranscriptSection[] }) {
  return (
    <div className="space-y-10">
      {sections.map((s) => (
        <section key={s.id} id={sectionAnchor(s.idx)} className="scroll-mt-6">
          {sections.length > 1 && (
            <h3 className="mb-3 text-lg font-semibold sm:ps-[5.75rem]" dir="auto">
              {sectionTitle(s)}
            </h3>
          )}
          <div className="space-y-4">
            {paragraphs(s.segments).map(({ first, text }) => (
              <Gloss
                key={first.idx}
                margin={<Timestamp seconds={first.start} href={first.link} className="font-normal" />}
              >
                <p className="font-read text-read text-ink" dir="auto">
                  {text}
                </p>
              </Gloss>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
