# Extension Phase 1 Implementation Plan — Take-Note Chrome Extension

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作 take-note extension 切片：WXT + React + MV3 Side Panel，開 panel 自動擷取（YouTube + 通用 article）→唯讀預覽→按「開始」→ 對後端 `/notes/stream` 串流呈現 Markdown→一鍵複製。

**Architecture:** WXT MV3。Side Panel（React，雙階段設定→結果）。Background SW 取 auth token + 持有後端 SSE fetch + 轉送事件。Content script dispatcher 依 URL 選 article(Readability) / youtube(captionTracks json3 + DOM fallback) 擷取器；YouTube 需 MAIN world 讀 `ytInitialPlayerResponse`。

**Tech Stack:** TypeScript、WXT、React 19、`@wxt-dev/module-react`、`@mozilla/readability`、marked、vitest、@testing-library/react、@types/chrome。

**Spec 來源：** `spec/extension-spec.md`（含 design tokens、雙階段流程、messaging 契約、auth flow、擷取法 caveats）。SSE/`NoteRequest` 跨端契約見 `spec/backend-spec.md`。

## Context
後端 Phase A 完成（PR #1）。本計畫實作 extension 切片並對**本地後端**跑通。在 `feat/extension` 分支。

## Global Constraints
- TypeScript strict；React 19 + `@wxt-dev/module-react`。
- 視覺：黑白圓角現代，集中於 `styles/tokens.css`（palette/radius/type 見 spec §Visual Design Language）；單一強調色＝黑 `#0A0A0A`。
- SSE 事件契約 `step/delta/citations/done/error` 與 `NoteRequest` 與 `spec/backend-spec.md` 一致，不可單方更動。
- 切片只 `youtube` + `article` 兩個類別；Coursera / 可編輯擷取 / 多 provider UI / 深色模式 **不做**。
- 擷取唯讀；擷取在瀏覽器端（content script），後端不碰 YT。
- **Auth↔後端協調**：正式 auth（`launchWebAuthFlow` 取 ID token, aud=client_id）需後端 Phase B 改 audience。**本切片的本地 E2E 以「dev 模式」對本地後端跑**：背景仍實作取 token 流程，但提供 `DEV_BEARER` 環境覆寫；本地後端以放寬 auth 執行（`CLOUD_RUN_SERVICE_URL` 空 → audience 略過 + `ALLOWED_EMAILS` 對應 dev token email，或本地暫時 stub `verify_request`）。
- 後端 base URL 由 `import.meta.env.WXT_BACKEND_URL` 提供，本地預設 `http://localhost:8080`。
- 測試 URL（fixtures / 手動 E2E）：
  - article：`https://commandlinefanatic.com/cgi-bin/showarticle.cgi?article=art008`
  - blog（article 類）：`https://openai.com/zh-Hant/index/building-self-improving-tax-agents-with-codex/`
  - youtube：`https://www.youtube.com/watch?v=cGuyrANVi4A`

## File Structure
```
extension/
  package.json  wxt.config.ts  tsconfig.json  vitest.config.ts  .env.example
  entrypoints/
    background.ts                 # defineBackground：開 side panel、auth、SSE 轉送
    sidepanel/
      index.html  main.tsx  App.tsx
      components/{ExtractCard,SettingsForm,StepProgress,MarkdownView,CopyButton}.tsx
      lib/{types.ts,api.ts,messaging.ts,auth.ts}
      styles/tokens.css
    content.ts                    # defineContentScript ISOLATED：dispatcher
    youtube-main.ts               # defineContentScript world:"MAIN"：讀 ytInitialPlayerResponse → postMessage
  src/extractors/{article.ts,youtube.ts}   # 純函式，可被 content + vitest 共用
  tests/
    extractors/{article.test.ts,youtube.test.ts}
    extractors/fixtures/{commandlinefanatic.html,openai-blog.html,youtube-watch.html,youtube-json3.json,youtube-panel.html}
    lib/{sse.test.ts,messaging.test.ts}
    components/{ExtractCard.test.tsx,StepProgress.test.tsx,MarkdownView.test.tsx}
```
> 擷取器放 `src/extractors/`（純函式：吃 `Document`/字串，吐結果）以便 vitest 直接測；content script 只做 DOM 取得 + 呼叫純函式。

---

### Task 1: WXT + React scaffold + background 開 side panel

