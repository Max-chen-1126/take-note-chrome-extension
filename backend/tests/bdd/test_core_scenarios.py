"""pytest-bdd glue：對接 spec/backend.feature 的核心場景（Phase A）。

只綁定 5 個核心場景（happy path / 401 / 403 / methodology_not_found / 422），
其餘場景（citations 查證、provider 失敗保留前段、web search 降級）留給 Phase B
（見 task-11-brief.md Phase B 第 4 點）。

`spec/backend.feature` 開頭有 `# language: zh-TW`，pytest-bdd 8.x 底層用
gherkin-official 解析，會把 假設/當/那麼/並且 正確對應成 given/when/then，
不需要額外設定；直接用繁體中文 step 文字當 `@given/@when/@then` 的字串即可。
"""

from pathlib import Path
from types import SimpleNamespace as N

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenario, then, when

import app.api.notes as notes
import app.auth.middleware as mw
import app.core.config as cfg
from app.main import app

# 用絕對路徑：pytest-bdd 對相對路徑是相對 pytest 執行時的 cwd/rootdir 解析，
# 不是相對本檔案，直接給絕對路徑最穩。
FEATURE = str(Path(__file__).resolve().parents[2] / ".." / "spec" / "backend.feature")

_VALID_METHODOLOGY = {
    "categories": ["youtube"],
    "steps": {
        s: {"enabled": True, "instruction": {"concise": s, "detailed": s}}
        for s in ["structure", "draft", "augment", "verify", "format"]
    },
}


