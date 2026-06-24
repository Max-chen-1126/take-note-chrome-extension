# Backend Implementation Plan — Take-Note Chrome Extension

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作 take-note 後端：FastAPI + Google ADK 的多步驟筆記 agent，經 SSE 串回，部署到 Cloud Run（asia-east1）。

**Architecture:** 自訂 FastAPI 服務承載 ADK `SequentialAgent`（collect→structure→draft→augment→verify→format）。方法論由 Firestore 驅動、每個方法論含 concise/detailed 雙模式。**Phase A 只接 Gemini**（Vertex global endpoint，ADC）；OpenAI/Claude（ADK LiteLlm）列為 Phase B。認證用 Google ID token + email allowlist。

**Tech Stack:** Python 3.12、uv、FastAPI、uvicorn、google-adk 2.x、google-cloud-firestore、google-auth、pydantic v2/pydantic-settings、pytest/pytest-asyncio/pytest-bdd。（litellm 留待 Phase B 接 OpenAI/Claude）

## Phased 範圍
- **Phase A（現在做）**：Gemini + ADK，跑通 happy path（含本地真實 Gemini smoke）。Task 1–11A。
- **Phase B（之後做）**：OpenAI/Claude provider、非 Gemini 的 web search、完整 BDD 場景、adk eval、部署。見文末「Phase B — 後續待完成」。

**Spec 來源（真理來源）：** `spec/backend-spec.md` + `spec/backend.feature`。本計畫實作該 spec。

## Context
brainstorming → spec 已完成並核准。本輪將後端 spec 拆成可執行的 TDD 任務。三項本輪 spec 調整一併落實：
1. **uv** 管理 Python 環境（取代 requirements.txt）。
2. **截斷門檻調大**：只有「特大」內容才截斷，1–2 小時課程 transcript 不可被截（`MAX_CONTENT_CHARS` 預設 600,000 字元）。
3. **雙模式**：每個方法論都有 `concise`（精簡）與 `detailed`（詳細）；`NoteRequest.mode` 選擇，方法論 step instruction 以 mode 為 key。

> spec/backend-spec.md 的 §4 已加入 `mode`。本計畫 Task 1 會補完剩餘兩處 spec 編輯（§5 截斷語意、§7 per-mode instruction schema、§3/§11 改 uv）。

## Global Constraints
- Python `>=3.12`；用 `uv`（`uv add` / `uv run` / `uv sync`），不用 pip/requirements.txt。
- GCP project `max-personal-447802`；Cloud Run 區域 `asia-east1`。
- Gemini 走 Vertex AI **global endpoint**（env `GOOGLE_GENAI_USE_VERTEXAI=TRUE`、`GOOGLE_CLOUD_LOCATION=global`），ADC 認證，不放 key。
- Phase A 不需 OpenAI/Claude key（不接這兩家）；Gemini 走 ADC，無 key。
- Model id（Phase A）：`gemini-3.5-flash`（**實作時對官方文件再三確認確切 id**，鎖進 `app/agents/models.py` 常數）。OpenAI/Claude id 留 Phase B。
- SSE 事件契約（跨端）：`step` / `delta` / `citations` / `done` / `error`，與 `spec/extension-spec.md` 一致，不得單方面更動。
- `MAX_CONTENT_CHARS=600000`、`MIN_CONTENT_CHARS=200`、`METHODOLOGY_CACHE_TTL=300`（皆可由 env 覆寫）。
- 護欄右尺寸：email allowlist、context-hygiene 佔位符、eval；不做 Policy Server/HITL/沙箱。

## File Structure
```
backend/
  pyproject.toml            # uv 專案 + 依賴
  uv.lock
  Dockerfile
  .env.example
  app/
    main.py                 # FastAPI app + router 註冊
    api/health.py           # GET /healthz
    api/methodologies.py    # GET /methodologies
    api/notes.py            # POST /notes/stream (SSE)；ADK Runner→SSE 正規化
    auth/middleware.py      # verify_request：ID token + aud + allowlist → 401/403
    core/config.py          # Settings（pydantic-settings）
    core/hygiene.py         # [[VAR]] 佔位符解析
    schemas/requests.py     # Category/Mode/Provider/Content/NoteRequest
    schemas/events.py       # sse() 序列化 + 事件 helper
    store/firestore.py      # methodology/template 載入 + TTL 快取；list
    agents/collect.py       # build_source：清洗 + 大門檻截斷
    agents/models.py        # provider→ADK model + effort=High 對映
    agents/tools.py         # web_search 工具掛載
    agents/pipeline.py      # build_pipeline：依 methodology+mode 動態組 SequentialAgent
  tests/
    unit/                   # config/schemas/hygiene/auth/collect/models/firestore
    agents/                 # pipeline 組裝測試
    api/                    # notes SSE 端點測試（mock runner/model）
    bdd/                    # pytest-bdd 對接 ../../spec/backend.feature
    eval/                   # adk eval 資料集（scaffold）
```

---

### Task 1: 專案 scaffold（uv）+ healthz + spec 補完

