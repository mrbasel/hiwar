import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Mode, SearchParams } from "#api/search";
import { ShowPicker } from "#components/ShowPicker";
import { ThemeToggle } from "#components/ThemeToggle";
import { Segment, Segmented } from "#components/ui/Radio";
import { TextField } from "#components/ui/TextField";

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
  useEffect(() => setText(params.q), [params.q]);

  const search = (changes: Partial<SearchParams> = {}) =>
    onSearch({ ...params, q: text.trim() || params.q, page: 1, ...changes });

  return (
    <header className="border-b border-rule px-4 pt-5 sm:px-8">
      <div className="flex items-center gap-3 sm:gap-4">
        <Link
          to="/"
          aria-label="راوي: الصفحة الرئيسية"
          className="shrink-0 text-3xl font-bold text-ink no-underline sm:w-24"
        >
          راوي
        </Link>
        <search className="max-w-2xl flex-1">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <TextField
              variant="query"
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
        <ThemeToggle className="ms-auto" />
      </div>
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
      </div>
    </header>
  );
}
