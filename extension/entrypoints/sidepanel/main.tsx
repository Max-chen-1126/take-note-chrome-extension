import { createRoot } from "react-dom/client";
import { App, type AppDeps, type MethodologySummary } from "./App";
import { getMethodologies, streamNotes } from "./lib/api";
import { getIdToken } from "./lib/auth";
import type { ExtractResult, Msg, NoteRequest, SseEvent } from "./lib/types";
import "./styles/tokens.css";

// Backend base URL for /methodologies and /notes/stream. Overridable via
// WXT_BACKEND_URL at build time; falls back to local dev default.
const BACKEND_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.WXT_BACKEND_URL ??
  "http://localhost:8080";

// wired to chrome messaging in Task 10: real implementation sends EXTRACT to
// background -> active tab content script and awaits EXTRACT_RESULT.
async function extractPlaceholder(): Promise<ExtractResult> {
  const response = (await chrome.runtime.sendMessage({ type: "EXTRACT" } satisfies Msg)) as
    | Msg
    | undefined;
  if (response?.type === "EXTRACT_RESULT") return response.payload;
  return {
    ok: false,
    category: "article",
    content: { title: "", url: "", text: "", metadata: null },
    error: { code: "no_response", message: "未收到擷取結果，請重新整理頁面。" },
  };
}

// wired to chrome messaging in Task 10: real implementation sends PROCESS to
// background over a long-lived port and re-yields forwarded SSE events,
// keeping the panel connected for the duration of the MV3 service-worker
// lifecycle. For now this calls the backend directly as a thin placeholder.
async function* processPlaceholder(req: NoteRequest): AsyncGenerator<SseEvent> {
  const token = await getIdToken();
  yield* streamNotes(BACKEND_URL, token, req);
}

async function loadMethodologiesBestEffort(): Promise<MethodologySummary[]> {
  try {
    const token = await getIdToken();
    const list = await getMethodologies(BACKEND_URL, token);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const defaultDeps: AppDeps = {
  loadMethodologies: loadMethodologiesBestEffort,
  extract: extractPlaceholder,
  process: processPlaceholder,
};

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<App deps={defaultDeps} />);
}