**Files:**
- Create: `backend/pyproject.toml`, `backend/.env.example`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/api/health.py`, `backend/tests/unit/test_health.py`
- Modify (spec 補完): `spec/backend-spec.md`（§3 結構改 uv、§5 截斷語意、§7 per-mode instruction、§11 deps 改 uv）

**Interfaces:**
- Produces: `app.main:app`（FastAPI app）；`GET /healthz` → `{"status":"ok"}`

- [ ] **Step 1: 補完 spec（先改真理來源）**
  - `spec/backend-spec.md` §5：把 collect 說明改為「只有內容極大（> `MAX_CONTENT_CHARS`，預設 600k 字元）才截斷頭尾保留，避免 1–2 小時課程被截」。
  - §7 methodology schema：每個 step 的 `instruction` 改為 `{ concise: string, detailed: string }`（單一字串視為兩模式共用）；新增 `mode` 說明。
  - §3 結構與 §11 依賴：requirements.txt → `pyproject.toml` + `uv.lock`；移除 runtime 的 `google-cloud-secret-manager`（改用 Cloud Run `--set-secrets` 注入 env）。

- [ ] **Step 2: 初始化 uv 專案**

Run:
```bash
cd backend && uv init --no-readme --python 3.12
uv add fastapi "uvicorn[standard]" "google-adk~=2.3" google-cloud-firestore google-auth "pydantic>=2" pydantic-settings
uv add --dev pytest pytest-asyncio pytest-bdd httpx
```
> 注意：`google-adk` 版本實作時對 PyPI 再三確認，鎖進 `pyproject.toml`。

- [ ] **Step 3: 寫失敗測試** — `backend/tests/unit/test_health.py`
```python
from fastapi.testclient import TestClient
from app.main import app

def test_healthz():
    r = TestClient(app).get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 4: 跑測試確認失敗** — `uv run pytest tests/unit/test_health.py -v`（Expected: ImportError/FAIL）

- [ ] **Step 5: 實作** — `backend/app/api/health.py`
```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/healthz")
def healthz():
    return {"status": "ok"}
```
`backend/app/main.py`
```python
from fastapi import FastAPI
from app.api import health

app = FastAPI(title="take-note-backend")
app.include_router(health.router)
```
`backend/.env.example`
```
GOOGLE_CLOUD_PROJECT=max-personal-447802
GOOGLE_GENAI_USE_VERTEXAI=TRUE
GOOGLE_CLOUD_LOCATION=global
ALLOWED_EMAILS=maxwellchen1126@gmail.com
CLOUD_RUN_SERVICE_URL=
METHODOLOGY_CACHE_TTL=300
MAX_CONTENT_CHARS=600000
MIN_CONTENT_CHARS=200
# OPENAI_API_KEY / ANTHROPIC_API_KEY 留待 Phase B
```

- [ ] **Step 6: 跑測試確認通過** — `uv run pytest tests/unit/test_health.py -v`（Expected: PASS）

- [ ] **Step 7: Commit**
```bash
git add backend spec/backend-spec.md
git commit -m "feat(backend): scaffold uv project + /healthz; finalize backend spec

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Settings（pydantic-settings）

**Files:** Create `backend/app/core/__init__.py`, `backend/app/core/config.py`, `backend/tests/unit/test_config.py`

**Interfaces:**
- Produces: `get_settings() -> Settings`；欄位 `google_cloud_project, google_cloud_location, allowed_emails, cloud_run_service_url, methodology_cache_ttl:int, max_content_chars:int, min_content_chars:int`；property `allowed_email_set: set[str]`（OpenAI/Claude key 欄位於 Phase B 再加）

- [ ] **Step 1: 失敗測試** — `tests/unit/test_config.py`
```python
import app.core.config as cfg

def test_allowed_email_set(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "a@x.com, b@y.com")
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().allowed_email_set == {"a@x.com", "b@y.com"}

def test_defaults(monkeypatch):
    monkeypatch.delenv("MAX_CONTENT_CHARS", raising=False)
    cfg.get_settings.cache_clear()
    assert cfg.get_settings().max_content_chars == 600000
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_config.py -v`

- [ ] **Step 3: 實作** — `app/core/config.py`
```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    google_cloud_project: str = "max-personal-447802"
    google_cloud_location: str = "global"
    google_genai_use_vertexai: bool = True
    allowed_emails: str = ""
    cloud_run_service_url: str = ""
    methodology_cache_ttl: int = 300
    max_content_chars: int = 600000
    min_content_chars: int = 200

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip() for e in self.allowed_emails.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_config.py -v`
- [ ] **Step 5: Commit**

---

### Task 3: 請求/事件 schemas

**Files:** Create `backend/app/schemas/__init__.py`, `backend/app/schemas/requests.py`, `backend/app/schemas/events.py`, `backend/tests/unit/test_schemas.py`

**Interfaces:**
- Produces: enums `Category{article,book,podcast,youtube,coursera}`, `Mode{concise,detailed}`, `Provider{gemini,openai,claude}`；`Content{title:str,url:str,text:str,metadata:dict|None}`；`NoteRequest{category,methodology_id:str,mode:Mode,direction:str,extra_requirements:str|None,provider:Provider=gemini,model:str|None,web_search:bool=False,content:Content}`；`sse(event:str,data:dict)->str`

- [ ] **Step 1: 失敗測試** — `tests/unit/test_schemas.py`
```python
import json
from app.schemas.requests import NoteRequest, Mode, Provider
from app.schemas.events import sse

