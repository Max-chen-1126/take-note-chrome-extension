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
