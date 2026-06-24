import type { Category } from "../../entrypoints/sidepanel/lib/types";

export function categorize(url: string): Category {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("youtube.com") && u.pathname === "/watch") return "youtube";
  } catch {}
  return "article";
}