def test_note_request_defaults():
    r = NoteRequest(category="youtube", methodology_id="m1", mode="concise",
                    content={"text": "x" * 300})
    assert r.provider is Provider.gemini
    assert r.web_search is False
    assert r.mode is Mode.concise

def test_sse_format():
    out = sse("delta", {"text": "嗨"})
    assert out == 'event: delta\ndata: {"text": "嗨"}\n\n'
    assert json.loads(out.split("data: ", 1)[1].strip()) == {"text": "嗨"}
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_schemas.py -v`

- [ ] **Step 3: 實作** — `app/schemas/requests.py`
```python
from enum import Enum
from pydantic import BaseModel


class Category(str, Enum):
    article = "article"; book = "book"; podcast = "podcast"
    youtube = "youtube"; coursera = "coursera"


class Mode(str, Enum):
    concise = "concise"
    detailed = "detailed"


class Provider(str, Enum):
    gemini = "gemini"; openai = "openai"; claude = "claude"


class Content(BaseModel):
    title: str = ""
    url: str = ""
    text: str
    metadata: dict | None = None


class NoteRequest(BaseModel):
    category: Category
    methodology_id: str
    mode: Mode
    direction: str = ""
    extra_requirements: str | None = None
    provider: Provider = Provider.gemini
    model: str | None = None
    web_search: bool = False
    content: Content
```
`app/schemas/events.py`
```python
import json


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
```

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_schemas.py -v`
- [ ] **Step 5: Commit**

---

### Task 4: Context-hygiene 佔位符解析

**Files:** Create `backend/app/core/hygiene.py`, `backend/tests/unit/test_hygiene.py`

**Interfaces:**
- Produces: `resolve(text:str, overrides:dict[str,str]|None=None)->str`（`[[VAR]]`：override → env → 留白）

- [ ] **Step 1: 失敗測試** — `tests/unit/test_hygiene.py`
```python
from app.core.hygiene import resolve

def test_override_wins(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    assert resolve("a [[FOO]] b", {"FOO": "ov"}) == "a ov b"

def test_env_then_blank(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    monkeypatch.delenv("BAR", raising=False)
    assert resolve("[[FOO]]/[[BAR]]") == "envval/"
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_hygiene.py -v`

- [ ] **Step 3: 實作** — `app/core/hygiene.py`
```python
import os
import re

_PATTERN = re.compile(r"\[\[([A-Z0-9_]+)\]\]")


def resolve(text: str, overrides: dict[str, str] | None = None) -> str:
    overrides = overrides or {}

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key in overrides:
            return overrides[key]
        return os.environ.get(key, "")

    return _PATTERN.sub(_sub, text)
```

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_hygiene.py -v`
- [ ] **Step 5: Commit**

---

### Task 5: Auth middleware（ID token + aud + allowlist）

**Files:** Create `backend/app/auth/__init__.py`, `backend/app/auth/middleware.py`, `backend/tests/unit/test_auth.py`

**Interfaces:**
- Produces: `verify_request(request: fastapi.Request) -> str`（回 email；FastAPI dependency；401 缺/壞 token、403 email 不在 allowlist）

- [ ] **Step 1: 失敗測試** — `tests/unit/test_auth.py`
```python
import pytest
from fastapi import HTTPException
from starlette.requests import Request
import app.auth.middleware as mw
import app.core.config as cfg


def _req(headers: dict) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw})


def test_missing_token():
    with pytest.raises(HTTPException) as e:
        mw.verify_request(_req({}))
    assert e.value.status_code == 401


