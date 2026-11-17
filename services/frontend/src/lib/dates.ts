import type { DateRange, SearchParams } from "#api/search";

// Episodes have no time, so "past 24 hours" is today and yesterday.

export const DATE_RANGES: { value: Exclude<DateRange, "custom">; label: string }[] = [
  { value: "all", label: "كل الأوقات" },
  { value: "day", label: "آخر ٢٤ ساعة" },
  { value: "week", label: "الأسبوع الماضي" },
  { value: "month", label: "الشهر الماضي" },
  { value: "year", label: "السنة الماضية" },
];

export const FIRST_DAY = "2012-05-24";

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Clamped to the end of a shorter month.
function monthsBack(date: Date, months: number): Date {
  const y = date.getFullYear();
  const m = date.getMonth() - months;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), last));
}

export function dateBounds(
  params: Pick<SearchParams, "date" | "from" | "to">,
  now = new Date(),
): { startDate?: string; endDate?: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (params.date) {
    case "day":
      return { startDate: isoDay(new Date(y, m, d - 1)) };
    case "week":
      return { startDate: isoDay(new Date(y, m, d - 7)) };
    case "month":
      return { startDate: isoDay(monthsBack(now, 1)) };
    case "year":
      return { startDate: isoDay(monthsBack(now, 12)) };
    case "custom":
      return { startDate: params.from, endDate: params.to };
    default:
      return {};
  }
}
