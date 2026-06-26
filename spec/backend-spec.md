# Backend Spec — Take-Note Chrome Extension

> 後端：Python + FastAPI + **Google ADK**，部署於 Cloud Run（asia-east1）。職責是**認證 + 多步驟 agent 整理 + SSE 串流**。**完全不碰 YouTube / Coursera**。
>
> 本檔遵循 Spec-Driven Development：spec 是一等資產（程式碼可拋棄）、敘事用 Markdown、深層結構用 YAML、版本號鎖定、行為以 Gherkin 場景驗證（見 [`backend.feature`](backend.feature)）、護欄右尺寸化。

---

## 鎖定決定
| 項目 | 值 |
|---|---|
| GCP Project | `max-personal-447802`（number `343692970282`）|
| Cloud Run 區域 | `asia-east1`（台灣）|
| Orchestration | Google ADK（`google-adk` 2.x）`SequentialAgent`，由自訂 FastAPI 服務承載 |
| Gemini | Vertex AI **global endpoint**（asia-east1 已 deprecation），`gemini-3.5-flash`，ADC |
| OpenAI | 0.1.0 不實作（保留 `ProviderNotImplemented` 程式縫，UI/邏輯不擴充；Phase C 再開）|
| Claude | 0.1.0 不實作（保留 `ProviderNotImplemented` 程式縫，UI/邏輯不擴充；Phase C 再開）|
| effort | Gemini High（thinking budget）；OpenAI/Claude 0.1.0 不實作 |
| SSE 粒度 | 步驟級事件 + 最終 format 步盡量 token 級 |
| Auth | Cloud Run 內建 IAP（無 Load Balancer）；後端信任 IAP 注入的 X-Goog-Authenticated-User-Email + email allowlist（defense-in-depth）|
| 儲存 | Firestore `methodologies` / `prompt_templates`；不存筆記 |
| 護欄 | 右尺寸個人版（見 §10）|

> ⚠️ **版本再確認（知識截止陷阱）**：`gemini-3.5-flash` 與 `google-adk` 確切版本，實作時以官方文件 / PyPI 再三確認後鎖進 `pyproject.toml`（`uv.lock` 鎖定解析結果），不得沿用訓練截止的舊版本。OpenAI/Claude 0.1.0 不實作，故其 model id 暫不鎖。

---

## 0. Background（為什麼這樣設計）
- **瓶頸下移**：spec 是耐久資產、程式碼可拋棄。本 spec 是後端的「架構北極星」，任何重生都以它為準。
- **邊界即安全**：後端**不碰 YT/Coursera**（雲端 IP 被封 + 需登入 session），萃取留在 extension。後端只做認證 + agent 整理 + 串流。
- **為何 ADK**：與使用者 Gemini / Vertex 生態一致、內建 agent 結構與 eval；`SequentialAgent` 正對應七步 pipeline。
- **為何 global endpoint**：asia-east1 的 Vertex Gemini 已停；Cloud Run 留台灣降延遲，Gemini 走 global endpoint 換可用性（代價：無 data residency 保證——個人用可接受）。
- **為何步驟級串流**：ADK `SequentialAgent` 尚不支援全程 token live streaming；務實採「每步完成即推 + 最終步盡量 token 級」。
- **0.1.0 範圍**：Gemini-only、IAP 邊緣認證、四類筆記模板（youtube/blog/podcast/coursera）+ 共用 global-style，產物含可貼進 Obsidian 的 YAML frontmatter。

## 1. Objective
接收 extension 萃取的學習內容與參數，依指定方法論用多步驟 agent 整理成結構化 Markdown 筆記，透過 SSE 串回，供單一授權使用者使用。

## 2. Architecture
```
Extension ──POST /notes/stream (ID token, SSE)──▶ FastAPI (Cloud Run, asia-east1)
                                                   │
   IAP（Google 邊緣）驗證身分 → 後端讀 X-Goog-Authenticated-User-Email + email allowlist
   Request validation (Pydantic)
   Firestore loader (methodology + template, TTL cache)
   Context-hygiene resolver ([[VAR]] 佔位符)
   ADK Runner ── SequentialAgent ──────────────────────────────────────────
     collect(code) → structure → draft → augment → verify → format(stream)
     每個 LlmAgent 的 model 由 provider 決定：
       gemini → Vertex global endpoint (native google_search)
       # openai/claude：0.1.0 不實作，保留縫
   ADK events → 正規化 → SSE: step / delta / citations / done / error
```

