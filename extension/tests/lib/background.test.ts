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

it("injects the content script and retries when sendMessage initially rejects with no receiving end, returning the relayed EXTRACT_RESULT", async () => {
  const relayedResult = {
    type: "EXTRACT_RESULT",
    payload: {
      ok: true,
      category: "article",
      content: { title: "T", url: "https://x.test", text: "body", metadata: null },
      error: null,
    },
  };

  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
    .mockResolvedValueOnce(relayedResult);
  const executeScript = vi.fn(async (_options: chrome.scripting.ScriptInjection<unknown[], unknown>) => [
    { result: undefined },
  ]);

  globalThis.chrome = {
    ...realChrome,
    tabs: {
      ...realChrome?.tabs,
      query: vi.fn(async () => [{ id: 42, url: "https://example.com/article" }]),
      sendMessage,
    },
    scripting: {
      ...realChrome?.scripting,
      executeScript,
    },
  } as unknown as typeof chrome;

  const result = await handleExtract();

  expect(executeScript).toHaveBeenCalledTimes(1);
  expect(executeScript.mock.calls[0]![0]).toMatchObject({
    target: { tabId: 42 },
    files: ["content-scripts/content.js"],
  });
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(result).toEqual(relayedResult);
});

it("also injects the MAIN-world youtube bridge when the active tab is a youtube.com page", async () => {
  const relayedResult = {
    type: "EXTRACT_RESULT",
    payload: {
      ok: true,
      category: "youtube",
      content: { title: "T", url: "https://www.youtube.com/watch?v=abc", text: "body", metadata: null },
      error: null,
    },
  };

  const sendMessage = vi
    .fn()
    .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
    .mockResolvedValueOnce(relayedResult);
  const executeScript = vi.fn(async (_options: chrome.scripting.ScriptInjection<unknown[], unknown>) => [
    { result: undefined },
  ]);

  globalThis.chrome = {
    ...realChrome,
    tabs: {
      ...realChrome?.tabs,
      query: vi.fn(async () => [{ id: 7, url: "https://www.youtube.com/watch?v=abc" }]),
      sendMessage,
    },
    scripting: {
      ...realChrome?.scripting,
      executeScript,
    },
  } as unknown as typeof chrome;

  const result = await handleExtract();

  expect(executeScript).toHaveBeenCalledTimes(2);
  expect(executeScript.mock.calls[0]![0]).toMatchObject({
    target: { tabId: 7 },
    files: ["content-scripts/content.js"],
  });
  expect(executeScript.mock.calls[1]![0]).toMatchObject({
    target: { tabId: 7 },
    files: ["content-scripts/youtube-main.js"],
    world: "MAIN",
  });
  expect(result).toEqual(relayedResult);
});

it("resolves a zh-TW extract_failed ExtractResult when injection itself fails (e.g. protected page)", async () => {
  const sendMessage = vi.fn(async () => {
    throw new Error("Could not establish connection. Receiving end does not exist.");
  });
  const executeScript = vi.fn(async () => {
    throw new Error("Cannot access a chrome:// URL");
  });

  globalThis.chrome = {
    ...realChrome,
    tabs: {
      ...realChrome?.tabs,
      query: vi.fn(async () => [{ id: 99, url: "chrome://settings" }]),
      sendMessage,
    },
    scripting: {
      ...realChrome?.scripting,
      executeScript,
    },
  } as unknown as typeof chrome;

  const result = await handleExtract();

  expect(result.type).toBe("EXTRACT_RESULT");
  if (result.type !== "EXTRACT_RESULT") throw new Error("unreachable");
  expect(result.payload.ok).toBe(false);
  expect(result.payload.error?.code).toBe("extract_failed");
  expect(result.payload.error?.message).toContain("此頁面無法擷取");
  // Only the initial attempt — no retry after a failed injection.
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
