import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, stripSearchParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";
import { ApiError } from "#api/client";
import { episodeQuery } from "#api/episodes";
import type { SearchParams } from "#api/search";
import { EpisodeDescription } from "#components/episode/EpisodeDescription";
import { EpisodeHeader } from "#components/episode/EpisodeHeader";
import { RecommendedEpisodes } from "#components/episode/RecommendedEpisodes";
import { Transcript } from "#components/episode/Transcript";
import { SearchBar } from "#components/SearchBar";
import { Tab, TabList, TabPanel, Tabs } from "#components/ui/Tabs";

const NEW_SEARCH: SearchParams = { q: "", page: 1, mode: "hybrid", shows: [], date: "all" };

const TABS = ["description", "transcript"] as const;
type EpisodeTab = (typeof TABS)[number];

// The open tab is in the URL, so a link can open the transcript at a section.
const defaults: { tab: EpisodeTab } = { tab: "description" };
const searchSchema = z.object({
  tab: z.enum(TABS).default(defaults.tab).catch(defaults.tab),
});

export const Route = createFileRoute("/episode/$id")({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(defaults)] },
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(episodeQuery(params.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw notFound();
      throw err;
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.episode.title ?? "حلقة"} | ${loaderData.episode.show.trim()}`
          : "بحث في البودكاست",
      },
    ],
  }),
  pendingComponent: () => (
    <Page>
      <p className="py-3 text-sm text-faint">جارٍ تحميل الحلقة…</p>
    </Page>
  ),
  errorComponent: ({ error }) => (
    <Page>
      <p className="py-3 text-sm text-error">
        {error instanceof Error ? error.message : "تعذّر تحميل الحلقة."}
      </p>
    </Page>
  ),
  component: EpisodePage,
});

function Page({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const navigate = Route.useNavigate();
  return (
    <>
      <SearchBar params={NEW_SEARCH} onSearch={(search) => navigate({ to: "/", search })} />
      <main className="px-4 pt-8 pb-20 sm:px-8 sm:ps-36">
        <div className="grid max-w-7xl gap-x-12 gap-y-14 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <article className="max-w-3xl min-w-0">{children}</article>
          {aside && <aside className="lg:pt-1">{aside}</aside>}
        </div>
      </main>
    </>
  );
}

function EpisodePage() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useSuspenseQuery(episodeQuery(id));
  const { episode, sections } = data;

  return (
    <Page aside={<RecommendedEpisodes episodeId={id} />}>
      <EpisodeHeader episode={episode} />
      <Tabs
        value={tab}
        onValueChange={(next: EpisodeTab) =>
          navigate({ search: { tab: next }, replace: true, resetScroll: false })
        }
        className="mt-8"
      >
        <TabList>
          <Tab value="description">الوصف</Tab>
          <Tab value="transcript">النص</Tab>
        </TabList>
        <TabPanel value="description">
          <EpisodeDescription text={episode.description} videoUrl={episode.url} />
        </TabPanel>
        <TabPanel value="transcript">
          {episode.has_transcript ? (
            <Transcript sections={sections} />
          ) : (
            <p className="rounded-control bg-sunken px-4 py-3 text-sm text-muted">
              لا يتوفر نص لهذه الحلقة بعد.
            </p>
          )}
        </TabPanel>
      </Tabs>
    </Page>
  );
}
