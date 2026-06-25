import { createRoot } from "react-dom/client";
import { App, type AppDeps, type MethodologySummary } from "./App";
import { getMethodologies } from "./lib/api";
import { getIdToken } from "./lib/auth";
import { requestExtract, runProcess } from "./lib/messaging";
import "./styles/tokens.css";

// Backend base URL for /methodologies. Overridable via WXT_BACKEND_URL at
// build time; falls back to local dev default. (/notes/stream is fetched
// from background.ts, which reads the same env var independently.)
const BACKEND_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.WXT_BACKEND_URL ??
  "http://localhost:8080";

// Best-effort: methodologies list is a UI nicety (dropdown options), so a
// fetch/auth failure here degrades to an empty list rather than blocking the
// setup page (which still works with the default methodology_id).
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
  extract: requestExtract,
  process: runProcess,
};

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<App deps={defaultDeps} />);
}
