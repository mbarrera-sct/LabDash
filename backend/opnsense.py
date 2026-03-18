"""Async OPNsense API client — HTTP Basic (key+secret).

Fixes vs. previous version:
- asyncio.Lock prevents concurrent fetches stampeding OPNsense when cache is cold
- asyncio.gather runs sub-requests in parallel (total latency ≈ slowest single request)
- every sub-request has its own try/except so one failure doesn't abort everything
- removed getWirelessChannel (not a wireless module in this setup)
- connect_timeout 5 s / read_timeout 10 s prevents long hangs on unreachable host
"""
import asyncio, time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
_lock: asyncio.Lock | None = None   # created lazily inside the running event loop
TTL = 90  # 90s cache — reduces how often the slow OPNsense fetch is triggered

_TIMEOUT = httpx.Timeout(connect=4.0, read=8.0, write=4.0, pool=4.0)


async def _safe_get(c: httpx.AsyncClient, path: str, **kwargs) -> dict | list:
    try:
        r = await c.get(path, **kwargs)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return {}


async def _safe_post(c: httpx.AsyncClient, path: str, **kwargs) -> dict | list:
    try:
        r = await c.post(path, **kwargs)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return {}


async def fetch() -> tuple[dict, str | None]:
    global _cache

    # Fast path: return cached data without acquiring the lock
    cached = _cache
    if cached["data"] and time.time() - cached["ts"] < TTL:
        return cached["data"], None

    # Slow path: serialise fetches so only one coroutine hits OPNsense at a time
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        # Re-check after acquiring lock (another coroutine may have fetched while we waited)
        cached = _cache
        if cached["data"] and time.time() - cached["ts"] < TTL:
            return cached["data"], None

        try:
            url    = await get_setting("opn_url",    os.environ.get("OPN_URL",    "https://192.168.1.1"))
            key    = await get_setting("opn_key",    os.environ.get("OPN_KEY",    ""))
            secret = await get_setting("opn_secret", os.environ.get("OPN_SECRET", ""))
            if not (key and secret):
                return cached.get("data") or {}, "OPNsense credentials not configured"

            auth = (key, secret)
            # Hard 20s ceiling — ensures the lock is ALWAYS released even if SSL or DNS hangs
            async with asyncio.timeout(20):
                async with httpx.AsyncClient(
                    base_url=url, verify=False, timeout=_TIMEOUT, auth=auth
                ) as c:
                    # ── Run all independent requests concurrently ──────────────
                    (
                        ifaces,
                        gateways,
                        sysinfo,
                        arp,
                        fw_log_v1,
                        fw_log_v2,
                        fw_rules_raw,
                        wg_clients_raw,
                        wg_servers_raw,
                        dhcp_kea,
                        dhcp_isc,
                    ) = await asyncio.gather(
                        _safe_get(c, "/api/diagnostics/interface/getInterfaceStatistics"),
                        _safe_get(c, "/api/routes/gateway/status"),
                        _safe_get(c, "/api/core/system/status"),
                        _safe_get(c, "/api/diagnostics/interface/getArp"),
                        _safe_get(c, "/api/diagnostics/firewall/log", params={"limit": 100}),
                        _safe_post(c, "/api/diagnostics/log/core/firewall",
                                   json={"searchPhrase": "", "limit": 100}),
                        _safe_get(c, "/api/firewall/filter/searchRule",
                                  params={"current_page": 1, "page_size_value": 200}),
                        _safe_get(c, "/api/wireguard/client/listClients"),
                        _safe_get(c, "/api/wireguard/server/listServers"),
                        _safe_post(c, "/api/kea/leases4/search",
                                   json={"current_page": 1, "page_size_value": 500}),
                        _safe_get(c, "/api/dhcpv4/leases/searchLease",
                                  params={"current_page": 1, "page_size_value": 500}),
                    )

            # ── Merge results ──────────────────────────────────────────────────
            # DHCP: prefer Kea (OPNsense 24.7+), fall back to ISC
            dhcp = dhcp_kea if dhcp_kea.get("rows") else dhcp_isc

            # Firewall log: prefer v1 endpoint, fall back to v2
            fw_log = fw_log_v1 if fw_log_v1 else fw_log_v2

            fw_rules = fw_rules_raw.get("rows", []) if isinstance(fw_rules_raw, dict) else []

            wireguard = {
                "clients": wg_clients_raw,
                "servers": wg_servers_raw,
            }

            data = {
                "interfaces": ifaces,
                "gateways":   gateways,
                "sysinfo":    sysinfo,
                "dhcp":       dhcp,
                "arp":        arp,
                "fw_log":     fw_log,
                "fw_rules":   fw_rules,
                "wireguard":  wireguard,
            }
            _cache = {"data": data, "ts": time.time()}
            return data, None

        except Exception as e:
            return _cache.get("data") or {}, str(e)
