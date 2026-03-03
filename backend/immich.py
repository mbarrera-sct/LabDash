"""Async Immich REST API client."""
import time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
TTL = 60

async def fetch() -> tuple[dict, str | None]:
    global _cache
    if _cache["data"] and time.time() - _cache["ts"] < TTL:
        return _cache["data"], None
    try:
        url = await get_setting("immich_url", os.environ.get("IMMICH_URL", ""))
        key = await get_setting("immich_key", os.environ.get("IMMICH_KEY", ""))
        if not (url and key):
            return _cache.get("data") or {}, "Immich credentials not configured"

        headers = {"x-api-key": key}
        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10, headers=headers) as c:
            r = await c.get("/api/server/statistics")
            r.raise_for_status()

        data = r.json()
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
