import { Play } from "lucide-react";
import type { EpisodeDetail } from "#api/episodes";
import { EpisodeMeta } from "#components/episode/EpisodeMeta";
import { buttonClass } from "#components/ui/Button";
import { Thumbnail } from "#components/ui/Thumbnail";
import { videoId } from "#lib/youtube";

export function EpisodeHeader({ episode }: { episode: EpisodeDetail }) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
      <div className="min-w-0 flex-1">
        <EpisodeMeta
          show={episode.show}
          date={episode.date}
          duration={episode.duration}
          className="text-sm text-muted"
        />
        <h1 className="mt-1 text-xl font-semibold sm:text-2xl" dir="auto">
          {episode.title ?? "حلقة بلا عنوان"}
        </h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={episode.url} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            <Play />
            شاهد على يوتيوب
          </a>
          {/* The channel is worth naming when it's a network, not the show itself. */}
          {episode.channel?.url && episode.channel.name && episode.channel.name !== episode.show.trim() && (
            <a
              href={episode.channel.url}
              target="_blank"
              rel="noopener"
              className={buttonClass("quiet", "sm")}
              dir="auto"
            >
              {episode.channel.name}
            </a>
          )}
        </div>
      </div>
      {/* Out of the tab order: the button already links to the video. */}
      <a
        href={episode.url}
        target="_blank"
        rel="noopener"
        tabIndex={-1}
        className="block shrink-0 overflow-hidden rounded-control sm:w-64"
      >
        <Thumbnail
          videoId={videoId(episode.url, episode.id)}
          alt={episode.title ?? "الحلقة على يوتيوب"}
          quality="maxres"
          className="transition-opacity duration-150 hover:opacity-85"
        />
      </a>
    </header>
  );
}
