import { Checkbox } from "@base-ui/react/checkbox";
import { Input } from "@base-ui/react/input";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { SearchParams } from "#api/search";
import { ShowPicker } from "./ShowPicker";
import { ThemeToggle } from "./ThemeToggle";

// The sticky search bar. Submitting, or changing an option, searches for
// whatever is in the box, even if it hasn't been submitted yet.
export function SearchBar({
  params,
  onSearch,
}: {
  params: SearchParams;
  onSearch: (p: SearchParams) => void;
}) {
  const [text, setText] = useState(params.q);
  // Follow the URL when it changes underneath, e.g. on back and forward.
  useEffect(() => setText(params.q), [params.q]);

  const search = (changes: Partial<SearchParams>) =>
    onSearch({ ...params, q: text.trim(), page: 1, ...changes });

  return (
    <header className="sticky top-0 z-2 bg-bar px-4 py-3.5 text-white">
      <search className="mx-auto block max-w-184">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search({});
          }}
        >
          <div className="flex gap-2">
            <Input
              type="search"
              value={text}
              onValueChange={setText}
              placeholder="ابحث في كل الحلقات…"
              autoComplete="off"
              autoFocus
              aria-label="Search"
              className="min-w-0 flex-1 rounded-md bg-field px-3 py-2 text-xl font-medium text-ink"
            />
            <button
              type="submit"
              className="cursor-pointer rounded-md bg-signal px-5 font-semibold text-on-signal"
            >
              ابحث
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox.Root renders the control */}
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-bar-muted">
              <Checkbox.Root
                checked={params.mode === "keyword"}
                onCheckedChange={(checked) => search({ mode: checked ? "keyword" : "hybrid" })}
                className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-bar-muted bg-field text-on-signal data-checked:border-signal data-checked:bg-signal"
              >
                <Checkbox.Indicator className="flex data-unchecked:hidden">
                  <Check className="size-3" strokeWidth={3} />
                </Checkbox.Indicator>
              </Checkbox.Root>
              بحث بالكلمات فقط
            </label>
            <ShowPicker value={params.shows} onChange={(shows) => search({ shows })} />
            <ThemeToggle className="ms-auto size-7 border-bar-rule text-sm text-bar-muted hover:border-white hover:text-white" />
          </div>
        </form>
      </search>
    </header>
  );
}
