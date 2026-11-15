import { Moon, Sun } from "lucide-react";
import { IconButton } from "#components/ui/Button";
import { useTheme } from "#lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, toggle] = useTheme();
  return (
    <IconButton
      label={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
      onClick={toggle}
      className={className}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </IconButton>
  );
}