## 3. Project Structure（待生成；先確認結構，禁 YOLO）
```
backend/
  app/
    main.py                # FastAPI app + 路由註冊
    api/
      notes.py             # POST /notes/stream (SSE)
      methodologies.py     # GET /methodologies
      health.py            # GET /healthz
    auth/
      middleware.py        # ID token 驗證 + aud + email allowlist
    agents/
      pipeline.py          # 組裝 SequentialAgent（依 methodology 動態建步驟）
      steps.py             # 各步 LlmAgent 的 instruction provider
      models.py            # provider→ADK model 物件（Gemini/LiteLlm）+ effort 對映
      tools.py             # web search 工具掛載（gemini native / litellm）
    store/
      firestore.py         # methodology/template 載入 + TTL 快取
    schemas/
      requests.py          # NoteRequest 等 Pydantic
      events.py            # SSE 事件 model + 序列化
    core/
      config.py            # pydantic-settings（env 載入；secret 經 --set-secrets 注入，見 §9）
      hygiene.py           # [[VAR]] context resolver
      logging.py           # 結構化 log（不含 secret/PII）
  tests/
    unit/                  # auth/store/schemas/hygiene/models
    agents/                # step 測試（mock model）
    bdd/                   # pytest-bdd 對接 spec/backend.feature
    eval/                  # adk eval 資料集 + LLM-as-judge
  Dockerfile
  pyproject.toml             # uv 專案定義（含 dependencies）
  uv.lock                    # uv 鎖定檔（鎖版本，取代 requirements.txt）
```

## 4. API Contract

### `POST /notes/stream`（SSE）
Request body（Pydantic）：
```yaml
NoteRequest:
  category:           # enum
    - article
    - book
    - podcast
    - youtube
    - coursera
  methodology_id: string          # 對應 Firestore methodologies doc id
  mode:               # enum，每個方法論都有兩個模式
    - concise         # 精簡
    - detailed        # 詳細
  direction: string               # 筆記方向（自由文字）
  extra_requirements: string|null # 額外需求（可空）
  provider:           # enum，default gemini
    - gemini
    - openai
    - claude
  model: string|null              # 不給則用 provider 預設
  web_search: bool                # default false
  content:
    title: string
    url: string
    text: string                  # 萃取內文/transcript，長度下限見驗證
    metadata: object|null         # 如 {duration, author, lang}
```
> 0.1.0 僅 `gemini` 實作；`openai`/`claude` 會回 `provider_not_implemented`。category enum 保留五類（後端契約相容）。

驗證：`content.text` 非空且長度 ≥ 門檻（如 200 字元，可設定）；`methodology_id` 必填；`category` 必須在 methodology 的 `categories` 內。

SSE 事件協定（**跨端契約**，與 [`extension-spec.md`](extension-spec.md) 一致）：
```yaml
events:
  step:       { step: string, status: "start"|"done", summary: string|null }
  delta:      { text: string }                    # 最終 format 步 token 增量
  citations:  { items: [ { title: string, url: string } ] }
  done:       { markdown: string }                # 最終完整 Markdown
  error:      { code: string, message: string }   # 帶 vendor 訊息
```
`step` 值：`structure | draft | augment | verify | format`（`collect` 為內部前處理，不發事件）。

### `GET /methodologies`
回傳下拉用清單：`[{ id, name, description, categories }]`。

### `GET /healthz`
liveness（不需認證）。

## 5. Orchestrator — 七步 pipeline（資料驅動）
步驟與 session state（ADK state key）：
```yaml
steps:
  collect:   # 程式前處理（非 LLM）：清洗、組 source；只有內容極大才截斷
    out: state.source
  structure: { llm: true, out: state.outline }    # 整理文字結構
  draft:     { llm: true, out: state.draft }       # 產生筆記草稿
  augment:   { llm: true, out: state.augmented }   # 思考補充（洞見/連結）
  verify:    { llm: true, out: state.verified }    # 查證：對照 source 標出無依據說法；web_search 時掛搜尋工具
  format:    { llm: true, out: stream }            # 整理結構→最終 Markdown（token 級串流）
```
- **方法論驅動差異**：每步的 `instruction` 從 Firestore methodology 的 `steps.<name>.instruction` 注入；`enabled:false` 的步驟跳過（pipeline 動態組裝）。
- **collect** 在程式層做（去雜訊、組 source），避免把超長 transcript 直接灌進 LLM（token 物理學）。截斷語意：只有內容極大（> `MAX_CONTENT_CHARS`，預設 600k 字元）才截斷頭尾保留，避免 1–2 小時課程被截。

