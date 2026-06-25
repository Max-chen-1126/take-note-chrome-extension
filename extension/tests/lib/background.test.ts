import { it, expect, vi, afterEach } from "vitest";

vi.mock("../../entrypoints/sidepanel/lib/api", () => ({ streamNotes: vi.fn(), getMethodologies: vi.fn() }));
vi.mock("../../entrypoints/sidepanel/lib/auth", () => ({ getIdToken: vi.fn(async () => null), clearToken: vi.fn() }));

import { handleExtract, handleProcessPort } from "../../entrypoints/background";
import { streamNotes } from "../../entrypoints/sidepanel/lib/api";

const realChrome = globalThis.chrome;

type Listener = (arg?: unknown) => void;
function makeFakePort() {
  const msg: Listener[] = [];
  const disc: Listener[] = [];
  return {
    onMessage: { addListener: (f: Listener) => msg.push(f), removeListener: () => {} },
    onDisconnect: { addListener: (f: Listener) => disc.push(f), removeListener: () => {} },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    _emitMessage: (m: unknown) => msg.forEach((f) => f(m)),
    _emitDisconnect: () => disc.forEach((f) => f()),
  };
}

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

it("aborts the downstream /notes/stream fetch when the panel port disconnects", async () => {
  let capturedSignal: AbortSignal | undefined;
  (streamNotes as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    // eslint-disable-next-line require-yield
    async function* (_u: unknown, _t: unknown, _b: unknown, signal: AbortSignal) {
      capturedSignal = signal;
      yield { event: "step", data: { step: "structure", status: "start", summary: null } };
      await new Promise(() => {}); // hang mid-stream, simulating an in-flight LLM stream
    },
  );

  const port = makeFakePort();
  handleProcessPort(port as unknown as chrome.runtime.Port);
  port._emitMessage({
    type: "PROCESS",
    payload: {
      category: "youtube", methodology_id: "m", mode: "concise", direction: "",
      web_search: false, provider: "gemini",
      content: { title: "", url: "", text: "x", metadata: null },
    },
  });
  await new Promise((r) => setTimeout(r, 0)); // let the async loop reach the first yield

  expect(capturedSignal).toBeDefined();
  expect(capturedSignal!.aborted).toBe(false);

  port._emitDisconnect(); // user closes the side panel
  expect(capturedSignal!.aborted).toBe(true);
});
