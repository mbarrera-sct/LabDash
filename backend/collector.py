"""Background metrics & uptime collector — runs every 60 s."""
import asyncio, time
import db, proxmox, opnsense, snmp, ping as pingmod

INTERVAL = 60
_prev_event_state: dict = {}  # track state changes for event generation


async def collect():
    ts = int(time.time())
    now_state: dict = {}
    metric_rows: list = []   # batch: (ts, key, value)
    uptime_rows: list = []   # batch: (ts, host, up)

    # ── Proxmox ──────────────────────────────────────────────
    pve_data, _ = await proxmox.fetch()
    if pve_data:
        for n in pve_data.get("nodes", []):
            name    = n.get("node", "unknown")
            cpu_pct = round(n.get("cpu", 0) * 100, 2)
            mem_pct = round(n.get("mem", 0) / max(n.get("maxmem", 1), 1) * 100, 2)
            metric_rows.append((ts, f"pve.cpu.{name}", cpu_pct))
            metric_rows.append((ts, f"pve.mem.{name}", mem_pct))
            status_up = n.get("status") == "online"
            uptime_rows.append((ts, f"pve:{name}", status_up))
            now_state[f"pve.node.{name}"] = status_up

    # ── OPNsense gateways ─────────────────────────────────────
    opn_data, _ = await opnsense.fetch()
    if opn_data:
        gws = opn_data.get("gateways", {}).get("items", [])
        for gw in gws:
            name = gw.get("name", "gw").replace(" ", "_")
            delay_raw = gw.get("delay", "")
            if delay_raw and delay_raw not in ("~", "0.0", ""):
                try:
                    ms = float(str(delay_raw).replace("ms", "").strip())
                    metric_rows.append((ts, f"gw.rtt.{name}", ms))
                except Exception:
                    pass
            loss_raw = gw.get("loss", "")
            if loss_raw and loss_raw not in ("~", "0.0 %", ""):
                try:
                    loss = float(str(loss_raw).replace("%", "").strip())
                    metric_rows.append((ts, f"gw.loss.{name}", loss))
                except Exception:
                    pass
            up = gw.get("status_translated") == "Online"
            metric_rows.append((ts, f"gw.up.{name}", 1.0 if up else 0.0))
            prev = _prev_event_state.get(f"gw.up.{name}")
            if prev is not None and bool(prev) != up:
                level = "info" if up else "warn"
                msg = f"Gateway {gw.get('name')} {'volvió Online' if up else 'se cayó'}"
                await db.insert_event(ts, level, "OPNsense", msg)
            now_state[f"gw.up.{name}"] = up

    # ── SNMP bandwidth ────────────────────────────────────────
    snmp_data, _ = await snmp.fetch()
    if snmp_data:
        ports      = snmp_data.get("ports", [])
        total_in   = sum(p.get("in_kbps",  0) for p in ports)
        total_out  = sum(p.get("out_kbps", 0) for p in ports)
        up_count   = sum(1 for p in ports if p.get("up"))
        metric_rows.append((ts, "snmp.in_kbps",  round(total_in,  2)))
        metric_rows.append((ts, "snmp.out_kbps", round(total_out, 2)))
        metric_rows.append((ts, "snmp.ports_up", float(up_count)))

    # ── Flush metrics in one DB round-trip ───────────────────
    await db.batch_insert_metrics(metric_rows)

    # ── Ping uptime for diagram nodes ─────────────────────────
    try:
        diagram = await db.get_diagram()
        ips = list({
            n["data"]["ip"]
            for n in diagram.get("nodes", [])
            if n.get("data", {}).get("ip")
        })
        if ips:
            results = await pingmod.ping_batch(ips)
            for ip, up in results.items():
                uptime_rows.append((ts, ip, up))
                prev = _prev_event_state.get(f"ping.{ip}")
                if prev is not None and bool(prev) != up:
                    label = next(
                        (n["data"].get("label", ip)
                         for n in diagram.get("nodes", [])
                         if n.get("data", {}).get("ip") == ip),
                        ip
                    )
                    msg = f"{label} ({ip}) {'volvió online' if up else 'sin respuesta'}"
                    await db.insert_event(ts, "info" if up else "warn", "Ping", msg)
                now_state[f"ping.{ip}"] = up
    except Exception:
        pass

    # ── Flush uptime in one DB round-trip ─────────────────────
    await db.batch_insert_uptime(uptime_rows)

    # ── Purge stale data ──────────────────────────────────────
    await db.purge_old_metrics(days=7)
    await db.purge_old_uptime(days=30)

    _prev_event_state.update(now_state)


async def run():
    """Infinite loop — call from FastAPI lifespan as asyncio.create_task(run())."""
    await asyncio.sleep(5)
    while True:
        try:
            await collect()
        except Exception:
            pass
        await asyncio.sleep(INTERVAL)
