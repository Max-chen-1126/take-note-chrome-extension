# language: zh-TW
# 後端行為合約 — 對應 spec/backend-spec.md。以 pytest-bdd 對接。
功能: 從萃取內容生成結構化筆記

  背景:
    假設 後端以授權使用者的有效 Google ID token 呼叫
    並且 Firestore 存在 methodology "deep-study"（適用 youtube）

  場景: 成功生成 YouTube 筆記（happy path）
    假設 category 為 "youtube" 且 content.text 為有效 transcript
    並且 provider 為 "gemini" 且 web_search 為 false
    當 呼叫 POST /notes/stream
    那麼 依序收到 step 事件 structure→draft→augment→verify→format
    並且 在 format 步收到多個 delta 事件
    並且 最後收到 done 事件且 markdown 非空

  場景: 開啟查證上網附引用
    假設 provider 為 "gemini" 且 web_search 為 true
    當 呼叫 POST /notes/stream
    那麼 在 verify 後收到 citations 事件且 items 非空
    並且 done 的 markdown 含來源引用

  場景: 缺少或無效 token
    假設 請求未帶或帶無效 ID token
    當 呼叫 POST /notes/stream
    那麼 回應 401 且不啟動 pipeline

  場景: Email 不在 allowlist
    假設 token 有效但 email 不在 ALLOWED_EMAILS
    當 呼叫 POST /notes/stream
    那麼 回應 403

  場景: 方法論不存在
    假設 methodology_id 不存在於 Firestore
    當 呼叫 POST /notes/stream
    那麼 收到 error 事件且 code 為 "methodology_not_found"

  場景: 內容過短
    假設 content.text 短於門檻
    當 呼叫 POST /notes/stream
    那麼 回應 422 驗證錯誤

  場景: Provider 呼叫失敗
    假設 下游 LLM provider 回傳錯誤
    當 pipeline 執行中
    那麼 收到 error 事件且帶 vendor 訊息
    並且 已串出的部分內容被保留

  場景: 該 provider 不支援 web search
    假設 provider 為 "openai" 且該路徑不支援原生 web search
    並且 web_search 為 true
    當 呼叫 POST /notes/stream
    那麼 pipeline 不中斷
    並且 收到提示「該 provider 本次未啟用查證上網」的 step summary
