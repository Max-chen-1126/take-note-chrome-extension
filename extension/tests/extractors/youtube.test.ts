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
  const result = parsePanelDom(doc);

  // Assert: result contains each segment's text exactly ONCE (no duplicate substring)
  const segment1 = "Hey everyone, welcome back to the channel.";
  const segment2 = "Today we're going to walk through how transcript extraction works for this extension.";
  const segment3 = "When the json3 endpoint is blocked, the content script falls back to reading this panel instead.";
  const segment4 = "Each segment renders as its own element with a timestamp and a text span.";
  const segment5 = "Thanks for watching, and see you in the next one.";

  expect(result).toContain(segment1);
  expect(result).toContain(segment2);
  expect(result).toContain(segment3);
  expect(result).toContain(segment4);
  expect(result).toContain(segment5);

  // Assert: result does NOT contain timestamps (would indicate buggy overlap/duplication)
  expect(result).not.toContain("0:00");
  expect(result).not.toContain("0:04");
  expect(result).not.toContain("0:08");
  expect(result).not.toContain("0:13");
  expect(result).not.toContain("0:18");

  // Assert: result equals the expected space-joined segment texts (no duplicates, no timestamps)
  const expected = `${segment1} ${segment2} ${segment3} ${segment4} ${segment5}`;
  expect(result).toBe(expected);
});
