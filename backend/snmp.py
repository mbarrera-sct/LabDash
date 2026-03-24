"""SNMP switch poller — IF-MIB interface status + bandwidth.
Polls every 10 s; calculates KB/s from 64-bit counter deltas.
Supports multiple targets via snmp_targets JSON config.
Compatible with pysnmp 7.x (async API).
"""
import asyncio, json, os, time
import db

_cache: dict = {}           # target_name -> {"data": ..., "ts": ...}
_prev_counters: dict = {}   # f"{host}:{idx}" -> {ts, in, out}
_CACHE_TTL = 10             # seconds

_OID_ifDescr       = "1.3.6.1.2.1.2.2.1.2"
_OID_ifOperStatus  = "1.3.6.1.2.1.2.2.1.8"   # 1=up, 2=down
_OID_ifHCIn        = "1.3.6.1.2.1.31.1.1.1.6"
_OID_ifHCOut       = "1.3.6.1.2.1.31.1.1.1.10"
_OID_ifAlias       = "1.3.6.1.2.1.31.1.1.1.18"
_OID_ifName        = "1.3.6.1.2.1.31.1.1.1.1"

_OID_sysDescr      = "1.3.6.1.2.1.1.1"
_OID_sysName       = "1.3.6.1.2.1.1.5"
_OID_sysUpTime     = "1.3.6.1.2.1.1.3"
_OID_sysLocation   = "1.3.6.1.2.1.1.6"
_OID_ifHighSpeed   = "1.3.6.1.2.1.31.1.1.1.15"   # Mbps
_OID_ifInErrors    = "1.3.6.1.2.1.2.2.1.14"
_OID_ifOutErrors   = "1.3.6.1.2.1.2.2.1.20"
_OID_ifInDiscards  = "1.3.6.1.2.1.2.2.1.13"
_OID_ifOutDiscards = "1.3.6.1.2.1.2.2.1.19"


async def get_targets() -> list[dict]:
    """Return list of {name, host, community, port} from snmp_targets JSON, with legacy fallback."""
    targets_json = await db.get_setting("snmp_targets", "")
    if targets_json:
        try:
            targets = json.loads(targets_json)
            if isinstance(targets, list) and targets:
                return targets
        except Exception:
            pass
    # Legacy single-target fallback
    host      = os.environ.get("SNMP_HOST")      or await db.get_setting("snmp_host")
    community = os.environ.get("SNMP_COMMUNITY") or await db.get_setting("snmp_community") or "public"
    port_raw  = os.environ.get("SNMP_PORT")      or await db.get_setting("snmp_port") or "161"
    if host:
        return [{"name": "default", "host": host, "community": community, "port": port_raw}]
    return []


async def fetch() -> tuple[dict | None, str | None]:
    """Fetch from first configured target (backward compat)."""
    targets = await get_targets()
    if not targets:
        return None, "SNMP no configurado"
    t = targets[0]
    return await _fetch_target(t)


async def fetch_all() -> tuple[list[dict], list[str]]:
    """Fetch from all configured targets, return list of results with target name."""
    targets = await get_targets()
    if not targets:
        return [], ["SNMP no configurado"]
    results, errors = [], []
    for t in targets:
        data, err = await _fetch_target(t)
        if data:
            results.append({"target": t.get("name", "default"), "host": t.get("host", ""), **data})
        if err:
            errors.append(f"{t.get('name', 'default')}: {err}")
    return results, errors


async def _fetch_target(target: dict) -> tuple[dict | None, str | None]:
    name      = target.get("name", "default")
    host      = target.get("host", "")
    community = target.get("community", "public")
    port_raw  = str(target.get("port", "161"))
    if not host:
        return None, "SNMP no configurado"
    now = time.time()
    cached = _cache.get(name, {})
    if cached.get("data") and now - cached.get("ts", 0) < _CACHE_TTL:
        return cached["data"], None
    try:
        udp_port = int(port_raw)
        data = await _poll_async(host, community, udp_port)
        _cache[name] = {"data": data, "ts": now}
        return data, None
    except Exception as exc:
        return cached.get("data"), str(exc)


