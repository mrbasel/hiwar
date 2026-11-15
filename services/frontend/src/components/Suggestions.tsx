import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { SearchParams } from "#api/search";

// Topics that each find a few dozen episodes across different channels.
const TOPICS = [
  "الحرية المالية",
  "تربية الأطفال",
  "الذكاء الاصطناعي",
  "القهوة المختصة",
  "تاريخ الأندلس",
  "النوم",
];

// Searches that run with whatever options are set, like the box does.
export function Suggestions({ params }: { params: SearchParams }) {
  return (
    <ul aria-label="عمليات بحث مقترحة" className="mt-6 flex flex-wrap justify-center gap-2">
      {TOPICS.map((q) => (
        <li key={q}>
          <Link
            to="/"
            search={{ ...params, q, page: 1 }}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-sunken px-4 text-sm text-ink no-underline transition-colors duration-150 hover:bg-rule"
          >
            <Search className="size-3.5 text-faint" />
            {q}
          </Link>
        </li>
      ))}
    </ul>
  );
}
