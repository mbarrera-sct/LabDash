"""SNMP switch poller — IF-MIB interface status + bandwidth.
Polls every 10 s; calculates KB/s from 64-bit counter deltas.
"""
import asyncio, os, time
import db

_cache: dict = {"data": None, "ts": 0}
_prev_counters: dict = {}   # f"{host}:{idx}" -> {ts, in, out}
_CACHE_TTL = 10             # seconds

_OID_ifDescr       = "1.3.6.1.2.1.2.2.1.2"
_OID_ifOperStatus  = "1.3.6.1.2.1.2.2.1.8"   # 1=up, 2=down
_OID_ifHCIn        = "1.3.6.1.2.1.31.1.1.1.6"
_OID_ifHCOut       = "1.3.6.1.2.1.31.1.1.1.10"
_OID_ifAlias       = "1.3.6.1.2.1.31.1.1.1.18"
_OID_ifName        = "1.3.6.1.2.1.31.1.1.1.1"


async def fetch() -> tuple[dict | None, str | None]:
    now = time.time()
    if _cache["data"] and now - _cache["ts"] < _CACHE_TTL:
        return _cache["data"], None

    host      = os.environ.get("SNMP_HOST")      or await db.get_setting("snmp_host")
    community = os.environ.get("SNMP_COMMUNITY") or await db.get_setting("snmp_community") or "public"
    port_raw  = os.environ.get("SNMP_PORT")      or await db.get_setting("snmp_port") or "161"

    if not host:
        return None, "SNMP no configurado"

    try:
        udp_port = int(port_raw)
        data = await asyncio.to_thread(_poll_sync, host, community, udp_port)
        _cache["data"] = data
        _cache["ts"]   = now
        return data, None
    except Exception as exc:
        return _cache["data"], str(exc)


def _poll_sync(host: str, community: str, port: int = 161) -> dict:
    from pysnmp.hlapi import (
        SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
        ObjectType, ObjectIdentity, nextCmd,
    )

    engine = SnmpEngine()

    def walk(base_oid: str) -> dict:
        result: dict = {}
        for err_ind, err_status, _, var_binds in nextCmd(
            engine,
            CommunityData(community, mpModel=1),           # SNMPv2c
            UdpTransportTarget((host, port), timeout=3, retries=1),
            ContextData(),
            ObjectType(ObjectIdentity(base_oid)),
            lexicographicMode=False,
            ignoreNonIncreasingOid=True,
        ):
            if err_ind or err_status:
                break
            for vb in var_binds:
                oid_str, val = vb
                idx = str(oid_str).rsplit(".", 1)[-1]
                result[idx] = val
        return result

    statuses = walk(_OID_ifOperStatus)
    if not statuses:
        return {"ports": []}

    descrs    = walk(_OID_ifDescr)
    names     = walk(_OID_ifName)
    aliases   = walk(_OID_ifAlias)
    in_octs   = walk(_OID_ifHCIn)
    out_octs  = walk(_OID_ifHCOut)

    now = time.time()
    ports = []
    for idx, status_val in statuses.items():
        try:
            in_b  = int(in_octs.get(idx,  0))
            out_b = int(out_octs.get(idx, 0))
        except (TypeError, ValueError):
            in_b = out_b = 0

        key  = f"{host}:{idx}"
        prev = _prev_counters.get(key)
        in_kbps = out_kbps = 0.0
        if prev:
            dt = now - prev["ts"]
            if dt > 0:
                in_kbps  = max((in_b  - prev["in"])  / dt / 1024, 0.0)
                out_kbps = max((out_b - prev["out"]) / dt / 1024, 0.0)
        _prev_counters[key] = {"ts": now, "in": in_b, "out": out_b}

        try:
            up = int(status_val) == 1
        except (TypeError, ValueError):
            up = False

        name  = str(names.get(idx)   or descrs.get(idx) or f"if{idx}")
        alias = str(aliases.get(idx) or "")
        descr = str(descrs.get(idx)  or name)

        ports.append({
            "idx":      int(idx),
            "name":     name,
            "descr":    descr,
            "alias":    alias,
            "up":       up,
            "in_kbps":  round(in_kbps,  1),
            "out_kbps": round(out_kbps, 1),
        })

    # Prune stale counter entries for interfaces no longer visible on this host
    seen = {f"{host}:{idx}" for idx in statuses}
    for k in [k for k in _prev_counters if k.startswith(f"{host}:") and k not in seen]:
        del _prev_counters[k]

    return {"ports": sorted(ports, key=lambda p: p["idx"])}
