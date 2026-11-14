import { cn } from "#lib/format";
import { useTheme } from "#lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, toggle] = useTheme();
  const label = theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-rule text-base leading-none text-muted hover:border-ink hover:text-ink",
        className,
      )}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
