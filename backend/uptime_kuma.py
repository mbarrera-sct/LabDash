"""Uptime Kuma — public status page JSON API."""
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
        url  = await get_setting("uptime_kuma_url",  os.environ.get("UPTIME_KUMA_URL", ""))
        slug = await get_setting("uptime_kuma_slug", os.environ.get("UPTIME_KUMA_SLUG", "default"))
        if not url:
            return _cache.get("data") or {}, "Uptime Kuma not configured"

        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10) as c:
            r = await c.get(f"/api/status-page/heartbeat/{slug}")
            r.raise_for_status()
            payload = r.json()

        heartbeat_list = payload.get("heartbeatList", {})
        uptime_list    = payload.get("uptimeList", {})
        info_list      = payload.get("publicGroupList", [])

        # Build name map from publicGroupList
        name_map: dict[str, str] = {}
        for group in info_list:
            for mon in group.get("monitorList", []):
                name_map[str(mon.get("id"))] = mon.get("name", str(mon.get("id")))

        monitors = []
        for monitor_id, beats in heartbeat_list.items():
            last = beats[-1] if beats else {}
            monitors.append({
                "id":         monitor_id,
                "name":       name_map.get(monitor_id, monitor_id),
                "status":     last.get("status", 0),   # 1=up, 0=down
                "msg":        last.get("msg", ""),
                "ping":       last.get("ping"),
                "uptime_24h": round(uptime_list.get(f"{monitor_id}_24", 0) * 100, 1),
            })

        data = {
            "monitors": monitors,
            "total":    len(monitors),
            "up":       sum(1 for m in monitors if m["status"] == 1),
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
