import { Menu } from "@base-ui/react/menu";
import { Check } from "lucide-react";
import { useState } from "react";
import type { DateRange, SearchParams } from "#api/search";
import { DateRangeDialog } from "#components/DateRangeDialog";
import { chipClass } from "#components/ui/Chip";
import { panelClass } from "#components/ui/panel";
import { DATE_RANGES, dateBounds } from "#lib/dates";
import { cn } from "#lib/format";

type DateParams = Pick<SearchParams, "date" | "from" | "to">;

const itemClass =
  "flex cursor-pointer items-center gap-2 px-3 py-1.5 outline-none select-none data-highlighted:bg-sunken";

export function DateFilter({ value, onChange }: { value: DateParams; onChange: (p: DateParams) => void }) {
  const [picking, setPicking] = useState(false);
  const bounds = dateBounds(value);

  return (
    <>
      <Menu.Root>
        <Menu.Trigger className={chipClass(value.date !== "all")}>{label(value)}</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-10">
            <Menu.Popup className={cn(panelClass, "min-w-44 py-1")}>
              <Menu.RadioGroup
                value={value.date}
                onValueChange={(date: DateRange) => {
                  if (date !== "custom") onChange({ date, from: undefined, to: undefined });
                }}
              >
                {DATE_RANGES.map((range) => (
                  <Menu.RadioItem key={range.value} value={range.value} className={itemClass}>
                    <Mark />
                    {range.label}
                  </Menu.RadioItem>
                ))}
                <Menu.Separator className="my-1 h-px bg-rule" />
                <Menu.RadioItem value="custom" className={itemClass} onClick={() => setPicking(true)}>
                  <Mark />
                  نطاق مخصص…
                </Menu.RadioItem>
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <DateRangeDialog
        open={picking}
        onOpenChange={setPicking}
        initial={{ from: bounds.startDate, to: bounds.endDate }}
        onApply={({ from, to }) => onChange({ date: "custom", from, to })}
      />
    </>
  );
}

function Mark() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <Menu.RadioItemIndicator>
        <Check className="size-3.5" />
      </Menu.RadioItemIndicator>
    </span>
  );
}

function label({ date, from, to }: DateParams) {
  if (date !== "custom") return DATE_RANGES.find((r) => r.value === date)?.label;
  if (from && to) return <span dir="ltr">{`${from} – ${to}`}</span>;
  return from ? (
    <span>
      منذ <span dir="ltr">{from}</span>
    </span>
  ) : (
    <span>
      حتى <span dir="ltr">{to}</span>
    </span>
  );
}
