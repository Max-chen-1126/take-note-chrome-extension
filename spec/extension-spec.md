# Extension Spec — Take-Note Chrome Extension

> 前端：TypeScript + React + WXT + Manifest V3。職責是**自動擷取 + UI + 串流呈現 + 複製**，不做任何 AI、不直接呼叫 LLM vendor。
>
> 本檔遵循 Spec-Driven Development：spec 是一等資產、敘事用 Markdown、深層結構用 YAML、版本號鎖定、護欄右尺寸化。SSE 事件與 `NoteRequest` 與 [`backend-spec.md`](backend-spec.md) 為跨端契約。

## Context
後端 Phase A 已完成（Gemini + ADK，`POST /notes/stream` SSE 跑通）。本 spec 細化 extension：React、極簡黑白圓角現代風、開 panel 自動擷取→先呈現擷取內容（唯讀）→使用者按「開始」才處理。初版擷取 YouTube + 通用 article + Coursera；podcast 視為含 transcript 的網頁（沿用 article 擷取器）。

## 鎖定決定
| 項目 | 值 |
|---|---|
| 框架 | TypeScript + React + WXT + MV3 |
| UI 風格 | 極簡黑白、圓角、現代、乾淨、留白 |
| 版面/流程 | **雙階段**：設定頁（自動擷取卡 + 設定 + 開始）→ 結果頁（步驟進度 + 串流 Markdown + 複製 + 返回）|
| 擷取時機 | 開 panel 即自動擷取當前頁，唯讀呈現；按「開始」才送後端 |
| 擷取可編輯 | 否（唯讀預覽；手動貼上/編輯留 Phase 2）|
| Auth | 0.1.0：app 層 launchWebAuthFlow 取 ID token（aud=OAuth client_id）+ Bearer；後端驗簽章+aud+allowlist。規劃：Cloud Run IAP。|
| 初版切片 | Side Panel + **YouTube + 通用 article** 擷取器 + Coursera + SSE 串流 + 複製；對本地後端跑通 |
| 延後(Phase 2) | 手動貼上/可編輯、auth 正式化、多 provider UI、popup fallback、深色模式 |

> **跨端協調（已定）**：0.1.0 採 app 層認證（後端 aud==OAuth client_id）；IAP 為 post-0.1.0 規劃。

## Objective
在學習頁面（初版：YouTube、一般文章類網頁）一鍵把內文/transcript 擷取出來，於 Side Panel 確認後送後端生成結構化 Markdown 筆記，逐步串流呈現並一鍵複製。

## Scope（切片）
**做**：Side Panel React UI（雙階段）、自動擷取（article + youtube + Coursera 擷取）、唯讀擷取預覽、方法論/模式/方向/查證設定、SSE 串流呈現、一鍵複製、auth（取 ID token 附於請求）。podcast 類網頁沿用 article 擷取器。
**Phase 2**：擷取內容可編輯 + 手動貼上 fallback、provider/model 選擇 UI、深色模式、popup fallback。

## Visual Design Language（黑白圓角現代）
```yaml
palette:
  bg:         "#FFFFFF"
  surface:    "#FAFAFA"      # 卡片底
  border:     "#E5E5E5"
  text:       "#0A0A0A"
  muted:      "#737373"      # 次要文字（灰階）
  primary:    "#0A0A0A"      # 主要按鈕＝黑底白字
  on_primary: "#FFFFFF"
radius:
  card: 16px
  control: 10px
  pill: 9999px               # 模式 toggle / 標籤
type:
  font: "system-ui, -apple-system, 'Noto Sans TC', sans-serif"
  scale: { title: "16px/600", body: "14px/400", caption: "12px/400" }
spacing: [4, 8, 12, 16, 24]  # px scale
principles: 大量留白、單一強調色(黑)、細邊框、無/極淺陰影、圓角一致
```

