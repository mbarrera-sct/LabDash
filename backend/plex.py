"""Async Plex Media Server API client."""
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
        url   = await get_setting("plex_url",   os.environ.get("PLEX_URL", ""))
        token = await get_setting("plex_token", os.environ.get("PLEX_TOKEN", ""))
        if not (url and token):
            return _cache.get("data") or {}, "Plex credentials not configured"

        headers = {"X-Plex-Token": token, "Accept": "application/json"}
        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10, headers=headers) as c:
            info_r = await c.get("/")
            info_r.raise_for_status()
            libs_r = await c.get("/library/sections")
            libs_r.raise_for_status()

        server = info_r.json().get("MediaContainer", {})
        libs   = libs_r.json().get("MediaContainer", {}).get("Directory", [])

        data = {
            "server_name":    server.get("friendlyName", "Plex"),
            "version":        server.get("version", ""),
            "platform":       server.get("platform", ""),
            "libraries":      [
                {
                    "title": l.get("title"),
                    "type":  l.get("type"),
                    "count": l.get("count", 0),
                }
                for l in libs
            ],
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
