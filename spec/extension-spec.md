# Extension Spec — Take-Note Chrome Extension

> 前端：TypeScript + WXT + Manifest V3。職責是**內容萃取 + UI + 串流呈現**，不做任何 AI、不直接呼叫 LLM vendor。

## 1. 需求 (Requirements)

### 1.1 使用流程
1. 使用者在學習頁面（Blog / Book / Podcast 網頁 / YouTube / Coursera）打開 Side Panel。
2. Side Panel 自動偵測網站類別，使用者可覆寫。
3. 使用者設定：筆記方向、額外需求、provider/model、「查證上網」開關。
4. 按「處理」。
5. Extension 在瀏覽器端萃取內文 / transcript。
6. 將萃取結果 + 參數送到後端 `/notes/stream`。
7. 即時呈現步驟進度 + 漸進式 Markdown。
8. 完成後可一鍵複製。

### 1.2 功能清單
- **Side Panel 選單**
  - 網站類別：自動偵測 + 下拉覆寫（article / book / podcast / youtube / coursera）。
  - 方法論 (methodology) 下拉：選項由後端方法論清單提供。
  - 筆記方向：自由文字。
  - 額外需求：自由文字 textarea。
  - Provider / model 選擇：預設 Gemini，可改 OpenAI / Claude。
  - 查證上網 toggle：預設關。
  - 處理按鈕。
- **內容萃取**（瀏覽器端）
  - article extractor：抽主要內文 + 頁內 transcript。
  - youtube extractor：取字幕 / transcript。
  - coursera extractor：取課程 transcript。
  - 萃取失敗 → 顯示錯誤 + 「手動貼上內文」fallback。
- **串流呈現**：消費 SSE，逐步渲染 Markdown，顯示目前步驟。
- **一鍵複製**：複製最終 Markdown。

## 2. 設計如何滿足 (How the Design Satisfies)

### 2.1 專案結構（WXT + MV3）
- `entrypoints/background.ts` — service worker：
  - 處理 action click → 開啟 Side Panel。
  - 用 `chrome.identity` 取得 Google ID token（audience = Cloud Run URL）。
  - 對後端發起 `/notes/stream` 的 SSE fetch。
  - 把 `step` / `delta` / `citations` / `done` / `error` 事件轉送到 Side Panel。
- `entrypoints/sidepanel/` — UI（選單、串流 Markdown 呈現、複製按鈕）。
- `entrypoints/content/` — dispatcher 依 URL 選擇 extractor：
  - **article extractor**：Readability 風格抽取主要內文 + 頁內 transcript。
  - **youtube extractor**：解析 `ytInitialPlayerResponse` 取 caption track，於頁面 context 抓取字幕資料。
  - **coursera extractor**：從 DOM / onDemand 介面讀取 transcript（使用者登入 session）。
  - 回傳 `{ title, url, text, metadata }`。

### 2.2 訊息流
```
Side Panel ──(extract request)──▶ Background ──▶ Content Script
Content Script ──({title,url,text,metadata})──▶ Background ──▶ Side Panel
Background ──(POST /notes/stream, ID token, SSE)──▶ Backend
Backend ──(SSE: step/delta/citations/done/error)──▶ Background ──▶ Side Panel
```
- 採用 `chrome.runtime` messaging；SSE 連線由 background 持有。

### 2.3 請求格式（送往後端）
```jsonc
{
  "category": "youtube",
  "methodology_id": "...",
  "direction": "...",
  "extra_requirements": "...",
  "provider": "gemini",        // gemini | openai | claude
  "model": "gemini-3.5-flash",
  "web_search": false,
  "content": { "title": "", "url": "", "text": "", "metadata": {} }
}
```

## 3. 邊界 (Boundaries)
- **只做**：內容萃取 + UI + 串流呈現 + 複製。
- **不做**：任何 AI / prompt 組裝 / LLM 呼叫；不直接呼叫任何 vendor API。
- **不做**：STT / 音訊轉錄（只處理頁面上現成的 transcript）。
- **唯一對外通道**：後端 `POST /notes/stream`。
- 不持久化筆記（一鍵複製即完成）。

## 4. 注意事項 (Caveats)
- **YouTube**：timedtext 為非官方端點且不穩；雲端 IP 會被封鎖——因此**必須在瀏覽器端、頁面 context、用使用者 session** 取字幕，後端不碰。優先讀 `ytInitialPlayerResponse` 的 caption track。
- **Coursera**：transcript 需登入 session/cookie；只能在使用者已登入的分頁內取得。
- **Brave / Side Panel**：Brave 為 Chromium 內核，支援 `chrome.sidePanel`；若偵測不到 API，fallback 到 popup。
- **MV3 service worker 生命週期**：SW 會被回收；SSE 連線需在 SW 內妥善管理，並考慮連線中斷時保留已收到的部分內容。
- **ID token 快取**：避免每次請求都重新授權；token 過期再刷新。
- **權限最小化**：`host_permissions` 僅涵蓋必要網域（YouTube / Coursera / `<all_urls>` 視 article extractor 需求權衡）。
- **萃取健壯性**：DOM 結構會變動；extractor 需對缺失節點容錯，失敗時走手動貼上 fallback 而非整體失敗。
