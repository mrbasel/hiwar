import type { ReactNode } from "react";
import { cn } from "#lib/format";

// Small, non-interactive facts about a result: how it matched, or what it lacks.
const tones = {
  plain: "bg-sunken text-muted",
  accent: "bg-accent-wash text-accent",
  warn: "bg-error-wash text-error",
} as const;

export function Tag({ tone = "plain", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={cn("inline-flex h-5.5 items-center rounded-mark px-1.5 text-xs font-medium", tones[tone])}
    >
      {children}
    </span>
  );
}
