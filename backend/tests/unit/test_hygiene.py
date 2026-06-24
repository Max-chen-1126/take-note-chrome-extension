from app.core.hygiene import resolve


def test_override_wins(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    assert resolve("a [[FOO]] b", {"FOO": "ov"}) == "a ov b"


def test_env_then_blank(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    monkeypatch.delenv("BAR", raising=False)
    assert resolve("[[FOO]]/[[BAR]]") == "envval/"
