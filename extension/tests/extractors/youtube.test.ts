import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { parseJson3, parsePanelDom, pickCaptionBaseUrl, needsFallback } from "../../src/extractors/youtube";

it("parses json3 captions into text", () => {
  const json = JSON.parse(readFileSync("tests/extractors/fixtures/youtube-json3.json", "utf8"));
  const text = parseJson3(json);
  expect(text.length).toBeGreaterThan(100);
  expect(text).not.toContain("undefined");
});
it("detects exp=xpe baseUrl as needing fallback", () => {
  expect(needsFallback("https://x/timedtext?v=1&exp=xpe&lang=en")).toBe(true);
  expect(needsFallback("https://x/timedtext?v=1&lang=en")).toBe(false);
});
it("pickCaptionBaseUrl reads first track", () => {
  const pr = { captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://x/timedtext?a=1" }] } } };
  expect(pickCaptionBaseUrl(pr)).toBe("https://x/timedtext?a=1");
  expect(pickCaptionBaseUrl({})).toBeNull();
});
it("parses transcript panel DOM as fallback", () => {
  const doc = new JSDOM(readFileSync("tests/extractors/fixtures/youtube-panel.html", "utf8")).window.document;
  expect(parsePanelDom(doc).length).toBeGreaterThan(50);
});
