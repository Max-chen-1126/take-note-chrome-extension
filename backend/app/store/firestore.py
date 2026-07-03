import time

from google.cloud import firestore

from app.core.config import get_settings

_cache: dict[str, tuple[float, dict | None]] = {}
_list_cache: tuple[float, list[dict]] | None = None
_client: firestore.Client | None = None


def client_factory() -> firestore.Client:
    # Reuse a single thread-safe firestore.Client; constructing one per call
    # re-initializes gRPC channels + credentials and adds latency.
    global _client
    if _client is None:
        _client = firestore.Client(project=get_settings().google_cloud_project)
    return _client


def clear_cache() -> None:
    global _list_cache
    _cache.clear()
    _list_cache = None


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
    # TTL-cached: /methodologies is public, so without this every (possibly
    # hostile) hit would stream the whole collection from Firestore. Cache the
    # list for methodology_cache_ttl seconds (single instance under
    # max-instances=1, so this is effectively a global cache).
    global _list_cache
    ttl = get_settings().methodology_cache_ttl
    now = time.time()
    if _list_cache and now - _list_cache[0] < ttl:
        return _list_cache[1]
    out = []
    for d in client_factory().collection("methodologies").stream():
        data = d.to_dict() or {}
        out.append({
            "id": d.id,
            "name": data.get("name"),
            "description": data.get("description"),
            "categories": data.get("categories", []),
        })
    _list_cache = (now, out)
    return out


def get_usage(month_key: str) -> dict | None:
    doc = client_factory().collection("usage_counters").document(month_key).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def record_usage(month_key: str, *, cost_usd: float, prompt_tokens: int, output_tokens: int,
                  request_count_delta: int = 1) -> None:
    # set(merge=True) with Increment (not update()) is deliberate: update() raises
    # NotFound against a missing document, while set(merge=True) initializes the
    # field from the increment delta if the doc doesn't exist yet — this IS the
    # "new month resets to zero" mechanism, no explicit zeroing code needed.
    client_factory().collection("usage_counters").document(month_key).set(
        {
            "total_cost_usd": firestore.Increment(cost_usd),
            "total_prompt_tokens": firestore.Increment(prompt_tokens),
            "total_output_tokens": firestore.Increment(output_tokens),
            "request_count": firestore.Increment(request_count_delta),
            "updated_at": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
