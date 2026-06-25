import { describe, it, expect } from "vitest";
import { categorize } from "../../src/extractors/dispatch";

it("categorizes youtube watch pages", () => {
  expect(categorize("https://www.youtube.com/watch?v=abc")).toBe("youtube");
  expect(categorize("https://commandlinefanatic.com/x")).toBe("article");
});

it("categorizes non-watch youtube pages as article", () => {
  expect(categorize("https://www.youtube.com/")).toBe("article");
  expect(categorize("https://www.youtube.com/feed/subscriptions")).toBe("article");
});

it("treats invalid URLs as article", () => {
  expect(categorize("not a url")).toBe("article");
  expect(categorize("")).toBe("article");
});

it("matches bare youtube.com host without subdomain", () => {
  expect(categorize("https://youtube.com/watch?v=abc")).toBe("youtube");
});
