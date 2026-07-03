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


def test_get_prompt_template_hit_and_miss(monkeypatch):
    store.clear_cache()
    doc = _Doc(True, {"system": "STYLE", "version": 1})
    monkeypatch.setattr(store, "client_factory", lambda: _Client(doc))
    assert store.get_prompt_template("global-style")["system"] == "STYLE"
    # second call served from cache even if client breaks
    monkeypatch.setattr(store, "client_factory", lambda: (_ for _ in ()).throw(RuntimeError))
    assert store.get_prompt_template("global-style")["system"] == "STYLE"


def test_get_prompt_template_missing(monkeypatch):
    store.clear_cache()
    monkeypatch.setattr(store, "client_factory", lambda: _Client(_Doc(False, None)))
    assert store.get_prompt_template("nope") is None


def test_template_and_methodology_caches_do_not_collide(monkeypatch):
    # Same doc id used for both lookups must not return each other's data.
    store.clear_cache()
    meth_doc = _Doc(True, {"name": "M"})
    monkeypatch.setattr(store, "client_factory", lambda: _Client(meth_doc))
    assert store.get_methodology("dup")["name"] == "M"
    tmpl_doc = _Doc(True, {"system": "S"})
    monkeypatch.setattr(store, "client_factory", lambda: _Client(tmpl_doc))
    assert store.get_prompt_template("dup")["system"] == "S"


def test_list_methodologies_is_cached(monkeypatch):
    store.clear_cache()
    calls = {"n": 0}

    class _StreamColl:
        def stream(self):
            calls["n"] += 1
            return [_Doc(True, {"name": "M", "categories": ["youtube"]}, "m1")]

    class _StreamClient:
        def collection(self, _name):
            return _StreamColl()

    monkeypatch.setattr(store, "client_factory", lambda: _StreamClient())
    first = store.list_methodologies()
    second = store.list_methodologies()
    assert first == second
    assert calls["n"] == 1  # second call served from the TTL cache, not Firestore
    store.clear_cache()
    store.list_methodologies()
    assert calls["n"] == 2  # clear_cache() forces a re-stream


def test_get_usage_missing_month_returns_none(monkeypatch):
    monkeypatch.setattr(store, "client_factory", lambda: _Client(_Doc(False, None)))
    assert store.get_usage("2099-01") is None


def test_get_usage_existing_month_returns_dict(monkeypatch):
    doc = _Doc(True, {"total_cost_usd": 3.2, "request_count": 5})
    monkeypatch.setattr(store, "client_factory", lambda: _Client(doc))
    result = store.get_usage("2026-07")
    assert result["total_cost_usd"] == 3.2
    assert result["request_count"] == 5


class _RecordDoc:
    def __init__(self):
        self.set_calls = []
    def set(self, data, merge=False):
        self.set_calls.append((data, merge))


class _RecordColl:
    def __init__(self, doc):
        self._doc = doc
    def document(self, _id):
        return self._doc


class _RecordClient:
    def __init__(self, doc):
        self._doc = doc
    def collection(self, name):
        assert name == "usage_counters"
        return _RecordColl(self._doc)


def test_record_usage_writes_increments_with_merge(monkeypatch):
    doc = _RecordDoc()
    monkeypatch.setattr(store, "client_factory", lambda: _RecordClient(doc))
    monkeypatch.setattr(store.firestore, "Increment", lambda v: ("INCR", v))
    monkeypatch.setattr(store.firestore, "SERVER_TIMESTAMP", "SENTINEL_TIMESTAMP")

    store.record_usage("2026-07", cost_usd=1.5, prompt_tokens=100, output_tokens=50)

    assert len(doc.set_calls) == 1
    data, merge = doc.set_calls[0]
    assert merge is True
    assert data["total_cost_usd"] == ("INCR", 1.5)
    assert data["total_prompt_tokens"] == ("INCR", 100)
    assert data["total_output_tokens"] == ("INCR", 50)
    assert data["request_count"] == ("INCR", 1)
    assert data["updated_at"] == "SENTINEL_TIMESTAMP"


def test_record_usage_default_request_count_delta_is_one(monkeypatch):
    doc = _RecordDoc()
    monkeypatch.setattr(store, "client_factory", lambda: _RecordClient(doc))
    monkeypatch.setattr(store.firestore, "Increment", lambda v: v)
    monkeypatch.setattr(store.firestore, "SERVER_TIMESTAMP", "SENTINEL_TIMESTAMP")

    store.record_usage("2026-07", cost_usd=0.1, prompt_tokens=1, output_tokens=1,
                       request_count_delta=3)

    data, _ = doc.set_calls[0]
    assert data["request_count"] == 3
