"""Async Unraid GraphQL API client."""
import time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
_disks_cache: dict = {"data": None, "ts": 0}
TTL = 60

_SYSTEM_QUERY = """
query {
  info {
    os { platform version }
    cpu { brand cores threads usage }
    memory { total used free }
    uptime
  }
  array { status }
}
"""

_DOCKER_QUERY = """
query {
  dockerContainers {
    names
    status
    image
    state
  }
}
"""

_DISKS_QUERY = """
query {
  array {
    status
    capacity { kilobytes }
    disks {
      id
      name
      device
      size
      status
      temp
      numErrors
      numReads
      numWrites
      smart { status }
    }
    parities {
      id
      name
      device
      size
      status
      temp
      smart { status }
    }
  }
}
"""

async def fetch_disks() -> tuple[dict, str | None]:
    global _disks_cache
    if _disks_cache["data"] and time.time() - _disks_cache["ts"] < TTL:
        return _disks_cache["data"], None
    try:
        url = await get_setting("unraid_url", os.environ.get("UNRAID_URL", ""))
        key = await get_setting("unraid_key", os.environ.get("UNRAID_KEY", ""))
        if not (url and key):
            return _disks_cache.get("data") or {}, "Unraid credentials not configured"

        headers = {"x-api-key": key, "Content-Type": "application/json"}
        gql_url = url.rstrip("/") + "/graphql"
        async with httpx.AsyncClient(verify=False, timeout=10, headers=headers) as c:
            r = await c.post(gql_url, json={"query": _DISKS_QUERY})
            r.raise_for_status()

        raw = r.json().get("data", {}).get("array", {})
        disks    = raw.get("disks", [])    or []
        parities = raw.get("parities", []) or []

        def _normalise(d: dict, role: str) -> dict:
            smart = d.get("smart") or {}
            return {
                "id":       d.get("id", ""),
                "name":     d.get("name", ""),
                "device":   d.get("device", ""),
                "size":     d.get("size", 0),
                "status":   d.get("status", ""),
                "temp":     d.get("temp"),          # °C or null
                "errors":   d.get("numErrors", 0),
                "smart":    smart.get("status", ""),
                "role":     role,
            }

        data = {
            "status":   raw.get("status", ""),
            "capacity": raw.get("capacity", {}),
            "disks":    [_normalise(d, "data")   for d in disks],
            "parities": [_normalise(p, "parity") for p in parities],
        }
        _disks_cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _disks_cache.get("data") or {}, str(e)


async def fetch() -> tuple[dict, str | None]:
    global _cache
    if _cache["data"] and time.time() - _cache["ts"] < TTL:
        return _cache["data"], None
    try:
        url = await get_setting("unraid_url", os.environ.get("UNRAID_URL", ""))
        key = await get_setting("unraid_key", os.environ.get("UNRAID_KEY", ""))
        if not (url and key):
            return _cache.get("data") or {}, "Unraid credentials not configured"

        headers = {"x-api-key": key, "Content-Type": "application/json"}
        gql_url = url.rstrip("/") + "/graphql"
        async with httpx.AsyncClient(verify=False, timeout=10, headers=headers) as c:
            sys_r = await c.post(gql_url, json={"query": _SYSTEM_QUERY})
            sys_r.raise_for_status()
            docker_r = await c.post(gql_url, json={"query": _DOCKER_QUERY})
            docker_r.raise_for_status()

        data = {
            "system": sys_r.json().get("data", {}),
            "docker": docker_r.json().get("data", {}).get("dockerContainers", []),
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
