import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { parseTranscript, extractCourseraTitle } from "../../src/extractors/coursera";

function loadFixtureDoc(): Document {
  return new JSDOM(readFileSync("tests/extractors/fixtures/coursera-transcript.html", "utf8")).window.document;
}

it("parses transcript text from the first .rc-Transcript block, deduped against the second", () => {
  const doc = loadFixtureDoc();
  const result = parseTranscript(doc);

  const phrase1 = "Let's jump in to talk about the Internet protocol.";
  const phrase2 = "It's the layer that lets every network speak the same language.";
  const phrase3 = "Each packet carries a source and destination address.";
  const phrase4 = "Routers use that address to forward the packet onward.";

  expect(result).toContain(phrase1);
  expect(result).toContain(phrase2);
  expect(result).toContain(phrase3);
  expect(result).toContain(phrase4);

  // Assert: each phrase appears exactly ONCE even though the fixture has two
  // duplicate .rc-Transcript blocks (real Coursera pages render the full
  // transcript twice: one hidden copy, one visible panel copy).
  expect(result.split(phrase1).length - 1).toBe(1);
  expect(result.split(phrase2).length - 1).toBe(1);
  expect(result.split(phrase3).length - 1).toBe(1);
  expect(result.split(phrase4).length - 1).toBe(1);

  // Assert: result equals the expected space-joined phrase texts exactly
  // (no duplicates, no timestamps, no stray zero-width/nbsp chars).
  const expected = `${phrase1} ${phrase2} ${phrase3} ${phrase4}`;
  expect(result).toBe(expected);
});

it("excludes timestamp text from the transcript", () => {
  const doc = loadFixtureDoc();
  const result = parseTranscript(doc);

  expect(result).not.toContain("0:09");
  expect(result).not.toContain("0:18");
});

it("strips zero-width spaces and no-break spaces from phrase text", () => {
  const doc = loadFixtureDoc();
  const result = parseTranscript(doc);

  const zeroWidthSpace = String.fromCharCode(0x200b);
  const noBreakSpace = String.fromCharCode(0xa0);

  expect(result).not.toContain(zeroWidthSpace);
  expect(result).not.toContain(noBreakSpace);
});

it("returns empty string when no .rc-Transcript is present", () => {
  const doc = new JSDOM("<html><body><h1 class='video-name'>No Transcript</h1></body></html>").window.document;
  expect(parseTranscript(doc)).toBe("");
});

it("extracts the video title from h1.video-name", () => {
  const doc = loadFixtureDoc();
  expect(extractCourseraTitle(doc)).toBe("Internet Protocol");
});

it("falls back to doc.title when h1.video-name is missing", () => {
  const doc = new JSDOM("<html><head><title>Fallback Title</title></head><body></body></html>").window.document;
  expect(extractCourseraTitle(doc)).toBe("Fallback Title");
});
