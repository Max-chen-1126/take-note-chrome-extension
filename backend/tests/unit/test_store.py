import app.store.firestore as store


def test_client_factory_reuses_single_instance(monkeypatch):
    store._client = None
    calls = {"n": 0}

    class FakeClient:
        def __init__(self, *a, **k):
            calls["n"] += 1

    monkeypatch.setattr(store.firestore, "Client", FakeClient)
    try:
        c1 = store.client_factory()
        c2 = store.client_factory()
        assert c1 is c2          # reused, not re-instantiated
        assert calls["n"] == 1   # constructed exactly once across calls
    finally:
        store._client = None     # don't leak the fake into other tests


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