def test_email_not_allowlisted(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    monkeypatch.setattr(mw.id_token, "verify_oauth2_token",
                        lambda *a, **k: {"email": "bad@x.com"})
    with pytest.raises(HTTPException) as e:
        mw.verify_request(_req({"Authorization": "Bearer t"}))
    assert e.value.status_code == 403


def test_ok(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "ok@x.com")
    cfg.get_settings.cache_clear()
    monkeypatch.setattr(mw.id_token, "verify_oauth2_token",
                        lambda *a, **k: {"email": "ok@x.com"})
    assert mw.verify_request(_req({"Authorization": "Bearer t"})) == "ok@x.com"
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_auth.py -v`

- [ ] **Step 3: 實作** — `app/auth/middleware.py`
```python
from fastapi import HTTPException, Request
from google.auth.transport import requests as ga_requests
from google.oauth2 import id_token

from app.core.config import get_settings

_transport = ga_requests.Request()


def verify_request(request: Request) -> str:
    settings = get_settings()
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = auth.split(" ", 1)[1]
    try:
        claims = id_token.verify_oauth2_token(
            token, _transport, audience=settings.cloud_run_service_url or None
        )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")
    email = claims.get("email")
    if not email or email not in settings.allowed_email_set:
        raise HTTPException(status_code=403, detail="forbidden")
    return email
```

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_auth.py -v`
- [ ] **Step 5: Commit**

---

### Task 6: Firestore loader + TTL 快取 + GET /methodologies

**Files:** Create `backend/app/store/__init__.py`, `backend/app/store/firestore.py`, `backend/app/api/methodologies.py`, `backend/tests/unit/test_store.py`；Modify `backend/app/main.py`

**Interfaces:**
- Produces: `get_methodology(mid:str)->dict|None`（TTL 快取）；`list_methodologies()->list[dict]`（`{id,name,description,categories}`）；`clear_cache()`；module-level `client_factory`（可 monkeypatch）。`GET /methodologies`。

- [ ] **Step 1: 失敗測試** — `tests/unit/test_store.py`
```python
import app.store.firestore as store


class _Doc:
    def __init__(self, exists, data, _id="m1"):
        self.exists, self._data, self.id = exists, data, _id
    def to_dict(self):
        return self._data


class _Coll:
    def __init__(self, doc):
        self._doc = doc
    def document(self, _id):
        return self
    def get(self):
        return self._doc
    def stream(self):
        return [self._doc] if self._doc.exists else []


class _Client:
    def __init__(self, doc):
        self._doc = doc
    def collection(self, _name):
        return _Coll(self._doc)


def test_get_methodology_hit_and_miss(monkeypatch):
    store.clear_cache()
    doc = _Doc(True, {"name": "Deep", "categories": ["youtube"]})
    monkeypatch.setattr(store, "client_factory", lambda: _Client(doc))
    assert store.get_methodology("m1")["name"] == "Deep"
    # second call served from cache even if client breaks
    monkeypatch.setattr(store, "client_factory", lambda: (_ for _ in ()).throw(RuntimeError))
    assert store.get_methodology("m1")["name"] == "Deep"


def test_get_methodology_missing(monkeypatch):
    store.clear_cache()
    monkeypatch.setattr(store, "client_factory", lambda: _Client(_Doc(False, None)))
    assert store.get_methodology("nope") is None
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_store.py -v`

- [ ] **Step 3: 實作** — `app/store/firestore.py`
```python
import time

from google.cloud import firestore

from app.core.config import get_settings

_cache: dict[str, tuple[float, dict]] = {}


def client_factory() -> firestore.Client:
    return firestore.Client(project=get_settings().google_cloud_project)


def clear_cache() -> None:
    _cache.clear()


def get_methodology(mid: str) -> dict | None:
    ttl = get_settings().methodology_cache_ttl
    now = time.time()
    hit = _cache.get(mid)
    if hit and now - hit[0] < ttl:
        return hit[1]
    doc = client_factory().collection("methodologies").document(mid).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    _cache[mid] = (now, data)
    return data


def list_methodologies() -> list[dict]:
    out = []
    for d in client_factory().collection("methodologies").stream():
        data = d.to_dict() or {}
        out.append({
            "id": d.id,
            "name": data.get("name"),
            "description": data.get("description"),
            "categories": data.get("categories", []),
        })
    return out
```
`app/api/methodologies.py`
```python
from fastapi import APIRouter, Depends

from app.auth.middleware import verify_request
from app.store.firestore import list_methodologies

router = APIRouter()


@router.get("/methodologies")
def methodologies(_email: str = Depends(verify_request)):
    return list_methodologies()
```
Modify `app/main.py`：`from app.api import health, methodologies` 並 `app.include_router(methodologies.router)`。

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_store.py -v`
- [ ] **Step 5: Commit**

---

### Task 7: Collect 前處理（大門檻截斷）

**Files:** Create `backend/app/agents/__init__.py`, `backend/app/agents/collect.py`, `backend/tests/unit/test_collect.py`

**Interfaces:**
- Consumes: `app.schemas.requests.Content`
- Produces: `build_source(content: Content) -> str`（標題/URL + 內文；僅當 `len(text) > MAX_CONTENT_CHARS` 才截頭尾）

- [ ] **Step 1: 失敗測試** — `tests/unit/test_collect.py`
```python
import app.core.config as cfg
from app.agents.collect import build_source
from app.schemas.requests import Content


def test_no_truncation_for_long_lecture(monkeypatch):
    monkeypatch.setenv("MAX_CONTENT_CHARS", "600000")
    cfg.get_settings.cache_clear()
    text = "字" * 200000          # ~2hr 課程，遠低於門檻
    out = build_source(Content(title="T", url="u", text=text))
    assert "省略" not in out
    assert text in out


def test_truncates_only_when_extreme(monkeypatch):
    monkeypatch.setenv("MAX_CONTENT_CHARS", "1000")
    cfg.get_settings.cache_clear()
    out = build_source(Content(text="a" * 5000))
    assert "省略" in out
    assert len(out) < 5000
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_collect.py -v`

- [ ] **Step 3: 實作** — `app/agents/collect.py`
```python
from app.core.config import get_settings
from app.schemas.requests import Content

_OMITTED = "\n\n...[內容過長，中段已省略]...\n\n"


def build_source(content: Content) -> str:
    text = content.text.strip()
    cap = get_settings().max_content_chars
    if len(text) > cap:
        head = int(cap * 0.7)
        tail = cap - head
        text = text[:head] + _OMITTED + text[-tail:]
    parts = []
    if content.title:
        parts.append(f"# {content.title}")
    if content.url:
        parts.append(f"來源: {content.url}")
    parts.append(text)
    return "\n\n".join(parts)
```

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_collect.py -v`
- [ ] **Step 5: Commit**

---

### Task 8: Gemini model 對映（effort=High）+ web search 工具

> Phase A：只接 Gemini。`build_model` 對非 Gemini provider 拋 `ProviderNotImplemented`（Task 10 映成 error 事件）。OpenAI/Claude 於 Phase B 補。

**Files:** Create `backend/app/agents/models.py`, `backend/app/agents/tools.py`, `backend/tests/unit/test_models.py`

**Interfaces:**
- Consumes: `Provider`
- Produces: `DEFAULT_MODELS: dict[Provider,str]`（Phase A 僅 gemini）；`class ProviderNotImplemented(Exception)`；`build_model(provider, model_id:str|None) -> str`；`generate_config(provider) -> dict`（effort=High）；`web_search_tools(provider, enabled:bool) -> list`

- [ ] **Step 1: 失敗測試** — `tests/unit/test_models.py`
```python
import pytest
from app.agents.models import build_model, DEFAULT_MODELS, ProviderNotImplemented
from app.agents.tools import web_search_tools
from app.schemas.requests import Provider


def test_gemini_returns_plain_string():
    assert build_model(Provider.gemini, None) == DEFAULT_MODELS[Provider.gemini]


def test_non_gemini_not_implemented():
    with pytest.raises(ProviderNotImplemented):
        build_model(Provider.openai, None)


def test_web_search_only_gemini():
    assert web_search_tools(Provider.gemini, True)        # non-empty
    assert web_search_tools(Provider.openai, True) == []  # Phase B 才支援
    assert web_search_tools(Provider.gemini, False) == []
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/unit/test_models.py -v`

- [ ] **Step 3: 實作** — `app/agents/models.py`
```python
from app.schemas.requests import Provider


class ProviderNotImplemented(Exception):
    pass


# ⚠️ 實作時對官方文件再三確認確切 model id
DEFAULT_MODELS: dict[Provider, str] = {
    Provider.gemini: "gemini-3.5-flash",
}


def build_model(provider: Provider, model_id: str | None) -> str:
    if provider is not Provider.gemini:
        raise ProviderNotImplemented(provider.value)
    return model_id or DEFAULT_MODELS[Provider.gemini]  # ADK 原生 Gemini，走 Vertex（env 決定）


def generate_config(provider: Provider) -> dict:
    """effort=High 對映。⚠️ 參數名實作時對 ADK/Gemini 文件確認。"""
    if provider is Provider.gemini:
        return {"thinking_config": {"thinking_budget": -1}}  # -1 = 動態最高
    return {}
```
`app/agents/tools.py`
```python
from app.schemas.requests import Provider


def web_search_tools(provider: Provider, enabled: bool) -> list:
    if not enabled:
        return []
    if provider is Provider.gemini:
        from google.adk.tools import google_search
        return [google_search]
    return []  # 非 Gemini 的 web search：Phase B
```

- [ ] **Step 4: 確認通過** — `uv run pytest tests/unit/test_models.py -v`
- [ ] **Step 5: Commit**

---

### Task 9: Pipeline 組裝（資料驅動 + 雙模式）

**Files:** Create `backend/app/agents/pipeline.py`, `backend/tests/agents/test_pipeline.py`

**Interfaces:**
- Consumes: `build_model`, `web_search_tools`, `generate_config`
- Produces: 常數 `STEP_ORDER=["structure","draft","augment","verify","format"]`、`STEP_OUTPUT_KEY`；`build_pipeline(methodology:dict, mode:str, provider:Provider, model_id:str|None, web_search:bool, system:str) -> SequentialAgent`（跳過 `enabled:false`；`verify` 步掛 web search；instruction 依 mode 取）

- [ ] **Step 1: 失敗測試** — `tests/agents/test_pipeline.py`
```python
from app.agents.pipeline import build_pipeline, STEP_ORDER
from app.schemas.requests import Provider


def _methodology(disabled=()):
    steps = {}
    for s in STEP_ORDER:
        steps[s] = {
            "enabled": s not in disabled,
            "instruction": {"concise": f"{s}-c", "detailed": f"{s}-d"},
        }
    return {"name": "M", "categories": ["youtube"], "steps": steps}


def test_builds_all_steps_concise():
    agent = build_pipeline(_methodology(), "concise", Provider.gemini, None, False, "SYS")
    assert [a.name for a in agent.sub_agents] == [f"step_{s}" for s in STEP_ORDER]
    assert "structure-c" in agent.sub_agents[0].instruction


def test_skips_disabled_step():
    agent = build_pipeline(_methodology(disabled=("augment",)), "detailed",
                           Provider.gemini, None, False, "SYS")
    names = [a.name for a in agent.sub_agents]
    assert "step_augment" not in names
    assert "augment-d" not in "".join(a.instruction for a in agent.sub_agents)
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/agents/test_pipeline.py -v`

- [ ] **Step 3: 實作** — `app/agents/pipeline.py`
```python
from google.adk.agents import LlmAgent, SequentialAgent

from app.agents.models import build_model
from app.agents.tools import web_search_tools
from app.schemas.requests import Provider

STEP_ORDER = ["structure", "draft", "augment", "verify", "format"]
STEP_OUTPUT_KEY = {
    "structure": "outline", "draft": "draft", "augment": "augmented",
    "verify": "verified", "format": "final",
}


def _instruction(step_cfg: dict, mode: str) -> str:
    instr = step_cfg.get("instruction")
    if isinstance(instr, dict):
        return instr.get(mode) or instr.get("detailed") or ""
    return instr or ""


def build_pipeline(methodology, mode, provider: Provider, model_id, web_search, system):
    model = build_model(provider, model_id)
    steps = methodology.get("steps", {})
    sub_agents = []
    for name in STEP_ORDER:
        cfg = steps.get(name, {})
        if not cfg.get("enabled", True):
            continue
        tools = web_search_tools(provider, web_search) if name == "verify" else []
        sub_agents.append(LlmAgent(
            name=f"step_{name}",
            model=model,
            instruction=f"{system}\n\n{_instruction(cfg, mode)}",
            output_key=STEP_OUTPUT_KEY[name],
            tools=tools,
        ))
    return SequentialAgent(name="note_pipeline", sub_agents=sub_agents)
```
> **effort=High**：`models.generate_config(provider)` 回傳的設定，於建立 `LlmAgent` 時掛到 `generate_content_config`（實作時依 ADK 文件對接確切參數；初版可先不掛，Task 10 整合時補）。
> **State 流**：methodology 的 instruction 用 ADK state 模板引用前步輸出（`{source}`、`{outline}`、`{draft}`…）。初始 state 由 Task 10 注入 `source/direction/extra`。

- [ ] **Step 4: 確認通過** — `uv run pytest tests/agents/test_pipeline.py -v`
- [ ] **Step 5: Commit**

---

### Task 10: POST /notes/stream（ADK Runner → SSE 正規化）

**Files:** Create `backend/app/api/notes.py`, `backend/tests/api/test_notes.py`；Modify `backend/app/main.py`

**Interfaces:**
- Consumes: `verify_request`, `NoteRequest`, `get_methodology`, `build_source`, `build_pipeline`, `sse`, `get_settings`
- Produces: `POST /notes/stream` → `text/event-stream`；事件 `step/delta/citations/done/error`；422（內容過短 / category 不符）；401/403（auth）；`run_pipeline(req, methodology, settings)` async generator（可獨立測）

- [ ] **Step 1: 失敗測試** — `tests/api/test_notes.py`（用可注入的 fake runner，避免真打 LLM）
```python
import pytest
import app.api.notes as notes
from app.schemas.requests import NoteRequest


def _req():
    return NoteRequest(category="youtube", methodology_id="m1", mode="concise",
                       content={"text": "x" * 300})


@pytest.mark.asyncio
async def test_methodology_not_found(monkeypatch):
    monkeypatch.setattr(notes, "get_methodology", lambda _id: None)
    chunks = [c async for c in notes.run_pipeline(_req(), None, notes.get_settings())]
    body = "".join(chunks)
    assert "methodology_not_found" in body


@pytest.mark.asyncio
async def test_happy_path_event_order(monkeypatch):
    methodology = {"categories": ["youtube"],
                   "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                             for s in ["structure", "draft", "augment", "verify", "format"]}}

    async def fake_events():
        # 模擬 ADK 事件：每步一個 author，format 步多個 partial
        from types import SimpleNamespace as N
        for s in ["structure", "draft", "augment", "verify"]:
            yield N(author=f"step_{s}", partial=False, content=N(parts=[N(text="ok")]),
                    grounding_metadata=None, is_final_response=lambda: False)
        for tok in ["# 標題", "\n內容"]:
            yield N(author="step_format", partial=True, content=N(parts=[N(text=tok)]),
                    grounding_metadata=None, is_final_response=lambda: False)
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# 標題\n內容")]),
                grounding_metadata=None, is_final_response=lambda: True)

    monkeypatch.setattr(notes, "_drive_adk", lambda *a, **k: fake_events())
    body = "".join([c async for c in notes.run_pipeline(_req(), methodology, notes.get_settings())])
    assert "event: step" in body
    assert "event: delta" in body
    assert "event: done" in body
    assert body.index("event: step") < body.index("event: done")
```

- [ ] **Step 2: 確認失敗** — `uv run pytest tests/api/test_notes.py -v`

- [ ] **Step 3: 實作** — `app/api/notes.py`
```python
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.collect import build_source
from app.agents.models import ProviderNotImplemented
from app.agents.pipeline import build_pipeline
from app.auth.middleware import verify_request
from app.core.config import get_settings
from app.schemas.events import sse
from app.schemas.requests import NoteRequest
from app.store.firestore import get_methodology

router = APIRouter()
_APP_NAME = "take-note"
_USER = "owner"


async def _drive_adk(agent, initial_state: dict) -> AsyncIterator:
    """跑 ADK Runner，yield 原始 event。⚠️ event 屬性名（author/partial/
    content.parts/grounding_metadata/is_final_response）依 ADK 文件確認。"""
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name=_APP_NAME, user_id=_USER, state=initial_state)
    runner = Runner(app_name=_APP_NAME, agent=agent, session_service=session_service)
    msg = types.Content(role="user", parts=[types.Part(text="開始整理筆記")])
    run_config = RunConfig(streaming_mode=StreamingMode.SSE)
    async for event in runner.run_async(
        user_id=_USER, session_id=session.id, new_message=msg, run_config=run_config):
        yield event


async def run_pipeline(req: NoteRequest, methodology, settings) -> AsyncIterator[str]:
    if methodology is None:
        yield sse("error", {"code": "methodology_not_found", "message": req.methodology_id})
        return

    system = "你是專業的學習筆記整理者，輸出繁體中文 Markdown。"
    try:
        agent = build_pipeline(methodology, req.mode.value, req.provider,
                               req.model, req.web_search, system)
    except ProviderNotImplemented as exc:
        yield sse("error", {"code": "provider_not_implemented", "message": str(exc)})
        return
    initial_state = {
        "source": build_source(req.content),
        "direction": req.direction,
        "extra": req.extra_requirements or "",
    }

    final_markdown = ""
    last_author = None
    try:
        async for event in _drive_adk(agent, initial_state):
            author = getattr(event, "author", "")
            text = ""
            if getattr(event, "content", None) and event.content.parts:
                text = "".join(p.text or "" for p in event.content.parts)
            if author != last_author and author.startswith("step_"):
                if last_author:
                    yield sse("step", {"step": last_author.removeprefix("step_"),
                                       "status": "done", "summary": None})
                yield sse("step", {"step": author.removeprefix("step_"), "status": "start"})
                last_author = author
            gm = getattr(event, "grounding_metadata", None)
            if gm:
                items = _citations_from(gm)
                if items:
                    yield sse("citations", {"items": items})
            if author == "step_format":
                if getattr(event, "partial", False) and text:
                    yield sse("delta", {"text": text})
                elif event.is_final_response() and text:
                    final_markdown = text
        if last_author:
            yield sse("step", {"step": last_author.removeprefix("step_"),
                               "status": "done", "summary": None})
        yield sse("done", {"markdown": final_markdown})
    except Exception as exc:  # provider/runtime 錯誤 → error 事件，保留已串內容
        yield sse("error", {"code": "provider_error", "message": str(exc)})


def _citations_from(gm) -> list[dict]:
    items = []
    for chunk in getattr(gm, "grounding_chunks", []) or []:
        web = getattr(chunk, "web", None)
        if web:
            items.append({"title": getattr(web, "title", ""), "url": getattr(web, "uri", "")})
    return items


@router.post("/notes/stream")
async def notes_stream(req: NoteRequest, _email: str = Depends(verify_request)):
    settings = get_settings()
    if len(req.content.text.strip()) < settings.min_content_chars:
        raise HTTPException(status_code=422, detail="content too short")
    methodology = get_methodology(req.methodology_id)
    if methodology is not None and req.category.value not in (methodology.get("categories") or []):
        raise HTTPException(status_code=422, detail="category not allowed for methodology")
    return StreamingResponse(run_pipeline(req, methodology, settings),
                             media_type="text/event-stream")
```
Modify `app/main.py`：加入 `from app.api import notes` 與 `app.include_router(notes.router)`。
> **Caveats（ADK 已知問題）**：(a) LiteLLM+OpenAI+tools+SSE 的 `usage_metadata` bug（[#2065](https://github.com/google/adk-python/issues/2065)）；(b) `ADK_ENABLE_PROGRESSIVE_SSE_STREAMING` 對 Gemini 3 會誘發過量 tool use（[#3974](https://github.com/google/adk-python/issues/3974)）。整合時驗證 event 屬性名與這些旗標行為。

- [ ] **Step 4: 確認通過** — `uv run pytest tests/api/test_notes.py -v`
- [ ] **Step 5: Commit**

---

### Task 11A: 種子方法論 + 本地 happy-path smoke + 核心 BDD（Phase A 收尾）

**Files:** Create `backend/scripts/seed_methodologies.py`, `backend/tests/bdd/test_core_scenarios.py`, `backend/tests/bdd/conftest.py`

**Interfaces:**
- Consumes: `run_pipeline`、`verify_request`、`get_methodology`、`spec/backend.feature`
- Produces: 一支可跑的 Gemini 種子方法論（至少 youtube 用，concise/detailed instruction 先放可運作的通用佔位）；核心 BDD 場景（happy path、401/403、methodology_not_found、內容過短）

- [ ] **Step 1: 種子方法論腳本** — `scripts/seed_methodologies.py` 寫入至少一份 `youtube` 方法論（`steps.{structure,draft,augment,verify,format}.instruction={concise,detailed}` 用可運作的通用提示，`format.output_contract` 指定繁中 Markdown 結構）。instruction 用 ADK state 模板引用 `{source}`/`{outline}`/`{draft}` 等。**真實精修要求待使用者提供後覆寫。**
- [ ] **Step 2: 核心 BDD glue** — `tests/bdd/test_core_scenarios.py` 用 pytest-bdd 綁 `spec/backend.feature` 的核心場景：happy path（fake runner 驗 step→delta→done 順序）、缺/壞 token（TestClient 驗 401）、email 不在 allowlist（403）、方法論不存在（error code）、內容過短（422）。
- [ ] **Step 3: 跑** — `uv run pytest tests/bdd -v`（先紅後綠）
- [ ] **Step 4: 本地真實 Gemini smoke（手動里程碑）**
```bash
gcloud auth application-default login
cd backend && uv run uvicorn app.main:app --reload
# 另一個終端：以放寬 auth（本地把 ALLOWED_EMAILS 對應測試 token，或暫時 mock verify_request）
# POST 一段真實 transcript 到 /notes/stream，確認 SSE 收到 step→delta→done 且 markdown 合理
```
- [ ] **Step 5: Commit** — happy path 跑通即 Phase A 完成。

---

## Phase A Verification（驗收）
- `cd backend && uv run pytest`（unit + agents + api + 核心 bdd）全綠。
- 本地 `uv run uvicorn` + ADC，POST 真實 transcript 到 `/notes/stream`，SSE 收到 `step → delta → done`，產出合理繁中 Markdown 筆記。

---

## Phase B — 後續待完成（happy path 跑通後）
1. **OpenAI / Claude provider**：`uv add litellm`；config 加 `openai_api_key`/`anthropic_api_key`；`models.build_model` 接 `LiteLlm(openai/…)`、`LiteLlm(anthropic/…)`；移除 `ProviderNotImplemented` 守衛；補對映測試。確認 model id 與 effort 參數（`reasoning_effort`/`thinking`）。注意 ADK 已知 issue [#2065](https://github.com/google/adk-python/issues/2065)（LiteLLM+OpenAI+tools+SSE）。
2. **effort=High 接線**：把 `generate_config` 掛到 `LlmAgent` 的 `generate_content_config`（依 ADK 文件確認）。
3. **非 Gemini 的 web search**：`tools.web_search_tools` 為 OpenAI/Claude 接各家原生 search，或對不支援者維持優雅降級（回 step summary 提示）。
4. **完整 BDD 場景**：補 `spec/backend.feature` 其餘場景——查證附 citations、provider 失敗保留前段、web search 降級提示。
5. **Eval**：`tests/eval/` 每類別小資料集 + `adk eval` LLM-as-judge（忠於原文 / 結構符合 output_contract / 無幻覺，0–5 分 + 容忍帶）。
6. **其餘種子方法論**：article / book / podcast / coursera 各一份；填入使用者提供的真實 concise/detailed 精修要求。
7. **部署 Cloud Run（asia-east1）**：
   - `Dockerfile`（uv + python 3.12-slim：`uv sync --frozen --no-dev` → `uvicorn`）。
   - 啟用 API（run/aiplatform/firestore/secretmanager/artifactregistry）、建最小權限 SA（Vertex User、Firestore User、Secret Accessor、Cloud Run Invoker）。
   - OpenAI/Claude key 寫入 Secret Manager（接 Phase B 才需要）。
   - `gcloud run deploy take-note-backend --source backend --region asia-east1 --no-allow-unauthenticated --service-account <SA> --set-env-vars GOOGLE_CLOUD_PROJECT=…,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_LOCATION=global,ALLOWED_EMAILS=…,CLOUD_RUN_SERVICE_URL=<url> --timeout 300`（Phase B 接 LLM 後再加 `--set-secrets`）。
   - e2e：帶 Google ID token 的 curl 對 Cloud Run 跑通真實 transcript。
8. **Extension 端**：另起 spec→plan→實作（萃取器、Side Panel、SSE 消費、ID token）。

## 寫入順序
Phase A：Task 1 → 11A 依序；建議 subagent-driven（每 task 一個 fresh subagent + 任務間 review）。Phase A happy path 跑通後再進 Phase B。