**Files:** Create `extension/package.json`, `extension/wxt.config.ts`, `extension/tsconfig.json`, `extension/vitest.config.ts`, `extension/.env.example`, `extension/entrypoints/background.ts`, `extension/entrypoints/sidepanel/{index.html,main.tsx,App.tsx}`, `extension/entrypoints/sidepanel/styles/tokens.css`, `extension/tests/smoke.test.ts`

**Interfaces:**
- Produces: 可 `npm run build` 的 WXT 專案；`npm test`（vitest）可跑；點擊 action 開 side panel；side panel 顯示 "Take-Note"。

- [ ] **Step 1: 初始化 WXT React 專案**
```bash
cd extension
npm init -y
npm i -D wxt @wxt-dev/module-react typescript vitest @testing-library/react @testing-library/jsdom jsdom @types/chrome @types/react @types/react-dom
npm i react react-dom @mozilla/readability marked
```
> 版本：`react@^19`、`wxt` 最新穩定——實作時對 npm 再確認並鎖進 `package.json`。

- [ ] **Step 2: `wxt.config.ts`**
```ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Take-Note",
    action: {},                       // sidepanel 需要空 action
    permissions: ["sidePanel", "activeTab", "scripting", "storage", "identity"],
    host_permissions: ["https://www.youtube.com/*", "<all_urls>"],
  },
});
```

- [ ] **Step 3: vitest 設定** — `vitest.config.ts`
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", globals: true, include: ["tests/**/*.test.{ts,tsx}"] },
});
```
`package.json` scripts：`"dev":"wxt","build":"wxt build","test":"vitest run"`。

- [ ] **Step 4: 失敗測試** — `tests/smoke.test.ts`
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("tokens file exists with primary color", async () => {
    const css = await import("fs").then(m => m.readFileSync("entrypoints/sidepanel/styles/tokens.css", "utf8"));
    expect(css).toContain("--tn-primary");
  });
});
```

- [ ] **Step 5: 確認失敗** — `npm test`（FAIL：tokens.css 不存在）

- [ ] **Step 6: 實作**
`entrypoints/background.ts`
```ts
export default defineBackground(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
```
`entrypoints/sidepanel/index.html`（標準 WXT React HTML 掛 `main.tsx`），`main.tsx`（`createRoot(...).render(<App/>)`），`App.tsx`（先回傳 `<div className="tn-app">Take-Note</div>`）。
`entrypoints/sidepanel/styles/tokens.css`
```css
:root{
  --tn-bg:#FFFFFF; --tn-surface:#FAFAFA; --tn-border:#E5E5E5;
  --tn-text:#0A0A0A; --tn-muted:#737373; --tn-primary:#0A0A0A; --tn-on-primary:#FFFFFF;
  --tn-r-card:16px; --tn-r-control:10px; --tn-r-pill:9999px;
  --tn-font:system-ui,-apple-system,"Noto Sans TC",sans-serif;
}
.tn-app{font-family:var(--tn-font);color:var(--tn-text);background:var(--tn-bg);padding:16px;}
```
`.env.example`：`WXT_BACKEND_URL=http://localhost:8080`

- [ ] **Step 7: 確認通過** — `npm test`；`npm run build` 成功。
- [ ] **Step 8: Commit**（訊息含 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer，後續每 task 皆同）

---

### Task 2: 共用型別（跨端契約）

**Files:** Create `extension/entrypoints/sidepanel/lib/types.ts`, `extension/tests/lib/types.test.ts`

**Interfaces:**
- Produces: `Category="youtube"|"article"`；`Mode="concise"|"detailed"`；`Provider="gemini"|"openai"|"claude"`；`ExtractResult`；`NoteRequest`；`SseEvent`（discriminated union by `event`）；messaging `Msg` union。

- [ ] **Step 1: 失敗測試** — `tests/lib/types.test.ts`（型別＋常數值斷言）
```ts
import { describe, it, expect } from "vitest";
import { STEP_LABELS, type NoteRequest } from "../../entrypoints/sidepanel/lib/types";
it("step labels cover the 5 backend steps", () => {
  expect(Object.keys(STEP_LABELS)).toEqual(["structure","draft","augment","verify","format"]);
});
it("NoteRequest shape compiles", () => {
  const r: NoteRequest = { category:"youtube", methodology_id:"m", mode:"concise",
    direction:"", web_search:false, provider:"gemini",
    content:{ title:"", url:"", text:"x", metadata:null } };
  expect(r.provider).toBe("gemini");
});
```

