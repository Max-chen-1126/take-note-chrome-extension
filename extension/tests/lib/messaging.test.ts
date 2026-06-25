import { describe, it, expect, vi } from "vitest";
import { requestExtract, runProcess, type ChromeMessagingLike } from "../../entrypoints/sidepanel/lib/messaging";
import type { ExtractResult, Msg, NoteRequest, SseEvent } from "../../entrypoints/sidepanel/lib/types";

const SAMPLE_RESULT: ExtractResult = {
  ok: true,
  category: "article",
  content: { title: "T", url: "https://x.test", text: "body", metadata: null },
  error: null,
};

const SAMPLE_REQUEST: NoteRequest = {
  category: "article",
  methodology_id: "m1",
  mode: "concise",
  direction: "",
  provider: "gemini",
  web_search: false,
  content: { title: "T", url: "https://x.test", text: "body", metadata: null },
};

describe("requestExtract", () => {
  it("sends an EXTRACT message and resolves the relayed ExtractResult", async () => {
    const sendMessage = vi.fn<ChromeMessagingLike["runtime"]["sendMessage"]>(async (message) => {
      expect(message).toEqual({ type: "EXTRACT" } satisfies Msg);
      return { type: "EXTRACT_RESULT", payload: SAMPLE_RESULT } satisfies Msg;
    });
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage, connect: vi.fn() },
    };

    const result = await requestExtract(chromeLike);

    expect(result).toEqual(SAMPLE_RESULT);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("resolves an extract_failed error result when background sends an unexpected response", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage, connect: vi.fn() },
    };

    const result = await requestExtract(chromeLike);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("no_response");
  });

  it("resolves an error result when sendMessage rejects (e.g. no receiving end)", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("Could not establish connection");
    });
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage, connect: vi.fn() },
    };

    const result = await requestExtract(chromeLike);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Could not establish connection");
  });
});

/** Minimal fake chrome.runtime.Port driven manually by tests. */
function makeFakePort() {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: unknown[] = [];
  let disconnected = false;

  const port = {
    postMessage: vi.fn((message: unknown) => {
      posted.push(message);
    }),
    disconnect: vi.fn(() => {
      disconnected = true;
    }),
    onMessage: {
      addListener: (cb: (message: unknown) => void) => messageListeners.push(cb),
      removeListener: (cb: (message: unknown) => void) => {
        const i = messageListeners.indexOf(cb);
        if (i >= 0) messageListeners.splice(i, 1);
      },
    },
    onDisconnect: {
      addListener: (cb: () => void) => disconnectListeners.push(cb),
      removeListener: (cb: () => void) => {
        const i = disconnectListeners.indexOf(cb);
        if (i >= 0) disconnectListeners.splice(i, 1);
      },
    },
  };

  return {
    port,
    posted,
    emitMessage: (message: unknown) => messageListeners.forEach((cb) => cb(message)),
    emitDisconnect: () => {
      disconnected = true;
      disconnectListeners.forEach((cb) => cb());
    },
    get isDisconnected() {
      return disconnected;
    },
  };
}

describe("runProcess", () => {
  it("opens a port, posts PROCESS, and yields SSE events relayed over the port", async () => {
    const fake = makeFakePort();
    const connect = vi.fn(() => fake.port as unknown as chrome.runtime.Port);
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage: vi.fn(), connect },
    };

    const iterable = runProcess(SAMPLE_REQUEST, chromeLike);
    const iterator = iterable[Symbol.asyncIterator]();

    const first = iterator.next();
    // Let the iterator's listener registration happen before we push events.
    await Promise.resolve();
    await Promise.resolve();

    const stepEvent: SseEvent = { event: "step", data: { step: "structure", status: "start", summary: null } };
    const deltaEvent: SseEvent = { event: "delta", data: { text: "hello" } };
    const doneEvent: SseEvent = { event: "done", data: { markdown: "hello" } };

    fake.emitMessage({ type: "SSE", payload: stepEvent } satisfies Msg);
    fake.emitMessage({ type: "SSE", payload: deltaEvent } satisfies Msg);
    fake.emitMessage({ type: "SSE", payload: doneEvent } satisfies Msg);

    const results: SseEvent[] = [];
    results.push((await first).value as SseEvent);
    for await (const evt of { [Symbol.asyncIterator]: () => iterator }) {
      results.push(evt);
    }

    expect(results).toEqual([stepEvent, deltaEvent, doneEvent]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(fake.posted).toEqual([{ type: "PROCESS", payload: SAMPLE_REQUEST } satisfies Msg]);
  });

  it("terminates the iterable when the port disconnects without a done event", async () => {
    const fake = makeFakePort();
    const connect = vi.fn(() => fake.port as unknown as chrome.runtime.Port);
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage: vi.fn(), connect },
    };

    const results: SseEvent[] = [];
    const consume = (async () => {
      for await (const evt of runProcess(SAMPLE_REQUEST, chromeLike)) {
        results.push(evt);
      }
    })();

    await Promise.resolve();
    await Promise.resolve();

    const stepEvent: SseEvent = { event: "step", data: { step: "structure", status: "start", summary: null } };
    fake.emitMessage({ type: "SSE", payload: stepEvent } satisfies Msg);
    fake.emitDisconnect();

    await consume;

    expect(results).toEqual([stepEvent]);
  });

  it("stops yielding after a done event and disconnects the port", async () => {
    const fake = makeFakePort();
    const connect = vi.fn(() => fake.port as unknown as chrome.runtime.Port);
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage: vi.fn(), connect },
    };

    const results: SseEvent[] = [];
    const consume = (async () => {
      for await (const evt of runProcess(SAMPLE_REQUEST, chromeLike)) {
        results.push(evt);
      }
    })();

    await Promise.resolve();
    await Promise.resolve();

    const doneEvent: SseEvent = { event: "done", data: { markdown: "final" } };
    fake.emitMessage({ type: "SSE", payload: doneEvent } satisfies Msg);
    // A disconnect after done (background closing the port) must not surface as an error.
    fake.emitDisconnect();

    await consume;

    expect(results).toEqual([doneEvent]);
  });

  it("stops yielding after an error event", async () => {
    const fake = makeFakePort();
    const connect = vi.fn(() => fake.port as unknown as chrome.runtime.Port);
    const chromeLike: ChromeMessagingLike = {
      runtime: { sendMessage: vi.fn(), connect },
    };

    const results: SseEvent[] = [];
    const consume = (async () => {
      for await (const evt of runProcess(SAMPLE_REQUEST, chromeLike)) {
        results.push(evt);
      }
    })();

    await Promise.resolve();
    await Promise.resolve();

    const errorEvent: SseEvent = { event: "error", data: { code: "http_500", message: "boom" } };
    fake.emitMessage({ type: "SSE", payload: errorEvent } satisfies Msg);

    await consume;

    expect(results).toEqual([errorEvent]);
  });
});
