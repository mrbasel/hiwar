import { Bug } from "lucide-react";
import { IconButton } from "#components/ui/Button";
import { useDevMode } from "#lib/devMode";
import { DEV } from "#lib/env";
import { cn } from "#lib/format";

// Builds drop it.
export const DevModeToggle = DEV ? Toggle : () => null;

function Toggle({ className }: { className?: string }) {
  const [on, toggle] = useDevMode();
  return (
    <IconButton
      label={on ? "أوقف وضع التطوير" : "شغّل وضع التطوير"}
      aria-pressed={on}
      onClick={toggle}
      className={cn(on && "text-accent", className)}
    >
      <Bug />
    </IconButton>
  );
}
