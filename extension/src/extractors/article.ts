import { Readability } from "@mozilla/readability";
import type { ExtractContent } from "../../entrypoints/sidepanel/lib/types";

export function extractArticle(doc: Document, url: string): ExtractContent {
  const parsed = new Readability(doc.cloneNode(true) as Document).parse();
  const title = parsed?.title?.trim() || doc.title || "";
  const text = (parsed?.textContent || doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return { title, url, text, metadata: { byline: parsed?.byline ?? null } };
}
