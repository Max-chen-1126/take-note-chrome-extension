export function pickCaptionBaseUrl(pr: any): string | null {
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) && tracks[0]?.baseUrl ? tracks[0].baseUrl : null;
}
export function needsFallback(baseUrl: string): boolean {
  return /[?&]exp=xpe(&|$)/.test(baseUrl);
}
export function parseJson3(json: any): string {
  const events = json?.events ?? [];
  return events
    .map((e: any) => (e.segs ?? []).map((s: any) => s.utf8 ?? "").join(""))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function parsePanelDom(doc: Document): string {
  const modern = Array.from(doc.querySelectorAll("transcript-segment-view-model"));
  if (modern.length > 0) {
    return modern
      .map((seg) => (seg.querySelector('span[role="text"]')?.textContent ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  const legacy = Array.from(doc.querySelectorAll(".segment-text"));
  return legacy.map((n) => (n.textContent ?? "").trim()).filter(Boolean).join(" ").trim();
}
