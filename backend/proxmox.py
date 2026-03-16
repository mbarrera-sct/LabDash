"""Async Proxmox VE API client with 20s cache."""
import json, ssl, time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
TTL = 20

async def _client(base_url: str):
    return httpx.AsyncClient(base_url=base_url, verify=False, timeout=10)

async def fetch() -> tuple[dict, str | None]:
    global _cache
    if _cache["data"] and time.time() - _cache["ts"] < TTL:
        return _cache["data"], None
    try:
        url  = await get_setting("pve_url",  os.environ.get("PVE_URL",  "https://192.168.1.7:8006"))
        user = await get_setting("pve_user", os.environ.get("PVE_USER", "root@pam"))
        pwd  = await get_setting("pve_pass", os.environ.get("PVE_PASS", ""))
        if not pwd:
            return _cache.get("data") or {}, "Proxmox password not configured"

        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10) as c:
            if "!" in user:
                # API Token auth: username format is "user@realm!tokenid"
                headers = {"Authorization": f"PVEAPIToken={user}={pwd}"}
            else:
                # Password auth: obtain ticket
                r = await c.post("/api2/json/access/ticket",
                                 data={"username": user, "password": pwd})
                r.raise_for_status()
                ticket = r.json()["data"]["ticket"]
                csrf   = r.json()["data"]["CSRFPreventionToken"]
                headers = {"Cookie": f"PVEAuthCookie={ticket}",
                           "CSRFPreventionToken": csrf}

            resources = (await c.get("/api2/json/cluster/resources", headers=headers)).json()["data"]
            nodes     = (await c.get("/api2/json/nodes", headers=headers)).json()["data"]

        data = {"resources": resources, "nodes": nodes}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
