from app.core.hygiene import resolve


def test_override_wins(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    assert resolve("a [[FOO]] b", {"FOO": "ov"}) == "a ov b"


def test_env_then_blank(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    monkeypatch.delenv("BAR", raising=False)
    assert resolve("[[FOO]]/[[BAR]]") == "envval/"


def test_sensitive_env_key_blocked(monkeypatch):
    monkeypatch.setenv("OAUTH_CLIENT_ID", "super-secret-client-id")
    assert resolve("id=[[OAUTH_CLIENT_ID]]") == "id="


def test_non_sensitive_env_key_still_resolves(monkeypatch):
    monkeypatch.setenv("FOO", "envval")
    assert resolve("[[FOO]]") == "envval"
