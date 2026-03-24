"""Async Unraid GraphQL API client — compatible with Unraid 7.x."""
import time, os
from datetime import datetime, timezone
import httpx
from db import get_setting

_SSL_VERIFY = os.environ.get("SSL_VERIFY", "false").lower() in ("true", "1", "yes")

_cache: dict = {"data": None, "ts": 0}
_disks_cache: dict = {"data": None, "ts": 0}
TTL = 60

# Unraid 7.x renamed several fields:
#   info.uptime       → info.os.uptime (ISO datetime of boot time)
#   info.os.version   → info.os.release
#   info.memory.*     → info.memory.layout[].size (only total, no used/free)
#   info.cpu.usage    → removed
#   array.status      → array.state
#   array.*.smart     → removed (use disk.status instead)

_SYSTEM_QUERY = """
query {
  info {
    os { platform release uptime }
    cpu { brand cores threads }
    memory { layout { size } }
  }
  array { state }
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
    state
    capacity { kilobytes { used total free } }
    disks {
      id
      name
      device
      size
      fsSize
      fsUsed
      fsFree
      status
      temp
      numErrors
      numReads
      numWrites
    }
    parities {
      id
      name
      device
      size
      status
      temp
    }
  }
}
"""


def _parse_uptime(uptime_val) -> int:
    """Return seconds of uptime. Handles both int (old API) and ISO datetime string (7.x)."""
    if uptime_val is None:
        return 0
    if isinstance(uptime_val, (int, float)):
        return int(uptime_val)
    try:
        boot_dt = datetime.fromisoformat(str(uptime_val).replace("Z", "+00:00"))
        return int((datetime.now(timezone.utc) - boot_dt).total_seconds())
    except Exception:
        return 0


def _normalise_system(gql_data: dict) -> dict:
    """Flatten GQL response into a consistent dict for the frontend."""
    info  = gql_data.get("info", {}) or {}
    os_   = info.get("os",     {}) or {}
    cpu   = info.get("cpu",    {}) or {}
    mem   = info.get("memory", {}) or {}
    array = gql_data.get("array", {}) or {}

    # Memory: 7.x only provides layout (list of modules with size)
    layout = mem.get("layout") or []
    mem_total = sum(m.get("size", 0) or 0 for m in layout) if layout else (mem.get("total") or 0)
    mem_used  = mem.get("used") or 0   # 0 on 7.x — field removed

    # Uptime: 7.x returns ISO boot datetime in os.uptime; old API had info.uptime (seconds)
    uptime_raw = os_.get("uptime") or info.get("uptime")
    uptime_s   = _parse_uptime(uptime_raw)

    # Version: 7.x uses "release", old API used "version"
    version = os_.get("release") or os_.get("version") or ""

    # Array status: 7.x uses "state" (STARTED/STOPPED), old API "status" (Started/Stopped)
    array_status = array.get("state") or array.get("status") or ""

    return {
        # Flat fields used by Unraid.tsx
        "version":     version,
        "platform":    os_.get("platform", ""),
        "uptime":      uptime_s,
        "cpu_model":   cpu.get("brand", ""),
        "cpu_cores":   cpu.get("cores"),
        "cpu_threads": cpu.get("threads"),
        "cpu_usage":   cpu.get("usage"),       # None on 7.x
        "mem_total":   mem_total,
        "mem_used":    mem_used,
        "array_status": array_status,
        # Nested structure kept for Services.tsx backward compat
        "info": {
            "os":     {"platform": os_.get("platform", ""), "version": version},
            "cpu":    {"brand": cpu.get("brand", ""), "cores": cpu.get("cores"),
                       "threads": cpu.get("threads"), "usage": cpu.get("usage")},
            "memory": {"total": mem_total, "used": mem_used,
                       "free": max(mem_total - mem_used, 0)},
            "uptime": uptime_s,
        },
        "array": {"status": array_status},
    }


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
        async with httpx.AsyncClient(verify=_SSL_VERIFY, timeout=10, headers=headers) as c:
            r = await c.post(gql_url, json={"query": _DISKS_QUERY})
            r.raise_for_status()

        raw   = r.json().get("data", {}).get("array", {})
        # state/status compat
        state = raw.get("state") or raw.get("status") or ""
        # capacity: 7.x returns strings inside kilobytes; old API returned ints
        kb    = (raw.get("capacity") or {}).get("kilobytes") or {}
        def _kb(k): return int(kb.get(k) or 0)

        def _normalise_disk(d: dict, role: str) -> dict:
            smart = (d.get("smart") or {}).get("status", "") or d.get("status", "")
            # ArrayDisk.size / fsSize / fsUsed / fsFree are in KB in the Unraid GQL API
            size_kb  = int(d.get("size",   0) or 0)
            fs_size  = int(d.get("fsSize", 0) or 0)
            fs_used  = int(d.get("fsUsed", 0) or 0)
            fs_free  = int(d.get("fsFree", 0) or 0)
            return {
                "id":      d.get("id", ""),
                "name":    d.get("name", ""),
                "device":  d.get("device", ""),
                "size":    size_kb * 1024,    # KB → bytes
                "used":    fs_used * 1024,    # KB → bytes
                "free":    fs_free * 1024,    # KB → bytes
                "fs_size": fs_size * 1024,    # KB → bytes
                "status":  d.get("status", ""),
                "temp":    d.get("temp"),
                "errors":  d.get("numErrors", 0),
                "smart":   smart,
                "role":    role,
            }

        data = {
            "status":   state,
            # Flat bytes for frontend (fmtBytes expects bytes, API returns kilobytes)
            "capacity": {
                "used":  _kb("used")  * 1024,
                "total": _kb("total") * 1024,
                "free":  _kb("free")  * 1024,
            },
            "disks":    [_normalise_disk(d, "data")    for d in (raw.get("disks")    or [])],
            "parities": [_normalise_disk(d, "parity")  for d in (raw.get("parities") or [])],
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
        async with httpx.AsyncClient(verify=_SSL_VERIFY, timeout=10, headers=headers) as c:
            sys_r = await c.post(gql_url, json={"query": _SYSTEM_QUERY})
            sys_r.raise_for_status()
            # Docker query is best-effort — don't fail the whole fetch if it errors
            try:
                docker_r = await c.post(gql_url, json={"query": _DOCKER_QUERY})
                docker_r.raise_for_status()
                docker_list = docker_r.json().get("data", {}).get("dockerContainers", [])
            except Exception:
                docker_list = _cache.get("data", {}).get("docker", []) if _cache.get("data") else []

        system_raw = sys_r.json().get("data", {})
        data = {
            "system": _normalise_system(system_raw),
            "docker": docker_list,
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
