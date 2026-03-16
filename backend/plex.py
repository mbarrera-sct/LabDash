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

            # Fetch real item count per library (sections list doesn't include it reliably)
            lib_counts: dict[str, int] = {}
            for lib in libs:
                key = lib.get("key", "")
                if not key:
                    continue
                try:
                    cnt_r = await c.get(
                        f"/library/sections/{key}/all",
                        params={"X-Plex-Container-Start": 0, "X-Plex-Container-Size": 0},
                    )
                    mc = cnt_r.json().get("MediaContainer", {})
                    lib_counts[key] = int(mc.get("totalSize", mc.get("size", 0)))
                except Exception:
                    lib_counts[key] = lib.get("count") or 0

            # Active streams
            sessions = 0
            try:
                sess_r = await c.get("/status/sessions")
                sessions = int(sess_r.json().get("MediaContainer", {}).get("size", 0))
            except Exception:
                pass

        data = {
            "server_name": server.get("friendlyName", "Plex"),
            "version":     server.get("version", ""),
            "platform":    server.get("platform", ""),
            "sessions":    sessions,
            "libraries": [
                {
                    "key":   l.get("key", ""),
                    "title": l.get("title", ""),
                    "type":  l.get("type", ""),
                    "count": lib_counts.get(l.get("key", ""), l.get("count") or 0),
                }
                for l in libs
            ],
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
