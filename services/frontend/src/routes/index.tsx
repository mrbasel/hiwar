import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { z } from "zod";
import type { SearchParams } from "#api/search";
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

const EXAMPLES = ["الحرية المالية", "سوق العقار", "تربية الأطفال"];

function SearchPage() {
  const params = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      <SearchBar params={params} onSearch={(p) => navigate({ search: p })} />
      <main className="mx-auto max-w-184 px-4 pt-4 pb-16">
        {params.q ? <SearchResults params={params} /> : <Intro />}
      </main>
    </>
  );
}

function Intro() {
  return (
    <section>
      <h1 className="mt-8 mb-2 text-[1.75rem] leading-tight font-semibold">
        ابحث في أكثر من ١٠ آلاف ساعة من حلقات البودكاست
      </h1>
      <div className="max-w-xl space-y-4 text-muted">
        <p>تظهر النتائج مع التوقيت داخل الحلقة، اضغط عليه لتفتح المقطع على يوتيوب.</p>
        <p>
          جرّب:
          {EXAMPLES.map((q) => (
            <Link key={q} to="/" search={{ q }} className="ms-2.5 text-signal underline">
              {q}
            </Link>
          ))}
        </p>
        <p>
          أو تصفّح{" "}
          <Link to="/map" className="text-signal underline">
            خريطة الحلقات
          </Link>{" "}
          لترى كيف تتجمّع المواضيع.
        </p>
      </div>
    </section>
  );
}
