import { Input } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { cn } from "#lib/format";

// "query" is the search box a page is built around; "field" is every other input.
const variants = {
  query:
    "h-16 rounded-full border border-rule bg-surface px-7 text-xl placeholder:font-light focus-visible:border-faint focus-visible:outline-none",
  field:
    "h-10 rounded-control border border-rule bg-surface px-3 text-base focus-visible:border-accent focus-visible:outline-none",
} as const;

export function TextField({
  variant = "field",
  className,
  ...props
}: ComponentProps<typeof Input> & { variant?: keyof typeof variants }) {
  return (
    <Input
      autoComplete="off"
      className={cn(
        "w-full min-w-0 text-ink transition-colors duration-150 placeholder:text-faint",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
