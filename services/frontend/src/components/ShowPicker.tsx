import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Popover } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useShows } from "#api/shows";
import { Button } from "#components/ui/Button";
import { chipClass } from "#components/ui/Chip";
import { panelClass } from "#components/ui/panel";
import { TextField } from "#components/ui/TextField";
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
      <Popover.Trigger className={chipClass(value.length > 0)}>{label}</Popover.Trigger>
      <Popover.Portal>
        {/* Always below the trigger, shortening the list to fit rather than flipping over the page above. */}
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionAvoidance={{ side: "none" }}
          className="z-10"
        >
          <Popover.Popup
            className={cn(
              panelClass,
              "flex max-h-[calc(var(--available-height)-1rem)] w-[min(22rem,calc(100vw-2rem))] flex-col",
            )}
          >
            <div className="flex gap-1.5 border-b border-rule p-2">
              <TextField
                type="search"
                value={filter}
                onValueChange={setFilter}
                placeholder="ابحث عن قناة…"
                autoComplete="off"
                aria-label="Filter channels"
                className="h-9 flex-1 text-sm"
              />
              <Button size="sm" className="h-9" onClick={() => value.length && onChange([])}>
                كل القنوات
              </Button>
            </div>
            <CheckboxGroup
              value={value}
              onValueChange={onChange}
              aria-label="Channels"
              className="max-h-80 min-h-0 overflow-y-auto py-1"
            >
              {visible.map((show) => (
                <label
                  key={show.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-sunken"
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