- [ ] **Step 2: 確認失敗** → **Step 3: 實作** `lib/types.ts`
```ts
export type Category = "youtube" | "article";
export type Mode = "concise" | "detailed";
export type Provider = "gemini" | "openai" | "claude";

export interface ExtractContent { title:string; url:string; text:string; metadata:Record<string,unknown>|null; }
export interface ExtractResult { ok:boolean; category:Category; content:ExtractContent; error:{code:string;message:string}|null; }

export interface NoteRequest {
  category:Category; methodology_id:string; mode:Mode; direction:string;
  extra_requirements?:string|null; provider:Provider; model?:string|null;
  web_search:boolean; content:ExtractContent;
}

export type StepName = "structure"|"draft"|"augment"|"verify"|"format";
export const STEP_LABELS:Record<StepName,string> =
  { structure:"整理", draft:"草稿", augment:"補充", verify:"查證", format:"成稿" };

export type SseEvent =
  | { event:"step"; data:{ step:StepName; status:"start"|"done"; summary:string|null } }
  | { event:"delta"; data:{ text:string } }
  | { event:"citations"; data:{ items:{title:string;url:string}[] } }
  | { event:"done"; data:{ markdown:string } }
  | { event:"error"; data:{ code:string; message:string } };

export type Msg =
  | { type:"EXTRACT" }
  | { type:"EXTRACT_RESULT"; payload:ExtractResult }
  | { type:"PROCESS"; payload:NoteRequest }
  | { type:"SSE"; payload:SseEvent };
```
- [ ] **Step 4: 確認通過** → **Step 5: Commit**

---

### Task 3: Article 擷取器（Readability）+ fixtures

**Files:** Create `extension/src/extractors/article.ts`, `extension/tests/extractors/article.test.ts`, fixtures `commandlinefanatic.html`, `openai-blog.html`

**Interfaces:**
- Consumes: `ExtractContent`
- Produces: `extractArticle(doc: Document, url: string) -> ExtractContent`（用 `@mozilla/readability` 的 `Readability(doc.cloneNode(true)).parse()`；回 title + 純文字 text）

- [ ] **Step 1: 取得 fixtures** — 用瀏覽器「儲存完整網頁 HTML」或 `curl` 將兩個 article URL 存成 `tests/extractors/fixtures/commandlinefanatic.html`、`openai-blog.html`。（OpenAI 部落格為 SSR/含內文的 HTML；若 `curl` 拿到的是空殼 SPA，改用瀏覽器存「已渲染 DOM」。在報告中記錄取得方式。）
- [ ] **Step 2: 失敗測試** — `tests/extractors/article.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { extractArticle } from "../../src/extractors/article";

function docFrom(file:string){ return new JSDOM(readFileSync(`tests/extractors/fixtures/${file}`,"utf8"),{url:"https://example.com"}).window.document; }

it("extracts the commandlinefanatic article body", () => {
  const r = extractArticle(docFrom("commandlinefanatic.html"), "https://commandlinefanatic.com/...");
  expect(r.title.length).toBeGreaterThan(0);
  expect(r.text.length).toBeGreaterThan(500);          // 主要內文抽出
  expect(r.text).not.toMatch(/<script|<nav/i);          // 純文字、無標記
});
it("extracts the openai blog body (zh-Hant)", () => {
  const r = extractArticle(docFrom("openai-blog.html"), "https://openai.com/...");
  expect(r.text.length).toBeGreaterThan(300);
});
```
- [ ] **Step 3: 確認失敗** → **Step 4: 實作** `src/extractors/article.ts`
```ts
import { Readability } from "@mozilla/readability";
import type { ExtractContent } from "../../entrypoints/sidepanel/lib/types";

export function extractArticle(doc: Document, url: string): ExtractContent {
  const parsed = new Readability(doc.cloneNode(true) as Document).parse();
  const title = parsed?.title?.trim() || doc.title || "";
  const text = (parsed?.textContent || doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return { title, url, text, metadata: { byline: parsed?.byline ?? null } };
}
```
- [ ] **Step 5: 確認通過** → **Step 6: Commit**

---

### Task 4: YouTube 擷取器（json3 + DOM fallback）+ fixtures

