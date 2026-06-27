import type { ExtractContent, ExtractResult, Msg } from "./sidepanel/lib/types";
import { categorize } from "../src/extractors/dispatch";
import { extractArticle } from "../src/extractors/article";
import { extractCoursera } from "../src/extractors/coursera";
import { pickCaptionBaseUrl, needsFallback, parseJson3, parsePanelDom } from "../src/extractors/youtube";

// Handshake namespace shared with youtube-main.content.ts (MAIN world). Kept
// distinct from WXT's own `wxt:content-script-started` postMessage traffic.
const YT_PLAYER_REQUEST = "YT_PLAYER";
const YT_PLAYER_TIMEOUT_MS = 2000;

/** Ask the MAIN-world script (youtube-main.content.ts) for ytInitialPlayerResponse. */
function requestPlayerResponse(): Promise<any | null> {
  return new Promise((resolve) => {
    let settled = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.tnRes !== YT_PLAYER_REQUEST) return;
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(event.data.player ?? null);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ tnReq: YT_PLAYER_REQUEST }, "*");
    setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, YT_PLAYER_TIMEOUT_MS);
  });
}

async function extractYoutube(url: string): Promise<ExtractContent> {
  const title = document.title.replace(/\s*-\s*YouTube\s*$/, "").trim() || document.title;
  const player = await requestPlayerResponse();
  const baseUrl = pickCaptionBaseUrl(player);

  let text = "";
  if (baseUrl && !needsFallback(baseUrl)) {
    try {
      const res = await fetch(`${baseUrl}&fmt=json3`);
      if (res.ok) {
        const body = await res.text();
        if (body.trim()) text = parseJson3(JSON.parse(body));
      }
    } catch {
      // network/parse failure → fall through to DOM fallback below
    }
  }
  if (!text.trim()) {
    text = parsePanelDom(document);
  }

  return {
    title,
    url,
    text,
    metadata: { author: player?.videoDetails?.author ?? null },
  };
}

async function runExtract(): Promise<ExtractResult> {
  const url = location.href;
  const category = categorize(url);
  try {
    const content =
      category === "youtube" ? await extractYoutube(url)
      : category === "coursera" ? extractCoursera(document, url)
      : extractArticle(document, url);
    return { ok: true, category, content, error: null };
  } catch (err) {
    return {
      ok: false,
      category,
      content: { title: "", url, text: "", metadata: null },
      error: { code: "extract_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    chrome.runtime.onMessage.addListener((message: Msg, _sender, sendResponse) => {
      if (message?.type !== "EXTRACT") return undefined;
      runExtract().then((payload) => {
        sendResponse({ type: "EXTRACT_RESULT", payload } satisfies Msg);
      });
      return true; // keep the message channel open for the async sendResponse above
    });
  },
});
