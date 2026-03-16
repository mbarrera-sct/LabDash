"""Async Proxmox VE API client with 20s cache + VM actions."""
import time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
TTL = 20


async def _get_headers(c: httpx.AsyncClient, user: str, pwd: str) -> dict:
    """Return auth headers. Supports API token (user!tokenid) and password auth."""
    if "!" in user:
        return {"Authorization": f"PVEAPIToken={user}={pwd}"}
    r = await c.post("/api2/json/access/ticket",
                     data={"username": user, "password": pwd})
    r.raise_for_status()
    ticket = r.json()["data"]["ticket"]
    csrf   = r.json()["data"]["CSRFPreventionToken"]
    return {"Cookie": f"PVEAuthCookie={ticket}", "CSRFPreventionToken": csrf}


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
            headers   = await _get_headers(c, user, pwd)
            resources = (await c.get("/api2/json/cluster/resources", headers=headers)).json()["data"]
            nodes     = (await c.get("/api2/json/nodes", headers=headers)).json()["data"]

        data = {"resources": resources, "nodes": nodes}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)


async def test_connection() -> tuple[bool, str]:
    """Test Proxmox connectivity and return (ok, message)."""
    try:
        url  = await get_setting("pve_url",  os.environ.get("PVE_URL",  ""))
        user = await get_setting("pve_user", os.environ.get("PVE_USER", "root@pam"))
        pwd  = await get_setting("pve_pass", os.environ.get("PVE_PASS", ""))
        if not url:
            return False, "URL no configurada"
        if not pwd:
            return False, "Contraseña no configurada"

        async with httpx.AsyncClient(base_url=url, verify=False, timeout=8) as c:
            headers = await _get_headers(c, user, pwd)
            r = await c.get("/api2/json/version", headers=headers)
            version = r.json().get("data", {}).get("version", "?")
        return True, f"Conectado — Proxmox VE {version}"
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            tip = (
                "401 — Credenciales incorrectas. "
                "Si tienes 2FA en Proxmox usa API Token: "
                "Datacenter → API Tokens → añade token → "
                "en Settings pon Usuario=root@pam!tokenid y Contraseña=el_token_value"
            )
            return False, tip
        return False, str(e)
    except Exception as e:
        return False, str(e)


async def vm_action(node: str, vmtype: str, vmid: int, action: str) -> tuple[bool, str]:
    """
    Perform a VM/container action.
    action: start | stop | reset | suspend | resume | shutdown
    vmtype: qemu | lxc
    """
    valid_actions = {"start", "stop", "reset", "suspend", "resume", "shutdown"}
    if action not in valid_actions:
        return False, f"Acción no válida: {action}"
    try:
        url  = await get_setting("pve_url",  os.environ.get("PVE_URL",  ""))
        user = await get_setting("pve_user", os.environ.get("PVE_USER", "root@pam"))
        pwd  = await get_setting("pve_pass", os.environ.get("PVE_PASS", ""))

        async with httpx.AsyncClient(base_url=url, verify=False, timeout=15) as c:
            headers = await _get_headers(c, user, pwd)
            path = f"/api2/json/nodes/{node}/{vmtype}/{vmid}/status/{action}"
            r = await c.post(path, headers=headers)
            r.raise_for_status()
            upid = r.json().get("data", "")

        _cache["ts"] = 0  # invalidate cache
        return True, str(upid)
    except Exception as e:
        return False, str(e)