**Files:** Create `extension/src/extractors/youtube.ts`, `extension/tests/extractors/youtube.test.ts`, fixtures `youtube-json3.json`（正常字幕）, `youtube-panel.html`（transcript 面板 DOM）

**Interfaces:**
- Produces:
  - `parseJson3(json:any) -> string`（串接 `events[].segs[].utf8`）
  - `parsePanelDom(doc:Document) -> string`（抓 transcript 面板 segment 文字）
  - `pickCaptionBaseUrl(playerResponse:any) -> string|null`（取 captionTracks[0].baseUrl）
  - `needsFallback(baseUrl:string) -> boolean`（含 `&exp=xpe` → true）
  （DOM/網路存取放 content script；這裡是純解析函式，可單測。）

- [ ] **Step 1: fixtures** — 從測試影片 `cGuyrANVi4A` 取：在該頁 console 取 `JSON.stringify(ytInitialPlayerResponse.captions...)` 找 baseUrl，`fetch(baseUrl+"&fmt=json3")` 存成 `youtube-json3.json`；開啟「顯示轉錄稿」面板存其 DOM 片段成 `youtube-panel.html`。報告記錄取得方式與該影片 baseUrl 是否含 `exp=xpe`。
- [ ] **Step 2: 失敗測試** — `tests/extractors/youtube.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import { parseJson3, parsePanelDom, pickCaptionBaseUrl, needsFallback } from "../../src/extractors/youtube";

it("parses json3 captions into text", () => {
  const json = JSON.parse(readFileSync("tests/extractors/fixtures/youtube-json3.json","utf8"));
  const text = parseJson3(json);
  expect(text.length).toBeGreaterThan(100);
  expect(text).not.toContain("undefined");
});
it("detects exp=xpe baseUrl as needing fallback", () => {
  expect(needsFallback("https://x/timedtext?v=1&exp=xpe&lang=en")).toBe(true);
  expect(needsFallback("https://x/timedtext?v=1&lang=en")).toBe(false);
});
it("pickCaptionBaseUrl reads first track", () => {
  const pr = { captions:{ playerCaptionsTracklistRenderer:{ captionTracks:[{ baseUrl:"https://x/timedtext?a=1" }] } } };
  expect(pickCaptionBaseUrl(pr)).toBe("https://x/timedtext?a=1");
  expect(pickCaptionBaseUrl({})).toBeNull();
});
it("parses transcript panel DOM as fallback", () => {
  const doc = new JSDOM(readFileSync("tests/extractors/fixtures/youtube-panel.html","utf8")).window.document;
  expect(parsePanelDom(doc).length).toBeGreaterThan(50);
});
```
- [ ] **Step 3: 確認失敗** → **Step 4: 實作** `src/extractors/youtube.ts`
```ts
export function pickCaptionBaseUrl(pr:any):string|null {
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) && tracks[0]?.baseUrl ? tracks[0].baseUrl : null;
}
export function needsFallback(baseUrl:string):boolean { return /[?&]exp=xpe(&|$)/.test(baseUrl); }
export function parseJson3(json:any):string {
  const events = json?.events ?? [];
  return events.map((e:any)=>(e.segs??[]).map((s:any)=>s.utf8??"").join("")).join("").replace(/\n{3,}/g,"\n\n").trim();
}
export function parsePanelDom(doc:Document):string {
  const segs = Array.from(doc.querySelectorAll("ytd-transcript-segment-renderer .segment-text, .ytd-transcript-segment-renderer"));
  return segs.map(n=>(n.textContent??"").trim()).filter(Boolean).join(" ").trim();
}
```
> **注意事項**：選 track 時優先使用者語言/手動字幕（Phase 2 可加挑選邏輯）；`parsePanelDom` 選擇器以實際 YouTube DOM 為準（fixture 取得時一併確認 class）。
- [ ] **Step 5: 確認通過** → **Step 6: Commit**

---

### Task 5: Content dispatcher + MAIN world 注入

**Files:** Create `extension/entrypoints/content.ts`, `extension/entrypoints/youtube-main.ts`, `extension/src/extractors/dispatch.ts`, `extension/tests/extractors/dispatch.test.ts`

**Interfaces:**
- Produces: `categorize(url:string) -> Category`（youtube.com/watch → "youtube"，否則 "article"）；content script 監聽 `EXTRACT` → 回 `EXTRACT_RESULT`。
- youtube-main.ts（world:"MAIN"）：讀 `window.ytInitialPlayerResponse`，`postMessage` 給 isolated content script。

