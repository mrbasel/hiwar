import { Checkbox as Base } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/format";

export function Checkbox({
  children,
  className,
  ...props
}: ComponentProps<typeof Base.Root> & { children?: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <Base.Root
        className="flex size-4.5 shrink-0 items-center justify-center rounded-mark border-[1.5px] border-faint bg-surface text-on-accent transition-colors duration-100 data-checked:border-accent data-checked:bg-accent"
        {...props}
      >
        <Base.Indicator className="flex data-unchecked:hidden">
          <Check className="size-3.5" strokeWidth={3} />
        </Base.Indicator>
      </Base.Root>
      {children}
    </label>
  );
}
