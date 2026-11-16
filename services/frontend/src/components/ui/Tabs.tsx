import { Tabs as Base } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "#lib/format";

// Views of one thing, such as an episode's description and transcript. The
// chosen tab is underlined in the ink colour, on a rule across the page.
export const Tabs = Base.Root;

export function TabList({ className, ...props }: ComponentProps<typeof Base.List>) {
  return <Base.List className={cn("flex gap-6 border-b border-rule", className)} {...props} />;
}

export function Tab({ className, ...props }: ComponentProps<typeof Base.Tab>) {
  return (
    <Base.Tab
      className={cn(
        "relative -mb-px cursor-pointer pt-1 pb-2.5 text-base font-medium text-muted transition-colors duration-150 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full hover:text-ink data-active:font-semibold data-active:text-ink data-active:after:bg-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TabPanel({ className, ...props }: ComponentProps<typeof Base.Panel>) {
  return <Base.Panel className={cn("pt-6 focus-visible:outline-none", className)} {...props} />;
}