- [ ] **Step 1: 失敗測試** — `tests/extractors/dispatch.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { categorize } from "../../src/extractors/dispatch";
it("categorizes youtube watch pages", () => {
  expect(categorize("https://www.youtube.com/watch?v=abc")).toBe("youtube");
  expect(categorize("https://commandlinefanatic.com/x")).toBe("article");
});
```
- [ ] **Step 2: 確認失敗** → **Step 3: 實作**
`src/extractors/dispatch.ts`
```ts
import type { Category } from "../../entrypoints/sidepanel/lib/types";
export function categorize(url:string):Category {
  try { const u=new URL(url); if(u.hostname.endsWith("youtube.com") && u.pathname==="/watch") return "youtube"; } catch {}
  return "article";
}
```
`entrypoints/content.ts`（ISOLATED dispatcher）— `defineContentScript({ matches:["<all_urls>"], main(){ chrome.runtime.onMessage... 收 EXTRACT → 依 categorize 跑 extractArticle(document,...) 或 透過 window.postMessage 向 MAIN world 要 playerResponse、fetch json3（needsFallback→parsePanelDom）→ 回 EXTRACT_RESULT }})`。實作時依 WXT messaging API；MAIN world 取值用 `window.postMessage` 握手。
`entrypoints/youtube-main.ts`
```ts
export default defineContentScript({
  matches:["https://www.youtube.com/*"], world:"MAIN",
  main(){
    window.addEventListener("message",(e)=>{
      if(e.source===window && e.data?.tnReq==="YT_PLAYER"){
        window.postMessage({ tnRes:"YT_PLAYER", player:(window as any).ytInitialPlayerResponse ?? null }, "*");
      }
    });
  },
});
```
> **驗證**：WXT 的 `defineContentScript`/messaging 與 MAIN↔ISOLATED `postMessage` 握手以實裝 WXT 版本確認；content script 端的 fetch/DOM 取得無法用 jsdom 單測 → 留手動 E2E（Task 10）覆蓋，純函式（categorize/parse*）已單測。
- [ ] **Step 4: 確認通過**（categorize 測試）→ **Step 5: Commit**

---

### Task 6: SSE 消費（`lib/api.ts`）

**Files:** Create `extension/entrypoints/sidepanel/lib/api.ts`, `extension/tests/lib/sse.test.ts`

**Interfaces:**
- Produces: `parseSseChunk(buffer:string) -> { events:SseEvent[]; rest:string }`（解析 `event:`/`data:` 區塊，留未完成尾段）；`async function* streamNotes(url, token, body) : AsyncGenerator<SseEvent>`（fetch+ReadableStream）；`getMethodologies(url, token)`.

- [ ] **Step 1: 失敗測試** — `tests/lib/sse.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { parseSseChunk } from "../../entrypoints/sidepanel/lib/api";
it("parses complete events and keeps remainder", () => {
  const raw = 'event: step\ndata: {"step":"structure","status":"start","summary":null}\n\nevent: delta\ndata: {"text":"嗨"}\n\nevent: del';
  const { events, rest } = parseSseChunk(raw);
  expect(events.length).toBe(2);
  expect(events[0]).toEqual({ event:"step", data:{ step:"structure", status:"start", summary:null }});
  expect(events[1]).toEqual({ event:"delta", data:{ text:"嗨" }});
  expect(rest).toBe("event: del");
});
```
- [ ] **Step 2: 確認失敗** → **Step 3: 實作** `lib/api.ts`
```ts
import type { SseEvent, NoteRequest } from "./types";

export function parseSseChunk(buffer:string):{events:SseEvent[];rest:string}{
  const events:SseEvent[]=[]; const blocks=buffer.split("\n\n");
  const rest=blocks.pop() ?? "";
  for(const b of blocks){
    let ev=""; let data="";
    for(const line of b.split("\n")){
      if(line.startsWith("event:")) ev=line.slice(6).trim();
      else if(line.startsWith("data:")) data+=line.slice(5).trim();
    }
    if(ev && data) events.push({ event:ev, data:JSON.parse(data) } as SseEvent);
  }
  return { events, rest };
}

export async function* streamNotes(baseUrl:string, token:string|null, body:NoteRequest):AsyncGenerator<SseEvent>{
  const res=await fetch(`${baseUrl}/notes/stream`,{ method:"POST",
    headers:{ "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}) },
    body:JSON.stringify(body) });
  if(!res.ok || !res.body){ yield { event:"error", data:{ code:`http_${res.status}`, message:await res.text() }}; return; }
  const reader=res.body.getReader(); const dec=new TextDecoder(); let buf="";
  for(;;){ const {done,value}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true}); const { events, rest }=parseSseChunk(buf); buf=rest;
    for(const e of events) yield e; }
}

export async function getMethodologies(baseUrl:string, token:string|null){
  const res=await fetch(`${baseUrl}/methodologies`,{ headers: token?{Authorization:`Bearer ${token}`}:{} });
  if(!res.ok) return []; return res.json();
}
```
- [ ] **Step 4: 確認通過** → **Step 5: Commit**