## UX Flow（雙階段狀態機）
```
open panel
  → [extracting] 自動向 content script 要擷取結果（skeleton/「擷取中…」）
  → [ready]      擷取卡(唯讀:標題/類別badge/字數/內文預覽) + 設定 + 啟用「開始」
                 (擷取失敗 → [extract_error] 可操作錯誤；切片無手動貼上，提示重整/換頁)
  → 按「開始」 → [streaming] 切到結果頁：步驟進度 + 逐字串流 Markdown
  → [done] 完整筆記 + 啟用「複製」；「返回」回設定頁
  → 串流中 error 事件 → [stream_error] 錯誤 + 保留已串內容 + 可重試
```
**設定頁**：擷取卡（標題、類別 pill、字數、可捲內文預覽）→ 方法論下拉 → 模式 (精簡)(詳細) pill toggle → 方向輸入 → 查證上網 switch → 黑底「▶ 開始處理」大鈕。
**結果頁**：頂部「‹ 返回」+ 5 步進度點（整理·草稿·補充·查證·成稿）+「⧉ 複製」；下方串流 Markdown。

## Architecture（WXT + MV3）
```
extension/
  wxt.config.ts                 # manifest、permissions、sidePanel、host_permissions
  entrypoints/
    background.ts               # SW：開 side panel；取 ID token；對後端 SSE fetch；轉送事件
    sidepanel/
      index.html
      main.tsx                  # React 掛載
      App.tsx                   # 雙階段路由(setup/result) + 狀態機
      components/
        ExtractCard.tsx         # 唯讀擷取卡
        SettingsForm.tsx        # 方法論/模式/方向/查證
        StepProgress.tsx        # 5 步進度
        MarkdownView.tsx        # 串流 Markdown 呈現
        CopyButton.tsx
      lib/
        api.ts                  # /methodologies、/notes/stream(SSE 消費)
        messaging.ts            # 與 background/content 的型別化訊息
        types.ts                # 跨端型別（NoteRequest、SSE 事件、ExtractResult）
      styles/tokens.css         # 設計 tokens
    content.ts                  # dispatcher：依 URL 路由 youtube/coursera/article 擷取器，回 ExtractResult
    youtube-main.content.ts     # 注入 MAIN world 讀 ytInitialPlayerResponse
  src/
    extractors/
      dispatch.ts              # URL → 擷取器判斷邏輯
      article.ts               # @mozilla/readability 抽主要內文
      youtube.ts               # captionTracks json3（MAIN world）+ DOM 面板 fallback
      coursera.ts              # Transcript 面板 DOM 擷取（見 Extraction Methods）
  tests/
    extractors/                 # HTML fixtures 單元測試
    lib/                        # SSE 解析、messaging
    components/                 # @testing-library/react
```

## Messaging Contract（型別化）
```yaml
panel → background:               { type: "EXTRACT" }              # 開 panel 時
background → content(active tab): { type: "EXTRACT" }
content → background → panel:     { type: "EXTRACT_RESULT", payload: ExtractResult }
ExtractResult:
  ok: bool
  category: "youtube" | "article" | "coursera"
  content: { title: string, url: string, text: string, metadata: object|null }
  error: { code: string, message: string } | null
panel → background:  { type: "PROCESS", payload: NoteRequest }     # 按開始
background → panel:  { type: "SSE", event: "step|delta|citations|done|error", data: object }
```
- background 持有對後端的 SSE fetch；串流期間以 port 保持 panel 連線（MV3 SW 生命週期下）；斷線→ error 並保留已收內容。
- `NoteRequest` / SSE 事件型別與 [`backend-spec.md`](backend-spec.md) 跨端契約一致，不可單方更動。