def _note_request_payload(**overrides) -> dict:
    payload = {
        "category": "youtube",
        "methodology_id": "deep-study",
        "mode": "concise",
        "content": {"text": "x" * 300},
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def ctx(monkeypatch):
    """場景間共享狀態（request payload / headers / 收到的回應）。

    這裡先設好「全部正常」的預設值（有效 token、email 在 allowlist、
    methodology 存在）；個別場景的 @given 再用同一個 monkeypatch 覆寫
    其中一項，因為 ctx 一定先於後續 @given 執行，覆寫不會被蓋回去
    （與 client fixture 不同：client 只在 @when 第一次被請求時才建立，
    若把預設值放在 client 裡會在 @given 之後執行、蓋掉場景的覆寫）。
    """
    monkeypatch.setenv("ALLOWED_EMAILS", "owner@example.com")
    cfg.get_settings.cache_clear()
    monkeypatch.setattr(
        mw.id_token, "verify_oauth2_token",
        lambda *a, **k: {"email": "owner@example.com"},
    )
    monkeypatch.setattr(notes, "get_methodology", lambda _id: dict(_VALID_METHODOLOGY))
    yield {
        "payload": _note_request_payload(),
        "headers": {"Authorization": "Bearer valid-token"},
    }
    cfg.get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# 背景（Background）共用 step：兩條 given 對所有場景都成立，這裡用 no-op 滿足
# pytest-bdd 的 step 比對（實際行為由各場景自己的 fixture / monkeypatch 驅動）。
# ---------------------------------------------------------------------------


@given("後端以授權使用者的有效 Google ID token 呼叫")
def _background_valid_caller():
    pass


@given(parsers.parse('Firestore 存在 methodology "{mid}"（適用 youtube）'))
def _background_methodology_exists(mid):
    assert mid == "deep-study"


# ---------------------------------------------------------------------------
# 場景 1：成功生成 YouTube 筆記（happy path）
# ---------------------------------------------------------------------------


@scenario(FEATURE, "成功生成 YouTube 筆記（happy path）")
def test_happy_path():
    pass


@given(parsers.parse('category 為 "{category}" 且 content.text 為有效 transcript'))
def _given_category_and_valid_transcript(ctx, category):
    ctx["payload"]["category"] = category
    ctx["payload"]["content"] = {"text": "這是一段有效的 transcript 內容。" * 20}


@given(parsers.parse('provider 為 "{provider}" 且 web_search 為 {flag}'))
def _given_provider_and_web_search(ctx, provider, flag):
    ctx["payload"]["provider"] = provider
    ctx["payload"]["web_search"] = flag == "true"


async def _fake_adk_events_happy_path():
    for s in ["structure", "draft", "augment", "verify"]:
        yield N(author=f"step_{s}", partial=False, content=N(parts=[N(text="ok")]),
                grounding_metadata=None, is_final_response=lambda: False)
    for tok in ["# 標題", "\n內容"]:
        yield N(author="step_format", partial=True, content=N(parts=[N(text=tok)]),
                grounding_metadata=None, is_final_response=lambda: False)
    yield N(author="step_format", partial=False,
            content=N(parts=[N(text="# 標題\n內容")]),
            grounding_metadata=None, is_final_response=lambda: True)


@when("呼叫 POST /notes/stream", target_fixture="response")
def _call_notes_stream(ctx, client, monkeypatch):
    def fake_drive_adk(*_args, **_kwargs):
        return _fake_adk_events_happy_path()

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    resp = client.post("/notes/stream", json=ctx["payload"], headers=ctx["headers"])
    ctx["response"] = resp
    return resp


@then("依序收到 step 事件 structure→draft→augment→verify→format")
def _then_step_order(response):
    body = response.text
    order = ["structure", "draft", "augment", "verify", "format"]
    positions = [body.index(f'"step": "{name}"') for name in order]
    assert positions == sorted(positions)


@then("在 format 步收到多個 delta 事件")
def _then_multiple_delta_events(response):
    assert response.text.count("event: delta") >= 2


@then("最後收到 done 事件且 markdown 非空")
def _then_done_with_markdown(response):
    body = response.text
    assert "event: done" in body
    assert body.rindex("event: done") > body.rindex("event: step")
    assert '"markdown": ""' not in body.split("event: done", 1)[1]


# ---------------------------------------------------------------------------
# 場景：缺少或無效 token
# ---------------------------------------------------------------------------


@scenario(FEATURE, "缺少或無效 token")
def test_missing_or_invalid_token():
    pass


@given("請求未帶或帶無效 ID token", target_fixture="ctx")
def _given_invalid_token(ctx, monkeypatch):
    # 帶一個 Authorization header，但驗證一律失敗 → 模擬「帶無效 token」分支；
    # 「未帶」分支由 verify_request 本身對缺 header 回 401 覆蓋（單元測試已覆蓋）。
    monkeypatch.setattr(
        mw.id_token, "verify_oauth2_token",
        lambda *a, **k: (_ for _ in ()).throw(ValueError("invalid token")),
    )
    ctx["headers"] = {"Authorization": "Bearer invalid-token"}
    return ctx


@then("回應 401 且不啟動 pipeline")
def _then_401_no_pipeline(response):
    assert response.status_code == 401
    assert "event: step" not in response.text


# ---------------------------------------------------------------------------
# 場景：Email 不在 allowlist
# ---------------------------------------------------------------------------


@scenario(FEATURE, "Email 不在 allowlist")
def test_email_not_allowlisted():
    pass


@given("token 有效但 email 不在 ALLOWED_EMAILS", target_fixture="ctx")
def _given_email_not_allowlisted(ctx, monkeypatch):
    monkeypatch.setattr(
        mw.id_token, "verify_oauth2_token",
        lambda *a, **k: {"email": "outsider@example.com"},
    )
    return ctx


@then("回應 403")
def _then_403(response):
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 場景：方法論不存在
# ---------------------------------------------------------------------------


@scenario(FEATURE, "方法論不存在")
def test_methodology_not_found():
    pass


@given("methodology_id 不存在於 Firestore", target_fixture="ctx")
def _given_methodology_missing(ctx, monkeypatch):
    monkeypatch.setattr(notes, "get_methodology", lambda _id: None)
    ctx["payload"]["methodology_id"] = "does-not-exist"
    return ctx


@then(parsers.parse('收到 error 事件且 code 為 "{code}"'))
def _then_error_event_with_code(response, code):
    assert response.status_code == 200
    assert f'"code": "{code}"' in response.text


# ---------------------------------------------------------------------------
# 場景：內容過短
# ---------------------------------------------------------------------------


@scenario(FEATURE, "內容過短")
def test_content_too_short():
    pass


@given("content.text 短於門檻", target_fixture="ctx")
def _given_content_too_short(ctx):
    min_chars = cfg.get_settings().min_content_chars
    ctx["payload"]["content"] = {"text": "x" * max(min_chars - 1, 0)}
    return ctx


@then("回應 422 驗證錯誤")
def _then_422(response):
    assert response.status_code == 422