---

### Task 7: Auth（`lib/auth.ts`）

**Files:** Create `extension/entrypoints/sidepanel/lib/auth.ts`, `extension/tests/lib/auth.test.ts`

**Interfaces:**
- Produces: `getIdToken(): Promise<string|null>`（dev：若 `import.meta.env.WXT_DEV_BEARER` 有值直接回；否則 `launchWebAuthFlow` 取 id_token，快取於 `chrome.storage.session`，過期重取）；`clearToken()`.

- [ ] **Step 1: 失敗測試** — `tests/lib/auth.test.ts`（mock：dev bearer 路徑回該值；mock chrome.storage.session 快取命中不重打）
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
// 透過注入/mock import.meta.env 與 globalThis.chrome 測 dev-bearer 與快取分支
// （見實作：getIdToken 先讀 env dev bearer，再讀 session 快取，最後 launchWebAuthFlow）
```
（實作測試時以可注入的 deps 包裝 `launchWebAuthFlow` 與 storage，使分支可測。）
- [ ] **Step 2–4: 實作 + 綠**：`getIdToken` 先 `import.meta.env.WXT_DEV_BEARER`，次 `chrome.storage.session` 快取（含過期檢查），末 `chrome.identity.launchWebAuthFlow({ url: authUrl, interactive:true })` 解析 URL fragment 的 `id_token`。`authUrl` 用 Google OAuth2 endpoint + `client_id`(來自 `import.meta.env.WXT_OAUTH_CLIENT_ID`) + `response_type=id_token` + `scope=openid email` + `nonce`。
> **協調項**：正式運作待後端改 aud=client_id（Phase B）。本切片 E2E 走 `WXT_DEV_BEARER` + 本地放寬後端。
- [ ] **Step 5: Commit**

---

### Task 8: React 元件（黑白圓角）

**Files:** Create `components/{ExtractCard,SettingsForm,StepProgress,MarkdownView,CopyButton}.tsx`, tests `tests/components/{ExtractCard,StepProgress,MarkdownView}.test.tsx`

**Interfaces:**
- `ExtractCard({result}:{result:ExtractResult})` — 唯讀：標題、類別 pill、字數、可捲內文預覽。
- `SettingsForm({methodologies, value, onChange})` — 方法論下拉、模式 pill toggle、方向 input、查證 switch。
- `StepProgress({active, doneSteps})` — 5 點（STEP_LABELS）。
- `MarkdownView({markdown})` — `marked.parse` → `dangerouslySetInnerHTML`（信任後端輸出；切片可接受）。
- `CopyButton({text})` — `navigator.clipboard.writeText`，複製後短暫顯示「已複製」。

- [ ] **Step 1: 失敗測試（範例）** — `tests/components/StepProgress.test.tsx`
```tsx
import { render, screen } from "@testing-library/react";
import { StepProgress } from "../../entrypoints/sidepanel/components/StepProgress";
it("renders 5 step labels and marks active", () => {
  render(<StepProgress active="draft" doneSteps={["structure"]} />);
  ["整理","草稿","補充","查證","成稿"].forEach(l=>expect(screen.getByText(l)).toBeTruthy());
});
```
（ExtractCard：顯示字數與標題；MarkdownView：渲染 `# H` → `<h1>`。）
- [ ] **Step 2–4: 實作 + 綠**（每元件用 tokens.css 變數；無彩色、圓角一致）。
- [ ] **Step 5: Commit**

---

