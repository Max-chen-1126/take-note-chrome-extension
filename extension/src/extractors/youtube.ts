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
  const segs = Array.from(doc.querySelectorAll(".segment-text"));
  return segs.map(n => (n.textContent ?? "").trim()).filter(Boolean).join(" ").trim();
}
