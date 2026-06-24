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
