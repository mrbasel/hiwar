import { Link } from "@tanstack/react-router";
import { Search, SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import type { Mode, SearchParams } from "#api/search";
import { DateFilter } from "#components/DateFilter";
import { DevModeToggle } from "#components/DevModeToggle";
import { ShowPicker } from "#components/ShowPicker";
import { ThemeToggle } from "#components/ThemeToggle";
import { IconButton } from "#components/ui/Button";
import { Segment, Segmented } from "#components/ui/Radio";
import { TextField } from "#components/ui/TextField";
import { cn } from "#lib/format";

// Changing an option searches for whatever is in the box, even if it hasn't been submitted.
export function SearchBar({
  params,
  onSearch,
}: {
  params: SearchParams;
  onSearch: (p: SearchParams) => void;
}) {
  const [text, setText] = useState(params.q);
  // Follow the URL on back and forward.
  const [query, setQuery] = useState(params.q);
  if (params.q !== query) {
    setQuery(params.q);
    setText(params.q);
  }
  const filtered = params.mode !== "hybrid" || params.shows.length > 0 || params.date !== "all";
  const [showFilters, setShowFilters] = useState(filtered);
  const filtersId = useId();

  const search = (changes: Partial<SearchParams> = {}) =>
    onSearch({ ...params, q: text.trim() || params.q, page: 1, ...changes });

  return (
    <header className="border-b border-rule px-4 pt-5 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-4 sm:flex-nowrap sm:gap-4">
        <Link
          to="/"
          aria-label="راوي: الصفحة الرئيسية"
          className="shrink-0 text-3xl font-bold text-ink no-underline max-sm:hidden sm:w-24"
        >
          راوي
        </Link>
        <search className="min-w-0 max-w-2xl flex-1">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <TextField
              variant="query"
              maxLength={200}
              type="search"
              value={text}
              onValueChange={setText}
              placeholder="ابحث في كل ما قيل…"
              aria-label="ابحث"
              className="h-12 ps-5 pe-13 text-lg"
            />
            <button
              type="submit"
              aria-label="ابحث"
              className="absolute inset-y-0 end-1.5 my-auto flex size-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
            >
              <Search className="size-5" />
            </button>
          </form>
        </search>
        <div className="flex w-full justify-end sm:contents">
          <IconButton
            label={showFilters ? "أخفِ الفلاتر" : "أظهر الفلاتر"}
            aria-pressed={showFilters}
            aria-expanded={showFilters}
            aria-controls={filtersId}
            onClick={() => setShowFilters((open) => !open)}
            className={cn("relative size-10", showFilters && "bg-accent-wash text-ink")}
          >
            <SlidersHorizontal />
            {filtered && !showFilters && (
              <span aria-hidden className="absolute top-1.5 end-1.5 size-2 rounded-full bg-accent" />
            )}
          </IconButton>
          <div className="flex sm:ms-auto">
            <DevModeToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>
      <div id={filtersId} hidden={!showFilters} className="-mx-4 border-t border-rule px-4 sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-3 py-3 sm:ps-28">
          <Segmented
            value={params.mode}
            onValueChange={(mode) => search({ mode: mode as Mode })}
            aria-label="نوع البحث"
            className="whitespace-nowrap"
          >
            <Segment value="hybrid">بالمعنى والكلمات</Segment>
            <Segment value="keyword">بالكلمات فقط</Segment>
          </Segmented>
          <ShowPicker value={params.shows} onChange={(shows) => search({ shows })} />
          <DateFilter value={params} onChange={search} />
        </div>
      </div>
    </header>
  );
}
