import { it, expect, vi, afterEach } from "vitest";
import { handleExtract } from "../../entrypoints/background";

const realChrome = globalThis.chrome;

afterEach(() => {
  globalThis.chrome = realChrome;
});

it("resolves an extract_failed ExtractResult when chrome.tabs.query rejects", async () => {
  globalThis.chrome = {
    ...realChrome,
    tabs: {
      ...realChrome?.tabs,
      query: vi.fn(async () => {
        throw new Error("Extension context invalidated.");
      }),
      sendMessage: vi.fn(),
    },
  } as unknown as typeof chrome;

  const result = await handleExtract();

  expect(result.type).toBe("EXTRACT_RESULT");
  if (result.type !== "EXTRACT_RESULT") throw new Error("unreachable");
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error?.code).toBe("extract_failed");
  expect(result.payload.error?.message).toContain("Extension context invalidated.");
});

it("resolves an extract_failed ExtractResult when there is no active tab", async () => {
  globalThis.chrome = {
    ...realChrome,
    tabs: {
      ...realChrome?.tabs,
      query: vi.fn(async () => []),
      sendMessage: vi.fn(),
    },
  } as unknown as typeof chrome;

  const result = await handleExtract();

  expect(result.type).toBe("EXTRACT_RESULT");
  if (result.type !== "EXTRACT_RESULT") throw new Error("unreachable");
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error?.code).toBe("extract_failed");
});
