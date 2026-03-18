"""Portainer CE/EE API client."""
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
        url   = await get_setting("portainer_url",   os.environ.get("PORTAINER_URL", ""))
        token = await get_setting("portainer_token", os.environ.get("PORTAINER_TOKEN", ""))
        if not (url and token):
            return _cache.get("data") or {}, "Portainer not configured"

        headers = {"X-API-Key": token}
        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10, headers=headers) as c:
            ep_r = await c.get("/api/endpoints")
            endpoints = ep_r.json() if ep_r.status_code == 200 else []

            st_r = await c.get("/api/stacks")
            stacks = st_r.json() if st_r.status_code == 200 else []

            containers: list[dict] = []
            for ep in (endpoints if isinstance(endpoints, list) else [])[:3]:
                ep_id = ep.get("Id")
                try:
                    cr = await c.get(
                        f"/api/endpoints/{ep_id}/docker/containers/json",
                        params={"all": True},
                    )
                    if cr.status_code == 200:
                        for cnt in cr.json():
                            containers.append({
                                "id":       (cnt.get("Id") or "")[:12],
                                "name":     ((cnt.get("Names") or [""])[0]).lstrip("/"),
                                "image":    cnt.get("Image", ""),
                                "status":   cnt.get("Status", ""),
                                "state":    cnt.get("State", ""),
                                "endpoint": ep.get("Name", str(ep_id)),
                            })
                except Exception:
                    pass

        data = {
            "endpoints": [
                {"id": e.get("Id"), "name": e.get("Name"), "status": e.get("Status")}
                for e in (endpoints if isinstance(endpoints, list) else [])
            ],
            "stacks": [
                {
                    "id":          s.get("Id"),
                    "name":        s.get("Name"),
                    "status":      s.get("Status"),
                    "endpoint_id": s.get("EndpointId"),
                }
                for s in (stacks if isinstance(stacks, list) else [])
            ],
            "containers": containers,
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
