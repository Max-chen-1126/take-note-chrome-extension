import time

from google.cloud import firestore

from app.core.config import get_settings

_cache: dict[str, tuple[float, dict | None]] = {}
_client: firestore.Client | None = None


def client_factory() -> firestore.Client:
    # Reuse a single thread-safe firestore.Client; constructing one per call
    # re-initializes gRPC channels + credentials and adds latency.
    global _client
    if _client is None:
        _client = firestore.Client(project=get_settings().google_cloud_project)
    return _client


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


def get_prompt_template(tid: str) -> dict | None:
    ttl = get_settings().methodology_cache_ttl
    now = time.time()
    key = f"tmpl:{tid}"
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    doc = client_factory().collection("prompt_templates").document(tid).get()
    if not doc.exists:
        _cache[key] = (now, None)  # negative-cache misses to avoid cache penetration
        return None
    data = doc.to_dict()
    _cache[key] = (now, data)
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
