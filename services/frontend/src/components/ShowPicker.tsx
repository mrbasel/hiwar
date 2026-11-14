import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Input } from "@base-ui/react/input";
import { Popover } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useShows } from "#api/shows";
import { arabic, cn, fold } from "#lib/format";

// Picks the channels to search in; none picked means all of them.
export function ShowPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: shows = [] } = useShows();
  const [filter, setFilter] = useState("");
  const needle = fold(filter.trim());
  const visible = useMemo(
    () => (needle ? shows.filter((s) => fold(s.name).includes(needle)) : shows),
    [shows, needle],
  );

  const label = !value.length
    ? "كل القنوات"
    : value.length === 1
      ? (shows.find((s) => s.id === value[0])?.name ?? "قناة واحدة")
      : `${arabic(value.length)} قنوات`;

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "cursor-pointer rounded-full border border-bar-rule px-2.5 py-0.5 text-sm text-bar-muted hover:border-white hover:text-white data-popup-open:border-white data-popup-open:text-white",
          value.length > 0 && "border-white text-white",
        )}
      >
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-10">
          <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-rule bg-surface text-sm text-ink shadow-[0_8px_24px_rgb(0_0_0/0.18)] outline-none transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <div className="flex gap-1.5 border-b border-rule p-2">
              <Input
                type="search"
                value={filter}
                onValueChange={setFilter}
                placeholder="ابحث عن قناة…"
                autoComplete="off"
                aria-label="Filter channels"
                className="min-w-0 flex-1 rounded border border-rule bg-field px-2 py-1 text-[0.9rem]"
              />
              <button
                type="button"
                onClick={() => value.length && onChange([])}
                className="cursor-pointer rounded border border-rule px-2.5 text-[0.8rem] font-medium text-signal"
              >
                كل القنوات
              </button>
            </div>
            <CheckboxGroup
              value={value}
              onValueChange={onChange}
              aria-label="Channels"
              className="max-h-80 overflow-y-auto py-1"
            >
              {visible.map((show) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox.Root renders the control
                <label
                  key={show.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-paper"
                >
                  <Checkbox.Root
                    value={show.id}
                    className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-muted text-on-signal data-checked:border-signal data-checked:bg-signal"
                  >
                    <Checkbox.Indicator className="flex data-unchecked:hidden">
                      <Check className="size-3" strokeWidth={3} />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <span>{show.name}</span>
                  <span className="ms-auto text-[0.8rem] text-muted tabular-nums">
                    {arabic(show.episodes)}
                  </span>
                </label>
              ))}
            </CheckboxGroup>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
