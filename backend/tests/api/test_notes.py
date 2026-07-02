import logging
from datetime import datetime
from zoneinfo import ZoneInfo

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


@pytest.mark.asyncio
async def test_format_event_without_parts_does_not_crash(monkeypatch):
    # A format event whose `content` has no `parts` attribute must not raise
    # AttributeError (defensive getattr); the stream should still finish cleanly.
    methodology = {"categories": ["youtube"],
                   "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                             for s in ["structure", "draft", "augment", "verify", "format"]}}

    async def fake_events():
        from types import SimpleNamespace as N
        yield N(author="step_format", partial=True, content=N(),  # no .parts
                grounding_metadata=None, is_final_response=lambda: False)
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True)

    monkeypatch.setattr(notes, "_drive_adk", lambda *a, **k: fake_events())
    body = "".join([c async for c in notes.run_pipeline(_req(), methodology, notes.get_settings())])
    assert "provider_error" not in body
    assert "event: done" in body


def _format_methodology():
    return {"categories": ["youtube"],
            "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                      for s in ["structure", "draft", "augment", "verify", "format"]}}


def _capture_system(monkeypatch):
    captured = {}
    real_build = notes.build_pipeline

    def fake_build(methodology, mode, provider, model, web_search, system):
        captured["system"] = system
        return real_build(methodology, mode, provider, model, web_search, system)

    monkeypatch.setattr(notes, "build_pipeline", fake_build)

    async def fake_drive_adk(agent, initial_state):
        from types import SimpleNamespace as N
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True)

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    return captured


@pytest.mark.asyncio
async def test_global_style_template_used_as_system(monkeypatch):
    monkeypatch.setattr(notes, "get_prompt_template",
                        lambda _id: {"system": "SENTINEL-STYLE"})
    captured = _capture_system(monkeypatch)
    body = "".join([c async for c in notes.run_pipeline(
        _req(), _format_methodology(), notes.get_settings())])
    assert "event: done" in body
    assert "SENTINEL-STYLE" in captured["system"]


@pytest.mark.asyncio
async def test_global_style_template_missing_falls_back(monkeypatch):
    monkeypatch.setattr(notes, "get_prompt_template", lambda _id: None)
    captured = _capture_system(monkeypatch)
    body = "".join([c async for c in notes.run_pipeline(
        _req(), _format_methodology(), notes.get_settings())])
    assert "event: done" in body
    assert "provider_error" not in body
    assert captured["system"]  # non-empty fallback string


@pytest.mark.asyncio
async def test_initial_state_includes_taipei_date(monkeypatch):
    methodology = {"categories": ["youtube"],
                   "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                             for s in ["structure", "draft", "augment", "verify", "format"]}}
    captured = {}

    async def fake_drive_adk(agent, initial_state):
        captured["initial_state"] = initial_state
        from types import SimpleNamespace as N
        yield N(author="step_format", partial=False, content=N(parts=[N(text="# ok")]),
                grounding_metadata=None, is_final_response=lambda: True)

    monkeypatch.setattr(notes, "_drive_adk", fake_drive_adk)
    body = "".join([c async for c in notes.run_pipeline(_req(), methodology, notes.get_settings())])
    assert "event: done" in body
    expected = datetime.now(ZoneInfo("Asia/Taipei")).date().isoformat()
    assert captured["initial_state"]["date"] == expected


@pytest.mark.asyncio
async def test_pipeline_logs_step_and_done_events(monkeypatch, caplog):
    methodology = {"categories": ["youtube"],
                   "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                             for s in ["structure", "draft", "augment", "verify", "format"]}}

    async def fake_events():
        from types import SimpleNamespace as N
        for s in ["structure", "draft", "augment", "verify"]:
            yield N(author=f"step_{s}", partial=False, content=N(parts=[N(text="ok")]),
                    grounding_metadata=None, is_final_response=lambda: False)
        yield N(author="step_format", partial=False, content=N(parts=[N(text="done")]),
                grounding_metadata=None, is_final_response=lambda: True)

    monkeypatch.setattr(notes, "_drive_adk", lambda *a, **k: fake_events())
    with caplog.at_level(logging.INFO, logger="app.notes"):
        "".join([c async for c in notes.run_pipeline(_req(), methodology, notes.get_settings())])
    steps_seen = [r.fields["step"] for r in caplog.records
                 if getattr(r, "fields", None) and "step" in r.fields]
    assert "structure" in steps_seen
    assert "format" in steps_seen
    done_records = [r for r in caplog.records
                    if getattr(r, "fields", None) and r.getMessage() == "pipeline_done"]
    assert len(done_records) == 1
    elapsed_ms = done_records[0].fields["elapsed_ms"]
    assert isinstance(elapsed_ms, (int, float))
    assert elapsed_ms >= 0


@pytest.mark.asyncio
async def test_pipeline_error_event_on_provider_exception(monkeypatch, caplog):
    # Reproduces the reviewer-reported crash: the except-block's log_event call
    # must not itself raise (previously passed message=str(exc), colliding with
    # log_event's positional `message` parameter). The generator must still
    # yield an `error` SSE event instead of letting the exception propagate.
    methodology = {"categories": ["youtube"],
                   "steps": {s: {"enabled": True, "instruction": {"concise": s}}
                             for s in ["structure", "draft", "augment", "verify", "format"]}}

    async def fake_events():
        from types import SimpleNamespace as N
        yield N(author="step_structure", partial=False, content=N(parts=[N(text="ok")]),
                grounding_metadata=None, is_final_response=lambda: False)
        raise RuntimeError("boom mid-stream")
        yield  # pragma: no cover - unreachable, keeps this an async generator

    monkeypatch.setattr(notes, "_drive_adk", lambda *a, **k: fake_events())
    with caplog.at_level(logging.ERROR, logger="app.notes"):
        body = "".join([c async for c in notes.run_pipeline(_req(), methodology, notes.get_settings())])
    assert "event: error" in body
    assert "provider_error" in body
    error_records = [r for r in caplog.records
                     if getattr(r, "fields", None) and r.getMessage() == "pipeline_error"
                     and r.fields.get("code") == "provider_error"]
    assert len(error_records) == 1
    assert error_records[0].fields["error_message"] == "boom mid-stream"