async def _walk(engine, auth, transport, ctx, oid: str) -> dict:
    """Walk a single OID subtree, return {index: value} dict."""
    from pysnmp.hlapi.v3arch.asyncio import walk_cmd, ObjectType, ObjectIdentity
    result: dict = {}
    async for err_ind, err_status, _, var_binds in walk_cmd(
        engine, auth, transport, ctx,
        ObjectType(ObjectIdentity(oid)),
        lexicographicMode=False,
    ):
        if err_ind or err_status:
            break
        for vb in var_binds:
            oid_str, val = vb
            idx = str(oid_str).rsplit(".", 1)[-1]
            result[idx] = val
    return result


async def _poll_async(host: str, community: str, port: int = 161) -> dict:
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
    )

    engine    = SnmpEngine()
    auth      = CommunityData(community, mpModel=1)   # SNMPv2c
    transport = await UdpTransportTarget.create((host, port), timeout=3, retries=1)
    ctx       = ContextData()

    statuses = await _walk(engine, auth, transport, ctx, _OID_ifOperStatus)
    if not statuses:
        return {"ports": [], "system": {}}

    (descrs, names, aliases, in_octs, out_octs,
     speeds, in_errs, out_errs, in_disc, out_disc) = await asyncio.gather(
        _walk(engine, auth, transport, ctx, _OID_ifDescr),
        _walk(engine, auth, transport, ctx, _OID_ifName),
        _walk(engine, auth, transport, ctx, _OID_ifAlias),
        _walk(engine, auth, transport, ctx, _OID_ifHCIn),
        _walk(engine, auth, transport, ctx, _OID_ifHCOut),
        _walk(engine, auth, transport, ctx, _OID_ifHighSpeed),
        _walk(engine, auth, transport, ctx, _OID_ifInErrors),
        _walk(engine, auth, transport, ctx, _OID_ifOutErrors),
        _walk(engine, auth, transport, ctx, _OID_ifInDiscards),
        _walk(engine, auth, transport, ctx, _OID_ifOutDiscards),
    )

    from pysnmp.hlapi.v3arch.asyncio import get_cmd, ObjectType, ObjectIdentity
    sys_info = {}
    try:
        for label, oid in [
            ("name",     _OID_sysName     + ".0"),
            ("descr",    _OID_sysDescr    + ".0"),
            ("location", _OID_sysLocation + ".0"),
            ("uptime",   _OID_sysUpTime   + ".0"),
        ]:
            async for err_ind, err_status, _, vbs in get_cmd(
                engine, auth, transport, ctx,
                ObjectType(ObjectIdentity(oid)),
            ):
                if not err_ind and not err_status and vbs:
                    sys_info[label] = str(vbs[0][1])
                break
    except Exception:
        pass

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

        name_str = str(names.get(idx)  or descrs.get(idx) or f"if{idx}")
        alias    = str(aliases.get(idx) or "")
        descr    = str(descrs.get(idx)  or name_str)

        speed_mbps = int(speeds.get(idx) or 0)
        in_err  = int(in_errs.get(idx)   or 0)
        out_err = int(out_errs.get(idx)  or 0)
        in_dis  = int(in_disc.get(idx)   or 0)
        out_dis = int(out_disc.get(idx)  or 0)

        ports.append({
            "idx":          int(idx),
            "name":         name_str,
            "descr":        descr,
            "alias":        alias,
            "up":           up,
            "in_kbps":      round(in_kbps,  1),
            "out_kbps":     round(out_kbps, 1),
            "speed_mbps":   speed_mbps,
            "in_errors":    in_err,
            "out_errors":   out_err,
            "in_discards":  in_dis,
            "out_discards": out_dis,
        })

    # Prune stale counter entries for interfaces no longer visible on this host
    seen = {f"{host}:{idx}" for idx in statuses}
    for k in [k for k in _prev_counters if k.startswith(f"{host}:") and k not in seen]:
        del _prev_counters[k]

    return {
        "ports":  sorted(ports, key=lambda p: p["idx"]),
        "system": sys_info,
    }
