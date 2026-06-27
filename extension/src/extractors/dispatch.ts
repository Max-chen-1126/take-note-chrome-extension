import type { Category } from "../../entrypoints/sidepanel/lib/types";

export function categorize(url: string): Category {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("youtube.com") && u.pathname === "/watch") return "youtube";
    if (u.hostname.endsWith("coursera.org") && u.pathname.includes("/learn/") && u.pathname.includes("/lecture/")) return "coursera";
  } catch {}
  return "article";
}
