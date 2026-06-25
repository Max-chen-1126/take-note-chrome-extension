import type { Msg, SseEvent } from "./sidepanel/lib/types";
import { streamNotes } from "./sidepanel/lib/api";
import { getIdToken } from "./sidepanel/lib/auth";

// Backend base URL for /notes/stream. Overridable via WXT_BACKEND_URL at
// build time; falls back to local dev default. Mirrors main.tsx's BACKEND_URL.
const BACKEND_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.WXT_BACKEND_URL ??
  "http://localhost:8080";

const PROCESS_PORT_NAME = "PROCESS";

/** Builds an extract_failed-shaped EXTRACT_RESULT with the given message. */
function extractErrorResult(message: string): Msg {
  return {
    type: "EXTRACT_RESULT",
    payload: {
      ok: false,
      category: "article",
      content: { title: "", url: "", text: "", metadata: null },
      error: { code: "extract_failed", message },
    },
  };
}

/**
 * Relays a panel EXTRACT request to the active tab's content script and
 * resolves its EXTRACT_RESULT reply. Returns an extract_failed-shaped
 * EXTRACT_RESULT if there's no active tab, `chrome.tabs.query` rejects
 * (e.g. transient extension-context error), or the content script doesn't
 * answer (e.g. chrome:// page, no content script injected).
 */
export async function handleExtract(): Promise<Msg> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return extractErrorResult("找不到目前分頁，請重新整理頁面。");

    const response = (await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT" } satisfies Msg)) as
      | Msg
      | undefined;
    if (response?.type === "EXTRACT_RESULT") return response;
    return extractErrorResult("找不到目前分頁，請重新整理頁面。");
  } catch (err) {
    return extractErrorResult(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Handles a long-lived PROCESS port from the panel: reads the NoteRequest
 * posted over the port, resolves an ID token, streams /notes/stream, and
 * forwards each SseEvent back over the port as {type:"SSE", payload}.
 * Closes the port once the stream completes (done/error) or throws.
 */
function handleProcessPort(port: chrome.runtime.Port) {
  const onMessage = (message: unknown) => {
    const msg = message as Msg;
    if (msg?.type !== "PROCESS") return;
    port.onMessage.removeListener(onMessage);

    (async () => {
      try {
        const token = await getIdToken();
        for await (const event of streamNotes(BACKEND_URL, token, msg.payload)) {
          port.postMessage({ type: "SSE", payload: event } satisfies Msg);
          if (event.event === "done" || event.event === "error") break;
        }
      } catch (err) {
        const errorEvent: SseEvent = {
          event: "error",
          data: { code: "stream_failed", message: err instanceof Error ? err.message : String(err) },
        };
        try {
          port.postMessage({ type: "SSE", payload: errorEvent } satisfies Msg);
        } catch {
          // port already disconnected on the panel side; nothing more to do
        }
      } finally {
        try {
          port.disconnect();
        } catch {
          // already disconnected
        }
      }
    })();
  };

  port.onMessage.addListener(onMessage);
}

export default defineBackground(() => {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch(() => {});

  chrome.runtime.onMessage.addListener((message: Msg, _sender, sendResponse) => {
    if (message?.type !== "EXTRACT") return undefined;
    // handleExtract() catches its own rejections (e.g. chrome.tabs.query
    // failing) and resolves an extract_failed ExtractResult, but .catch()
    // here is a defense-in-depth guarantee that sendResponse is always
    // called even if that invariant is ever broken.
    handleExtract()
      .catch((err) => extractErrorResult(err instanceof Error ? err.message : String(err)))
      .then(sendResponse);
    return true; // keep the message channel open for the async sendResponse above
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PROCESS_PORT_NAME) return;
    handleProcessPort(port);
  });
});
