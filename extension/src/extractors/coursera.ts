import type { ExtractContent } from "../../entrypoints/sidepanel/lib/types";

// Coursera's transcript phrase spans wrap each phrase with a leading
// zero-width space (U+200B) and a trailing no-break space (U+00A0).
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** Remove zero-width spaces and normalize no-break spaces to regular spaces, then trim. */
function cleanPhraseText(raw: string): string {
  return raw.split(ZERO_WIDTH_SPACE).join("").split(NO_BREAK_SPACE).join(" ").trim();
}

export function parseTranscript(doc: Document): string {
  const transcript = doc.querySelector(".rc-Transcript");
  if (!transcript) return "";
  // Use the semantic `.rc-Phrase` rather than the inner Emotion-hashed
  // `.css-mlsl36` span, which is auto-generated and changes on Coursera
  // rebuilds. `.rc-Phrase`'s textContent is the same phrase text (the hashed
  // span is its only text child); the timestamp button lives outside `.phrases`.
  const phrases = Array.from(transcript.querySelectorAll(".rc-Phrase"));
  return phrases
    .map((n) => cleanPhraseText(n.textContent ?? ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCourseraTitle(doc: Document): string {
  const heading = doc.querySelector("h1.video-name");
  const text = heading?.textContent?.trim();
  return text || doc.title || "";
}

export function extractCoursera(doc: Document, url: string): ExtractContent {
  const title = extractCourseraTitle(doc);
  const text = parseTranscript(doc);
  if (!text) {
    // No transcript in the DOM → surface a friendly extract_error (runExtract
    // catches this) instead of sending empty content the backend would 422.
    throw new Error("找不到課程逐字稿，請在頁面中開啟 Transcript 面板後重試。");
  }
  const course = doc.querySelector(".left-rail a[title]")?.getAttribute("title") ?? null;
  return { title, url, text, metadata: { course } };
}