### Task 9: App 狀態機 + 串接（設定頁 ↔ 結果頁）

**Files:** Modify `entrypoints/sidepanel/App.tsx`；Create `tests/components/App.test.tsx`

**Interfaces:**
- App 狀態：`extracting | ready | extract_error | streaming | done | stream_error`。
- 掛載時送 `EXTRACT`（經 background→content）取 `ExtractResult`；ready 顯示 ExtractCard+SettingsForm+開始鈕；按開始送 `PROCESS` 並切結果頁，收 `SSE` 事件更新 StepProgress/MarkdownView；done 啟用 CopyButton；error 顯示並保留已串內容。

- [ ] **Step 1: 失敗測試** — `App.test.tsx`：mock messaging，注入一串假 SSE 事件（step×N→delta×M→done），斷言 ready→開始→結果頁出現步驟與最終 markdown、複製鈕啟用。
- [ ] **Step 2–4: 實作 + 綠**（messaging 用 `lib/messaging.ts` 包裝 `chrome.runtime` port；測試以 mock 取代）。
- [ ] **Step 5: Commit**

---

### Task 10: background 串接 + messaging + 手動 E2E

**Files:** Modify `entrypoints/background.ts`；Create `entrypoints/sidepanel/lib/messaging.ts`, `tests/lib/messaging.test.ts`

**Interfaces:**
- `messaging.ts`：型別化 `sendToBackground(msg)`、`onSsePort(cb)`。
- background：收 panel `EXTRACT` → 轉發 active tab content script → 回 `EXTRACT_RESULT`；收 `PROCESS` → `getIdToken()` → `streamNotes()` 逐事件經 port 推回 panel（`SSE`）。

- [ ] **Step 1–4**：messaging round-trip 單測（mock chrome）；background 串接（整合邏輯，能測的以 mock 測）。
- [ ] **Step 5: 手動 E2E（里程碑）**
```bash
# 後端（本地，放寬 auth）：
cd backend && gcloud auth application-default login
GOOGLE_CLOUD_PROJECT=max-personal-447802 GOOGLE_GENAI_USE_VERTEXAI=TRUE GOOGLE_CLOUD_LOCATION=global \
  ALLOWED_EMAILS=dev@local CLOUD_RUN_SERVICE_URL= uv run uvicorn app.main:app --port 8080
# extension：
cd extension && WXT_BACKEND_URL=http://localhost:8080 WXT_DEV_BEARER=<dev> npm run dev
# Brave 載入 .output/chrome-mv3，分別開三個測試頁，開 panel→自動擷取→開始→串流→複製
```
對 3 個測試 URL 各跑一次：article(commandlinefanatic)、blog(openai zh-Hant)、youtube(cGuyrANVi4A)。記錄結果。
> 若本地後端 auth 仍擋，臨時於 `verify_request` 加 dev 短路（不提交）或先完成後端 Phase B 協調項 #9。
- [ ] **Step 6: Commit**

---

## Verification（整體）
- `cd extension && npm test`（types/extractors/sse/messaging/components）全綠。
- `npm run build` 產出 `.output/chrome-mv3`。
- 手動 E2E：3 個測試 URL 開 panel→自動擷取（唯讀預覽正確）→開始→`step→delta→done` 串流→Markdown 呈現→複製成功，對本地後端跑通。

## Phase 2（後續）
Coursera 擷取器、擷取可編輯 + 手動貼上 fallback、provider/model 選擇 UI、深色模式、popup fallback、正式 auth（待後端 Phase B 協調項 #9：aud=client_id + Cloud Run unauth）。

## Self-Review 註記
- Spec coverage：tokens/風格(Task1/8)、型別契約(Task2)、article/youtube 擷取(Task3/4/5)、SSE 消費(Task6)、auth(Task7)、元件(Task8)、雙階段狀態機(Task9)、background/messaging+E2E(Task10)。
- 純函式（extractors/parse/categorize/parseSseChunk）皆單測；content/background 的 DOM/網路/chrome 整合以手動 E2E 覆蓋（jsdom 測不到）。
- 待確認（外部/實裝）：WXT 確切 messaging 與 MAIN-world API、React/wxt 版本、YouTube DOM 選擇器與該影片是否 `exp=xpe`、OAuth client_id（後端協調項）。

## 寫入順序
Task 1 → 10 依序；subagent-driven（每 task fresh subagent + 任務間 review）。