## 6. Provider 層
> 0.1.0 僅實作 Gemini；OpenAI/Claude 延後（保留 LiteLlm 路徑設計於下，暫不實作）。
```yaml
providers:
  gemini:
    model_id: gemini-3.5-flash       # 再確認
    transport: Vertex AI global endpoint (ADC)
    web_search: native google_search tool
    effort_high: 對映 thinking / 最高 reasoning 設定
  openai:
    model_id: gpt-5.5                # 再確認
    transport: ADK LiteLlm → Responses API（key from Secret Manager）
    web_search: web_search tool（經 litellm 傳遞；需驗證支援，否則該 provider 暫關搜尋）
    effort_high: reasoning effort = high
  claude:
    model_id: opus 4.8               # 再確認
    transport: ADK LiteLlm → Messages API（key from Secret Manager）
    web_search: native web_search server tool（經 litellm；需驗證）
    effort_high: thinking budget = high
```
> **注意事項**：Gemini 的 `google_search` 在 ADK 為內建工具，最穩。OpenAI / Claude 經 LiteLlm 掛各家原生 web search 的支援度需於實作時驗證；若該路徑不支援，初版對該 provider 將 `web_search` 視為不可用並回傳 `step` summary 提示（優雅降級），不報錯中斷。

## 7. Firestore 資料模型
```yaml
methodologies/{id}:
  name: string
  description: string
  categories: [ article|book|podcast|youtube|coursera ]   # 適用類別
  steps:
    structure: { enabled: bool, instruction: Instruction }
    draft:     { enabled: bool, instruction: Instruction }
    augment:   { enabled: bool, instruction: Instruction }
    verify:    { enabled: bool, instruction: Instruction }
    format:    { enabled: bool, instruction: Instruction, output_contract: string }
  defaults: { web_search: bool }
  version: int

# Instruction：每步依 NoteRequest.mode（concise|detailed）選用對應指令文字。
# 單一字串視為兩模式共用（向後相容；不需為每步都拆分 concise/detailed）。
Instruction: string | { concise: string, detailed: string }

# format.output_contract 內含頂端 YAML frontmatter 規格（可直接貼進 Obsidian）：
#   title / type / source-type / author / url / status / tags / summary / created / updated
#   created / updated 用 {date} state 變數；title / url / author 由模型從 {source} 文字中擷取
#   （不可用 {title} / {url} 占位符，避免 ADK context-hygiene resolver 對未注入的變數 KeyError）。

prompt_templates/{id}:        # 共用 system prompt 片段（被 methodology 參照）
  name: string
  system: string              # 全域語氣 / 格式規範（如「輸出繁中 Markdown」）
  version: int
```
- 載入：請求時讀 methodology(+參照的 template)，in-memory TTL 快取（預設 300s，可設定）。
- 改方法論**不需重新部署**；快取過期自動生效。
- `prompt_templates/global-style` 文件：`system` 欄位內含全域風格規則（繁中/全形/盤古之白/英文專有名詞/標記語法 mark+callout/三積木法/品質自查），由 `run_pipeline` 讀出當作所有 `LlmAgent` 的 system 前綴；讀不到時 fallback 內建預設字串。
- 初始方法論（實際 4 份）：`youtube-deep-study`（categories=`[youtube]`，source-type `video`）、`blog-deep-study`（categories=`[article]`，source-type `article`）、`podcast-deep-study`（categories=`[article]`，source-type `podcast`）、`coursera-deep-study`（categories=`[coursera]`，source-type `course`），外加 `prompt_templates/global-style`。
  category 對映擷取器類別（youtube/article/coursera）；podcast 網頁由 article 擷取器產出，故 podcast 方法論 categories=`["article"]`，可在文章頁選用。

## 8. Auth & 認證流程
- Cloud Run 啟用**內建 IAP**（`--iap`，無 Load Balancer、無額外費用），保護 run.app URL。
- no-org 個人專案需一次性在 Console 建 **custom OAuth client**；授權使用者 Gmail `roles/iap.httpsResourceAccessor`。
- extension 程式化存取：用 custom OAuth client_id 經 `launchWebAuthFlow` 取 ID token（aud=該 client_id，且該 client 須加入 IAP 程式化存取允許清單 `programmatic_clients`；**Google 代管 client 不支援程式化**），帶 `Authorization: Bearer`。
- 後端：不自驗 token，改讀 IAP 注入的 `X-Goog-Authenticated-User-Email`（值形如 `accounts.google.com:<email>`，取 email），檢查 allowlist；缺 header→`401`、非白名單→`403`。
> ⚠️ 此 IAP↔extension 程式化路徑先以 spike 驗證（見 Phase B 計畫 Task 1），未驗證前保留既有 app 層 auth 為 fallback。

