// Typed messaging helpers used by the side panel to talk to background.ts.
//
// Both helpers accept an optional "chrome-like" object so the round-trip
// logic (request shape, response routing, port lifecycle) is unit-testable
// with a mocked chrome -- the real chrome.runtime is only the default.
//
// Contract (see spec/extension-spec.md "Messaging Contract"):
//   requestExtract(): panel --EXTRACT--> background --EXTRACT--> active tab
//                      content script --EXTRACT_RESULT--> background
//                      --EXTRACT_RESULT--> panel.
//   runProcess(req):  panel opens a port, posts PROCESS, background streams
//                      backend SSE events back as {type:"SSE", payload}
//                      until "done"/"error" or the port disconnects.
import type { ExtractResult, Msg, NoteRequest, SseEvent } from "./types";

/** Minimal seam over the chrome APIs this module touches, for testability. */
export interface ChromeMessagingLike {
  runtime: {
    sendMessage: (message: Msg) => Promise<Msg | undefined>;
    connect: (connectInfo?: { name?: string }) => chrome.runtime.Port;
  };
}

function defaultChromeLike(): ChromeMessagingLike {
  return {
    runtime: {
      sendMessage: (message) => chrome.runtime.sendMessage(message),
      connect: (connectInfo) => chrome.runtime.connect(connectInfo),
    },
  };
}

function extractErrorResult(code: string, message: string): ExtractResult {
  return {
    ok: false,
    category: "article",
    content: { title: "", url: "", text: "", metadata: null },
    error: { code, message },
  };
}

/**
 * Asks background to extract the active tab's content. Resolves the relayed
 * ExtractResult, or a synthetic extract_failed-style result if background
 * didn't reply as expected (e.g. no receiving end / unexpected message).
 */
export async function requestExtract(chromeLike: ChromeMessagingLike = defaultChromeLike()): Promise<ExtractResult> {
  let response: Msg | undefined;
  try {
    response = await chromeLike.runtime.sendMessage({ type: "EXTRACT" });
  } catch (err) {
    return extractErrorResult("extract_failed", err instanceof Error ? err.message : String(err));
  }

  if (response?.type === "EXTRACT_RESULT") return response.payload;
  return extractErrorResult("no_response", "未收到擷取結果，請重新整理頁面。");
}

const PROCESS_PORT_NAME = "PROCESS";

/**
 * Opens a chrome.runtime port to background, sends PROCESS with `req`, and
 * yields each SSE event relayed back over the port as {type:"SSE"}.
 * Completes when a "done"/"error" SSE event arrives, or when the port
 * disconnects (e.g. background-side fetch/port error) -- whichever is first.
 */
export function runProcess(
  req: NoteRequest,
  chromeLike: ChromeMessagingLike = defaultChromeLike()
): AsyncIterable<SseEvent> {
  return {
    [Symbol.asyncIterator]() {
      const port = chromeLike.runtime.connect({ name: PROCESS_PORT_NAME });

      const queue: SseEvent[] = [];
      let pendingResolve: ((result: IteratorResult<SseEvent>) => void) | null = null;
      let finished = false;

      /** Resolves a waiting next() call, if any; otherwise a no-op (caller already queued/finished). */
      function resolvePending(result: IteratorResult<SseEvent>) {
        if (!pendingResolve) return;
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve(result);
      }

      function finish() {
        if (finished) return;
        finished = true;
        port.onMessage.removeListener(onMessage);
        port.onDisconnect.removeListener(onDisconnect);
        resolvePending({ value: undefined, done: true });
      }

      function onMessage(message: unknown) {
        const msg = message as Msg;
        if (msg?.type !== "SSE") return;
        const event = msg.payload;

        if (pendingResolve) {
          resolvePending({ value: event, done: false });
        } else {
          queue.push(event);
        }

        if (event.event === "done" || event.event === "error") {
          finished = true;
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
        }
      }

      function onDisconnect() {
        finish();
      }

      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(onDisconnect);
      port.postMessage({ type: "PROCESS", payload: req } satisfies Msg);

      return {
        async next(): Promise<IteratorResult<SseEvent>> {
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          if (finished) {
            return { value: undefined, done: true };
          }
          return new Promise<IteratorResult<SseEvent>>((resolve) => {
            pendingResolve = resolve;
          });
        },
        async return(value?: unknown): Promise<IteratorResult<SseEvent>> {
          if (!finished) {
            finished = true;
            port.onMessage.removeListener(onMessage);
            port.onDisconnect.removeListener(onDisconnect);
            try {
              port.disconnect();
            } catch {
              // already disconnected
            }
          }
          return { value: value as SseEvent, done: true };
        },
      };
    },
  };
}
