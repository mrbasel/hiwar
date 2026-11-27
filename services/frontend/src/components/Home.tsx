import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";
import type { SearchParams } from "#api/search";
import { DevModeToggle } from "#components/DevModeToggle";
import { Suggestions } from "#components/Suggestions";
import { ThemeToggle } from "#components/ThemeToggle";
import { TextField } from "#components/ui/TextField";
import { useDevMode } from "#lib/devMode";

export function Home({ params, onSearch }: { params: SearchParams; onSearch: (p: SearchParams) => void }) {
  const [text, setText] = useState("");
  const [devMode] = useDevMode();
  const set = (changes: Partial<SearchParams>) => onSearch({ ...params, page: 1, ...changes });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 px-4 py-3 text-sm">
        {devMode && (
          <Link to="/map" className="rounded-control px-2 py-1 text-muted no-underline hover:text-ink">
            خريطة الحلقات
          </Link>
        )}
        <DevModeToggle />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pt-[18vh] pb-16">
        <h1 className="text-center text-[clamp(3.5rem,12vw,6rem)] leading-tight font-bold">حوار</h1>
        <p className="mt-8 mb-10 text-center text-lg text-muted">محرك بحث للبودكستات العربية</p>

        <search>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) set({ q: text.trim() });
            }}
          >
            <div className="relative">
              <TextField
                variant="query"
                maxLength={200}
                type="search"
                value={text}
                onValueChange={setText}
                placeholder="ابحث في أكثر من 15,000 حلقة…"
                autoFocus
                aria-label="ابحث"
                className="pe-16"
              />
              <button
                type="submit"
                aria-label="ابحث"
                className="absolute inset-y-0 end-2 my-auto flex size-12 cursor-pointer items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
              >
                <Search className="size-5.5" />
              </button>
            </div>
          </form>

          <Suggestions params={params} />
        </search>
      </main>
    </div>
  );
}
