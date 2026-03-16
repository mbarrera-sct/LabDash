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
        url    = await get_setting("opn_url",    os.environ.get("OPN_URL",    "https://192.168.1.1"))
        key    = await get_setting("opn_key",    os.environ.get("OPN_KEY",    ""))
        secret = await get_setting("opn_secret", os.environ.get("OPN_SECRET", ""))
        if not (key and secret):
            return _cache.get("data") or {}, "OPNsense credentials not configured"

        auth = (key, secret)
        async with httpx.AsyncClient(base_url=url, verify=False, timeout=10, auth=auth) as c:
            ifaces   = (await c.get("/api/diagnostics/interface/getInterfaceStatistics")).json()
            gateways = (await c.get("/api/routes/gateway/status")).json()

            try:
                sysinfo = (await c.get("/api/core/system/status")).json()
            except Exception:
                sysinfo = {}

            # DHCP leases — try Kea (OPNsense 24.7+) first, fall back to ISC
            dhcp: dict = {}
            try:
                r = await c.post("/api/kea/leases4/search",
                                 json={"current_page": 1, "page_size_value": 500})
                if r.status_code == 200:
                    dhcp = r.json()
            except Exception:
                pass
            if not dhcp.get("rows"):
                try:
                    r = await c.get("/api/dhcpv4/leases/searchLease",
                                    params={"current_page": 1, "page_size_value": 500})
                    if r.status_code == 200:
                        dhcp = r.json()
                except Exception:
                    pass

            # ARP table
            arp: dict = {}
            try:
                r = await c.get("/api/diagnostics/interface/getArp")
                if r.status_code == 200:
                    arp = r.json()
            except Exception:
                pass

            # Firewall log (last 100 entries)
            fw_log: dict = {}
            try:
                r = await c.get("/api/diagnostics/firewall/log",
                                params={"limit": 100})
                if r.status_code == 200:
                    fw_log = r.json()
            except Exception:
                pass
            if not fw_log:
                try:
                    r = await c.post("/api/diagnostics/log/core/firewall",
                                     json={"searchPhrase": "", "limit": 100})
                    if r.status_code == 200:
                        fw_log = r.json()
                except Exception:
                    pass

        data = {
            "interfaces": ifaces,
            "gateways":   gateways,
            "sysinfo":    sysinfo,
            "dhcp":       dhcp,
            "arp":        arp,
            "fw_log":     fw_log,
        }
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
