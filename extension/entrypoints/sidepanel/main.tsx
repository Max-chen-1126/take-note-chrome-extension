import { createRoot } from "react-dom/client";
import { App, type AppDeps, type MethodologySummary } from "./App";
import { getMethodologies } from "./lib/api";
import { requestExtract, runProcess } from "./lib/messaging";
import "./styles/tokens.css";

// Backend base URL for /methodologies. Overridable via WXT_BACKEND_URL at
// build time; falls back to local dev default. (/notes/stream is fetched
// from background.ts, which reads the same env var independently.)
const BACKEND_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.WXT_BACKEND_URL ??
  "http://localhost:8080";

// Best-effort: the methodologies list is a UI nicety (dropdown options). It's
// fetched WITHOUT a token (the backend's /methodologies is public) so opening
// the panel never triggers the Google login popup — authentication happens
// only when the user presses 開始 (the PROCESS flow in background.ts). A
// fetch failure degrades to an empty list rather than blocking the setup page.
async function loadMethodologiesBestEffort(): Promise<MethodologySummary[]> {
  try {
    const list = await getMethodologies(BACKEND_URL, null);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const defaultDeps: AppDeps = {
  loadMethodologies: loadMethodologiesBestEffort,
  extract: requestExtract,
  process: runProcess,
};

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<App deps={defaultDeps} />);
}
