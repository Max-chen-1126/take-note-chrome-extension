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
