import { useState } from "react";
import { Button } from "#components/ui/Button";
import { Dialog, DialogClose, DialogPopup } from "#components/ui/Dialog";
import { TextField } from "#components/ui/TextField";
import { FIRST_DAY, isoDay } from "#lib/dates";

// Resets to `initial` each time it opens.
export function DateRangeDialog({
  open,
  onOpenChange,
  initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { from?: string; to?: string };
  onApply: (range: { from?: string; to?: string }) => void;
}) {
  const [from, setFrom] = useState(initial.from ?? "");
  const [to, setTo] = useState(initial.to ?? "");
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setFrom(initial.from ?? "");
      setTo(initial.to ?? "");
    }
  }

  const today = isoDay(new Date());
  const reversed = Boolean(from && to && from > to);
  const valid = Boolean(from || to) && !reversed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup title="نطاق مخصص">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onApply({ from: from || undefined, to: to || undefined });
            onOpenChange(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <DayField label="من" value={from} onChange={setFrom} max={to || today} />
            <DayField label="إلى" value={to} onChange={setTo} min={from || FIRST_DAY} />
          </div>
          <p aria-live="polite" className="mt-2 min-h-5 text-sm text-error">
            {reversed && "تاريخ البداية بعد تاريخ النهاية."}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <DialogClose render={<Button variant="quiet" />}>إلغاء</DialogClose>
            <Button type="submit" variant="primary" disabled={!valid}>
              تطبيق
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function DayField({
  label,
  value,
  onChange,
  min = FIRST_DAY,
  max = isoDay(new Date()),
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: TextField renders the input
    <label className="flex flex-col gap-1.5 text-sm text-muted">
      {label}
      <TextField type="date" dir="ltr" value={value} onValueChange={onChange} min={min} max={max} />
    </label>
  );
}