## Auth Flow（app 層）
- 0.1.0 採 app 層認證（見 [`backend-spec.md`](backend-spec.md) §8）。
- `chrome.identity.launchWebAuthFlow`：用 **Web OAuth client** 當 aud，`response_type=id_token`、`scope=openid email`，取得 Google **ID token**（`aud` = OAuth client_id）。
- `/notes/stream`、`/methodologies` 請求帶 `Authorization: Bearer <id_token>`。
- token 快取於記憶體 + `chrome.storage.session`；過期(401)觸發重新授權。
- 後端驗 ID token 簽章 + `aud == OAUTH_CLIENT_ID` + email allowlist。
> 規劃：改走 Cloud Run IAP（aud=IAP 程式化 client_id）。

## Extraction Methods
```yaml
article:
  lib: "@mozilla/readability"          # 對 document clone 跑，取 title + textContent（去導覽/廣告）
youtube:
  primary:
    - 於 MAIN world 讀 window.ytInitialPlayerResponse
    - captions.playerCaptionsTracklistRenderer.captionTracks[] 取 baseUrl
    - fetch(baseUrl + "&fmt=json3")（頁面 session/IP）→ 串接 segments 成 transcript
  fallback:
    - baseUrl 含 &exp=xpe 或回空 body → 改抓已渲染的「Show transcript」面板 DOM segments
  metadata: { title, channel, videoId, lang }
coursera:
  detect: hostname endsWith coursera.org 且 pathname 含 /learn/ 與 /lecture/
  transcript: 取第一個 .rc-Transcript 內 .rc-Phrase .css-mlsl36 文字，去 U+200B 零寬空格、U+00A0 轉空格、collapse 空白；不含 timestamp
  title: h1.video-name（fallback document.title）
  fallback: 找不到 .rc-Transcript / 空 → extract_error，提示開啟 Transcript 面板後重試
```
> **注意事項**：(a) `&exp=xpe`(PoToken) 會讓 timedtext 回空 → 必須有 DOM 面板 fallback；(b) `ytInitialPlayerResponse` 在 MAIN world，content script 預設 isolated → 用 WXT `world:"MAIN"` 注入或解析頁面 script；(c) 兩路徑皆失敗 → `extract_error`（切片不做手動貼上，提示使用者開啟字幕面板後重試）。
> podcast 無獨立擷取器，沿用 article（Readability 抓網頁內文/transcript）。

## SSE Consumption（`lib/api.ts`）
- 用 `fetch` + `ReadableStream` reader 解析 `text/event-stream`（非 `EventSource`，因需帶 `Authorization` header 與 POST body）。
- 逐塊解析 `event:` / `data:`，分派 step/delta/citations/done/error；delta 累加進 `MarkdownView`；done 設最終文字並啟用複製。

## Versioned Dependencies（實作時再確認）
```yaml
node: ">=20"
deps:
  wxt: latest-stable
  react: "^19"             # 再確認
  react-dom: "^19"
  "@mozilla/readability": latest-stable
  marked OR markdown-it: latest-stable   # Markdown→HTML 呈現（擇一）
dev:
  typescript, vitest, "@testing-library/react", "@types/chrome"
```

## Testing Strategy
- **Extractors**：對存檔 HTML fixtures 單元測試——YouTube（正常 json3、`exp=xpe` → DOM fallback）、article（Readability）。
- **lib/api SSE 解析**：對 mock event-stream 驗證 step/delta/done/error 分派與 delta 累加。
- **messaging**：型別化訊息 round-trip。
- **元件**：StepProgress / MarkdownView / ExtractCard render 測試（@testing-library/react + vitest）。
- **E2E（手動）**：Brave 載入未封裝 build，對真實 YouTube + 文章頁，開 panel→自動擷取→開始→串流→複製，對本地後端跑通。

## Boundaries
- 只做擷取 + UI + 串流呈現 + 複製；不做 AI、不直接呼叫任何 LLM vendor。
- 不做 STT、不持久化筆記。
- 唯一對外：後端 `/notes/stream`、`/methodologies`。
- 初版 youtube + article + coursera；可編輯/多 provider UI/深色模式延後。