## 9. Config / Secrets
```yaml
env:
  GOOGLE_CLOUD_PROJECT: max-personal-447802
  GOOGLE_GENAI_USE_VERTEXAI: "TRUE"
  GOOGLE_CLOUD_LOCATION: global        # Gemini global endpoint
  ALLOWED_EMAILS: "maxwellchen1126@gmail.com"   # 逗號分隔
  CLOUD_RUN_SERVICE_URL: <deploy 後填>  # IAP 啟用後不再用於 audience 驗證；可移除或保留為參考
  METHODOLOGY_CACHE_TTL: "300"
```
- 0.1.0 不需 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` secrets（OpenAI/Claude 不實作，見 §1 鎖定決定）。
- `pydantic-settings` 載入 env；不直接呼叫 Secret Manager API（不需 `google-cloud-secret-manager` runtime 依賴，見 §11）。
- IAP 由部署旗標（`--iap`，見 §14）啟用，非 env 設定；custom OAuth client 於 GCP Console 管理（非 env）。
- Key **絕不**進 repo / log。Gemini 用 ADC，不放 key。

## 10. Guardrails（右尺寸個人版）
**採用**：
- email allowlist（單一信任使用者）。
- 金鑰 / 敏感值不進 repo / log（0.1.0 為 Gemini-only，無 vendor API key）；最小權限 service account（Vertex AI User、Firestore User）。OpenAI/Claude 啟用時才需 Secret Manager + Secret Accessor。
- Context hygiene：`core/hygiene.py` 的 `[[VAR]]` 佔位符解析（runtime override → env → 留白不靜默失敗），確保身分 / 敏感值不硬編進 prompt。
- Evaluation：`adk eval` + LLM-as-judge（0–5 分 + 容忍帶）抓行為漂移；單元測試抓決定性回歸。
- 版本鎖定、禁 YOLO（先確認結構與技術棧）。

**明確不採用（附理由）**：
- Hybrid Policy Server：單一信任使用者、無多角色，過度工程。
- HITL checkpoint：筆記生成無破壞性副作用（不寫外部系統）。
- 沙箱：後端不執行任意程式碼 / 不變更檔案系統。
- 知識圖譜 RAG：codebase 極小。

## 11. Versioned Dependencies（實作時逐一再確認）
- 套件管理：**uv**（`pyproject.toml` + `uv.lock`，取代 `requirements.txt`）。
```yaml
runtime: python 3.12
deps:
  google-adk: "~=2.3"          # 再確認
  fastapi: latest-stable
  uvicorn[standard]: latest-stable
  google-cloud-firestore: latest-stable
  google-auth: latest-stable
  litellm: latest-stable        # OpenAI/Claude 經 ADK LiteLlm（0.1.0 不實作 openai/claude，暫不納入 runtime）
  pydantic: ">=2"
  pydantic-settings: latest-stable
dev:
  pytest, pytest-asyncio, pytest-bdd
```
> `google-cloud-secret-manager` **不**作為 runtime 依賴：secrets 改由 Cloud Run `--set-secrets` 直接注入為 env var（見 §9、§14），應用程式經 `pydantic-settings` 讀 env，不在程式內呼叫 Secret Manager API。

## 12. Testing & Evaluation Strategy
- **Unit**：auth middleware（401/403）、Firestore loader + 快取、`NoteRequest` 驗證、SSE 事件序列化、provider→model 對映、`hygiene` resolver。
- **Agent step**：mock model client，驗證每步讀對 state key、instruction 注入正確、`enabled:false` 跳過。
- **BDD**：[`backend.feature`](backend.feature) 場景以 `pytest-bdd` 對接。
- **Eval**：`tests/eval/` 放每類別小資料集，`adk eval` 跑 LLM-as-judge（評筆記是否忠於原文、結構符合 `output_contract`、無幻覺）；容忍工具呼叫順序變異。
- 原則：**測試抓決定性回歸，eval 抓行為漂移**。

## 13. Behavior Scenarios
完整 Gherkin 場景見 [`backend.feature`](backend.feature)，涵蓋：happy path、查證附引用、auth 401/403、方法論不存在、內容過短、provider 失敗（保留部分內容）、provider 不支援 web search 的優雅降級。

## 14. 部署（asia-east1）
- 容器：`Dockerfile`（python 3.12-slim + uvicorn）。
- `gcloud run deploy take-note-backend --region asia-east1 --iap --timeout=3600 --max-instances=1 --concurrency=8 --service-account <sa> --set-env-vars ...`
- Cloud Run：min-instances 0（scale-to-zero）、request timeout 提高以容 SSE（`--timeout=3600`）、concurrency 視情況（`--concurrency=8`）。
- service account 權限：Vertex AI User、Firestore User（無 secret，故不需 Secret Accessor）；呼叫者授權改由 IAP 處理（非 Cloud Run Invoker IAM）。
- 啟用 API：run、aiplatform、firestore、iap、artifactregistry（0.1.0 無 secret，不需 secretmanager）。

## 15. Verification（驗收）
- `pytest` 全綠（unit + bdd）。
- 本地 `uvicorn` + ADC（`gcloud auth application-default login`）跑通 happy path（curl SSE）。
- `adk eval` 每類別 eval 分數達門檻。
- 部署後以帶 ID token 的 curl 對 Cloud Run 跑通一支真實 transcript。
