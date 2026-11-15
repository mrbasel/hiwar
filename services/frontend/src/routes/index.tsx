import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import type { SearchParams } from "#api/search";
import { Home } from "#components/Home";
import { SearchBar } from "#components/SearchBar";
import { SearchResults } from "#components/SearchResults";

const defaults: SearchParams = { q: "", page: 1, mode: "hybrid", shows: [] };

// Every param is optional in links; anything malformed falls back to its default.
const searchSchema = z.object({
  q: z.string().default(defaults.q).catch(defaults.q),
  page: z.coerce.number().int().min(1).default(defaults.page).catch(defaults.page),
  mode: z.enum(["hybrid", "keyword"]).default(defaults.mode).catch(defaults.mode),
  shows: z
    .preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v), z.array(z.string()))
    .default(defaults.shows)
    .catch(defaults.shows),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(defaults)] },
  head: ({ match }) => ({
    meta: [{ title: match.search.q ? `${match.search.q} | بحث في البودكاست` : "بحث في البودكاست" }],
  }),
  component: SearchPage,
});

function SearchPage() {
  const params = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearch = (p: SearchParams) => navigate({ search: p });

  if (!params.q) return <Home params={params} onSearch={onSearch} />;
  return (
    <>
      <SearchBar params={params} onSearch={onSearch} />
      <main className="px-4 pb-20 sm:px-8 sm:ps-36">
        <div className="max-w-3xl">
          <SearchResults params={params} />
        </div>
      </main>
    </>
  );
}
