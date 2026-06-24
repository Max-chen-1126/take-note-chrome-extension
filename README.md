# Take-Note Chrome Extension

個人用的學習筆記工具。在 Blog / Book / Podcast 網頁、YouTube、Coursera 上，一鍵把內文或 transcript 萃取出來，交給 AI 以指定方法論整理成結構化 Markdown 筆記，逐步串流呈現並一鍵複製。

## 架構

```
┌──────────── Extension (TS / WXT / MV3) ────────────┐
│  Side Panel UI · Background SW · Content Scripts    │
│  (萃取 article / YouTube / Coursera · 串流呈現)      │
└───────────────────────┬─────────────────────────────┘
        POST /notes/stream (Google ID token, SSE)
                        ▼
┌──────────── Backend (Python / FastAPI / Cloud Run) ─┐
│  Auth · Sequential Agent Orchestrator               │
│  collect→structure→draft→augment→verify→format→final│
│  Provider adapter (Gemini / OpenAI / Claude)        │
│  Firestore (prompt_templates, methodologies)        │
└──────────────────────────────────────────────────────┘
```

- **Extension** 負責萃取 + UI + 串流呈現（transcript 在瀏覽器端取得，繞過雲端 IP 封鎖與登入牆）。
- **Backend** 負責認證 + 多步驟 agent 整理 + SSE 串流，**不碰 YouTube / Coursera**。

詳見 [`spec/extension-spec.md`](spec/extension-spec.md) 與 [`spec/backend-spec.md`](spec/backend-spec.md)。工作準則見 [`AGENTS.md`](AGENTS.md)。

## 前置需求
- Node.js（前端 / WXT）
- Python 3.11+（後端）
- Google Cloud 專案：Cloud Run、Firestore、Secret Manager、Vertex AI
- LLM 存取：Gemini（Vertex + ADC）、OpenAI API key、Anthropic API key

## 開發

### Extension
```
cd extension
npm install
npm run dev        # WXT 開發模式
```
在 Brave / Chrome 載入未封裝的 dev build；於學習頁面打開 Side Panel 測試。

### Backend（本地）
```
cd backend
# 本地 ADC（Gemini 用）
gcloud auth application-default login
# 設定 OpenAI / Anthropic key（本地用環境變數；雲端用 Secret Manager）
uvicorn app.main:app --reload
```
將 extension 指向 `http://localhost:...` 進行端到端測試。

## 部署（Cloud Run）
- 後端容器化後部署到 Cloud Run（scale-to-zero）。
- Cloud Run 設為**需要認證**；extension 帶 Google ID token 呼叫。
- Gemini 走 Cloud Run service account 的 ADC；OpenAI / Anthropic key 從 Secret Manager 載入。

## 環境 / Secrets
| 項目 | 來源 |
|---|---|
| Gemini | Vertex AI + ADC（service account，不放 key） |
| OpenAI key | Secret Manager |
| Anthropic key | Secret Manager |
| Email allowlist | 後端設定 |

Key 絕不進 repo、絕不寫進 log。

## 新增一個筆記方法論 (methodology)
方法論存在 Firestore `methodologies` collection，改它**不需重新部署**：
1. 新增一份文件，含：`name`、適用 `categories`、步驟定義（哪些步驟跑、每步 prompt 片段、輸出契約）。
2. 前端方法論下拉會從後端取得清單，自動出現。

## 測試
- Extension：extractor 對存檔 HTML fixtures 的單元測試。
- Backend：orchestrator（mock adapter）、adapter contract、SSE 端點、Firestore emulator template loader。
- E2E：本地後端 + extension 指向 localhost，實測一支 YouTube / Coursera / blog 頁。

## 範圍外 (Out of Scope)
STT / 音訊轉錄、伺服器端筆記儲存、多使用者、YT/Coursera 以外的專屬解析。
