// Light/dark theme: follows the system until the user picks one, then
// remembers the choice. Loaded in <head> so the saved theme applies before
// the first paint.

const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");

function saved() {
  try { return localStorage.getItem("theme"); } catch { return null; }
}

function current() {
  return saved() ?? (system.matches ? "dark" : "light");
}

function apply() {
  const theme = saved();
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  for (const button of document.querySelectorAll(".theme-toggle")) {
    const dark = current() === "dark";
    button.textContent = dark ? "☀" : "☾";
    button.title = dark ? "الوضع الفاتح" : "الوضع الداكن";
    button.setAttribute("aria-label", button.title);
  }
}

apply();
system.addEventListener("change", apply);

document.addEventListener("DOMContentLoaded", () => {
  for (const button of document.querySelectorAll(".theme-toggle")) {
    button.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      try { localStorage.setItem("theme", next); } catch {}
      apply();
    });
  }
  apply();
});
