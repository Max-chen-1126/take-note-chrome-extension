# AGENTS.md

本檔定義在此專案工作的行為準則與技術標準。所有 agent（含 Claude Code）與貢獻者皆需遵守。與專案內其他指示衝突時，以使用者明確指示為最高優先。

**Tradeoff**：以下準則偏向謹慎而非速度。對 trivial 任務，可用判斷。

---

## Part A — 行為準則 (Behavioral Guidelines)

### 1. Think Before Coding
**不要假設。不要藏起困惑。把 tradeoff 攤開。**
- 動工前明確陳述假設；不確定就問。
- 有多種解讀時，呈現出來——不要默默選一個。
- 有更簡單的做法就說；該推回時推回。
- 有不清楚的地方就停下，指出哪裡不清楚，問。

### 2. Simplicity First (YAGNI)
**用最少的程式碼解決問題。不做臆測性的東西。**
- 不加未被要求的功能。
- 不為單次使用的程式碼做抽象。
- 不加未被要求的「彈性 / 可設定性」。
- 不為不可能發生的情境寫錯誤處理。
- 若寫了 200 行但其實 50 行就夠，重寫。
- 自問：「資深工程師會說這過度複雜嗎？」會的話就簡化。

### 3. Surgical Changes
**只動非動不可的部分。只清理自己造成的爛攤子。**
- 編輯既有程式碼時：不「順手改善」相鄰程式碼、註解、格式。
- 不重構沒壞的東西。
- 配合既有風格，即使你會用別種寫法。
- 看到無關的死碼，提出來——不要刪。
- 你的修改造成孤兒（unused import / 變數 / 函式）時，移除它們；但不要刪既有的死碼除非被要求。
- 測試：每一行被改的程式碼都能直接追溯到使用者的需求。

### 4. Goal-Driven Execution
**定義成功標準。循環直到驗證通過。**
- 把任務轉成可驗證的目標：
  - 「加驗證」→「為非法輸入寫測試，再讓它通過」。
  - 「修 bug」→「寫一個能重現的測試，再讓它通過」。
  - 「重構 X」→「確保重構前後測試都通過」。
- 多步驟任務先列簡短計畫：
  ```
  1. [步驟] → 驗證：[檢查]
  2. [步驟] → 驗證：[檢查]
  ```

**這些準則生效的徵兆**：diff 裡不必要的改動變少、因過度複雜而重寫的情況變少、釐清問題發生在動工前而非犯錯後。

---

## Part B — 專案技術標準 (Project Technical Standards)

### 架構邊界（必守）
- **Extension** 只做萃取 + UI + 串流呈現；不做 AI、不直接呼叫任何 LLM vendor。
- **Backend** 只做認證 + agent 整理 + SSE；**不抓 YouTube / Coursera**。
- 兩端唯一通道：`POST /notes/stream`。

### 前端 (TS / WXT / MV3)
- 遵循 WXT 慣例（`entrypoints/`、`wxt.config.ts`）。
- TypeScript strict；訊息 payload 用明確型別。
- 內容萃取對缺失 DOM 容錯；失敗走「手動貼上」fallback，而非整體崩潰。
- 權限最小化（`host_permissions` 僅必要網域）。

### 後端 (Python / FastAPI)
- 型別註記齊全；用 Pydantic model 定義請求 / 事件契約。
- Orchestrator 步驟泛用，差異由 Firestore 方法論資料驅動，不寫死在程式碼。
- Provider 一律走統一 adapter 介面；新增 vendor = 新增一個 adapter。

### 跨端契約：SSE 事件
- 事件型別固定：`step` / `delta` / `citations` / `done` / `error`。
- 前後端**都**以此為準；任何變更需同步兩端與兩份 spec。

### Secrets / 認證
- OpenAI / Anthropic key 只存 Secret Manager；Gemini 走 ADC。
- Key **絕不**進 repo、絕不寫進 log。
- 後端驗 Google ID token 簽章 + audience + email allowlist。

### Firestore
- Collections：`prompt_templates`、`methodologies`。
- 文件 schema 變更需更新 backend-spec 與 README「新增方法論」段落。

### 測試要求
- Extension：各 extractor 對存檔 HTML fixtures 做單元測試。
- Backend：orchestrator 步驟用 mock adapter 測；adapter contract 測；SSE 端點測；Firestore emulator 測 template loader。
- 改邏輯前先確保相關測試存在或補上（見 Goal-Driven Execution）。

### Commit
- 訊息聚焦單一變更；可追溯到需求。
- 文件（spec / AGENTS / README）與程式碼行為不一致時，視為 bug，需修正。
