import { Radio as Base } from "@base-ui/react/radio";
import { RadioGroup as BaseGroup } from "@base-ui/react/radio-group";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/format";

// Two or three options shown as one segmented control. Longer lists belong in a menu.
export function Segmented({ className, ...props }: ComponentProps<typeof BaseGroup>) {
  return (
    <BaseGroup
      className={cn("inline-flex rounded-control border border-rule bg-sunken p-0.5 text-sm", className)}
      {...props}
    />
  );
}

export function Segment({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Base.Root
      value={value}
      className="h-7 cursor-pointer rounded-[4px] px-3 text-muted transition-colors duration-150 hover:text-ink data-checked:bg-surface data-checked:font-medium data-checked:text-ink data-checked:shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
    >
      {children}
    </Base.Root>
  );
}
