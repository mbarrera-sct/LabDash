"""Async OPNsense API client — HTTP Basic (key+secret)."""
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
        url    = await get_setting("opn_url",    os.environ.get("OPN_URL", "https://192.168.1.1"))
        key    = await get_setting("opn_key",    os.environ.get("OPN_KEY", ""))
        secret = await get_setting("opn_secret", os.environ.get("OPN_SECRET", ""))
        if not (key and secret):
            return _cache.get("data") or {}, "OPNsense credentials not configured"

        auth = (key, secret)
        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10, auth=auth) as c:
            ifaces   = (await c.get("/api/diagnostics/interface/getInterfaceStatistics")).json()
            gateways = (await c.get("/api/routes/gateway/status")).json()

        data = {"interfaces": ifaces, "gateways": gateways}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
