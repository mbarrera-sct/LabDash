"""Tailscale API client — Bearer token auth."""
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
        tailnet = await get_setting("tailscale_tailnet", os.environ.get("TAILSCALE_TAILNET", ""))
        token   = await get_setting("tailscale_token",   os.environ.get("TAILSCALE_TOKEN",   ""))
        if not (tailnet and token):
            return _cache.get("data") or {}, "Tailscale not configured"

        headers = {"Authorization": f"Bearer {token}"}
        url = f"https://api.tailscale.com/api/v2/tailnet/{tailnet}/devices"
        async with httpx.AsyncClient(timeout=10, headers=headers) as c:
            r = await c.get(url)
            if r.status_code != 200:
                return _cache.get("data") or {}, f"Tailscale API error {r.status_code}"
            body = r.json()

        devices_raw = body.get("devices", [])
        devices = []
        for d in devices_raw:
            devices.append({
                "id":          d.get("id", ""),
                "name":        d.get("hostname", d.get("name", "")),
                "display_name": d.get("displayName", d.get("hostname", "")),
                "addresses":   d.get("addresses", []),
                "ip":          (d.get("addresses") or [""])[0],
                "os":          d.get("os", ""),
                "last_seen":   d.get("lastSeen", ""),
                "online":      d.get("online", False),
                "tags":        d.get("tags", []),
            })

        data = {"devices": devices, "tailnet": tailnet}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
