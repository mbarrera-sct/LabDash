"""Async Home Assistant REST API client."""
import time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
TTL = 30

async def fetch() -> tuple[dict, str | None]:
    global _cache
    if _cache["data"] and time.time() - _cache["ts"] < TTL:
        return _cache["data"], None
    try:
        url   = await get_setting("ha_url",   os.environ.get("HA_URL", ""))
        token = await get_setting("ha_token", os.environ.get("HA_TOKEN", ""))
        if not (url and token):
            return _cache.get("data") or {}, "Home Assistant credentials not configured"

        # Entity filter: comma-separated list stored in config
        entity_filter_raw = await get_setting("ha_entities", os.environ.get("HA_ENTITIES", ""))
        entity_filter = [e.strip() for e in entity_filter_raw.split(",") if e.strip()]

        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10, headers=headers) as c:
            if entity_filter:
                states = []
                for entity_id in entity_filter:
                    r = await c.get(f"/api/states/{entity_id}")
                    if r.status_code == 200:
                        states.append(r.json())
            else:
                r = await c.get("/api/states")
                r.raise_for_status()
                all_states = r.json()
                # Default: return only device_tracker, sensor, binary_sensor, person, input_boolean
                states = [
                    s for s in all_states
                    if s.get("entity_id", "").split(".")[0] in
                    ("device_tracker", "person", "sensor", "binary_sensor", "input_boolean", "media_player")
                ][:50]

        data = {"states": states}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
