"""Alert evaluation + multi-channel notifications — runs every 60 s."""
import asyncio, logging, time
from datetime import datetime
import httpx
import db

log = logging.getLogger(__name__)

INTERVAL = 60

_snmp_prev_errors: dict = {}   # f"{target}:{port_name}" -> int

_OPS = {
    "gt":  lambda v, t: v > t,
    "lt":  lambda v, t: v < t,
    "eq":  lambda v, t: abs(v - t) < 0.001,
    "ne":  lambda v, t: abs(v - t) >= 0.001,
    "gte": lambda v, t: v >= t,
    "lte": lambda v, t: v <= t,
}

_OP_LABELS = {
    "gt": ">", "lt": "<", "eq": "=", "ne": "≠", "gte": "≥", "lte": "≤"
}


async def evaluate_services():
    """Evaluate alert rules for service availability (metric_key starts with 'service.')."""
    rules = await db.get_alert_rules()
    now   = int(time.time())
    for rule in rules:
        if not rule.get("enabled"):
            continue
        key = rule["metric_key"]
        if not key.startswith("service."):
            continue
        if await db.is_silenced(rule["id"]):
            continue
        cooldown   = int(rule.get("cooldown_s", 3600))
        last_fired = int(rule.get("last_fired", 0))
        val = await db.get_metric_latest(key)
        if val is None:
            continue
        # Service alert fires when service is down (value == 0)
        if val == 0.0 and (now - last_fired) > cooldown:
            msg = f"Servicio caído: '{rule['name']}' ({key}) no disponible"
            await db.insert_event(now, "error", "ServiceAlert", msg)
            await db.update_alert_last_fired(rule["id"], now)
            await db.insert_alert_history(now, rule["id"], rule["name"], key, val, 0.0)
            await _dispatch(rule, key, val, 0.0, "==")


async def evaluate():
    if await db.get_global_silence():
        log.info("alerting: global silence active — alerts suppressed")
        return

    rules = await db.get_alert_rules()
    now   = int(time.time())

    for rule in rules:
        if not rule.get("enabled"):
            continue

        # Check if silenced
        if await db.is_silenced(rule["id"]):
            continue

        key       = rule["metric_key"]
        op        = rule["operator"]
        threshold = float(rule["threshold"])
        cooldown  = int(rule.get("cooldown_s", 3600))
        last_fired = int(rule.get("last_fired", 0))

        val = await db.get_metric_latest(key)
        if val is None:
            continue

        fn = _OPS.get(op)
        if fn is None:
            continue

        if fn(val, threshold) and (now - last_fired) > cooldown:
            op_label = _OP_LABELS.get(op, op)
            msg = f"Alerta '{rule['name']}': {key} {op_label} {threshold} (actual: {val:.2f})"
            await db.insert_event(now, "error", "Alert", msg)
            await db.update_alert_last_fired(rule["id"], now)
            await db.insert_alert_history(now, rule["id"], rule["name"], key, val, threshold)
            await _dispatch(rule, key, val, threshold, op_label)


async def _fire_ntfy(rule: dict, key: str, value: float, threshold: float, op_label: str, url: str):
    topic = url[7:]
    if "/" not in topic:
        topic = f"ntfy.sh/{topic}"
    ntfy_url = f"https://{topic}"
    payload = {
        "title":    f"LabDash Alert: {rule['name']}",
        "message":  f"{key} {op_label} {threshold} (actual: {value:.2f})",
        "priority": "high",
        "tags":     ["warning", "labdash"],
    }
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post(ntfy_url, json=payload)
    except Exception as e:
        log.warning("ntfy dispatch failed: %s", e)


async def _fire_email(rule: dict, key: str, value: float, threshold: float, op_label: str, url: str):
    import smtplib, ssl
    from email.mime.text import MIMEText
    from urllib.parse import urlparse
    try:
        parsed    = urlparse(url)
        smtp_host = parsed.hostname or "localhost"
        smtp_port = parsed.port or 587
        smtp_user = parsed.username or ""
        smtp_pass = parsed.password or ""
        to_addr   = parsed.path.lstrip("/")
        if not to_addr:
            return
        subject = f"[LabDash] Alert: {rule['name']}"
        body = (
            f"Alert: {rule['name']}\n"
            f"Metric: {key} {op_label} {threshold}\n"
            f"Value: {value:.2f}\n"
            f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"]    = smtp_user or "labdash@localhost"
        msg["To"]      = to_addr

        def _send():
            ctx = ssl.create_default_context()
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                s.ehlo()
                if smtp_port in (587, 25):
                    s.starttls(context=ctx)
                if smtp_user and smtp_pass:
                    s.login(smtp_user, smtp_pass)
                s.sendmail(smtp_user or "labdash@localhost", to_addr, msg.as_string())
        await asyncio.to_thread(_send)
    except Exception as e:
        log.warning("email dispatch failed: %s", e)


async def _fire_web_push(rule: dict, key: str, value: float, threshold: float, op_label: str):
    try:
        from pywebpush import webpush, WebPushException
        import json as _json
        private_key   = await db.get_setting("vapid_private_key", "")
        if not private_key:
            return
        subscriptions = await db.get_push_subscriptions()
        if not subscriptions:
            return
        payload = _json.dumps({
            "title": f"LabDash Alert: {rule['name']}",
            "body":  f"{key} {op_label} {threshold} (actual: {value:.2f})",
            "tag":   f"alert-{rule['id']}",
        })
        for sub in subscriptions:
            def _send(s=sub):
                try:
                    webpush(
                        subscription_info={
                            "endpoint": s["endpoint"],
                            "keys": {"p256dh": s["p256dh"], "auth": s["auth"]},
                        },
                        data=payload,
                        vapid_private_key=private_key,
                        vapid_claims={"sub": "mailto:labdash@localhost"},
                    )
                except WebPushException as e:
                    if e.response and e.response.status_code in (404, 410):
                        import asyncio as _aio
                        _aio.ensure_future(db.delete_push_subscription(s["endpoint"]))
                except Exception:
                    pass
            await asyncio.to_thread(_send)
    except ImportError:
        pass
    except Exception as e:
        log.warning("web push dispatch failed: %s", e)


async def _fire_telegram(rule: dict, key: str, value: float, threshold: float, op_label: str, url: str):
    """
    Rich Telegram alert with inline silence buttons.
    notify_url format: tg://BOT_TOKEN/CHAT_ID  — or —  tg:// (use stored token/chat_id).
    """
    import telegram as tgmod
    token, chat_id = "", ""

    if url and url != "tg://":
        path  = url[5:]
        slash = path.find("/")
        if slash >= 0:
            token   = path[:slash]
            chat_id = path[slash + 1:]

    # Fall back to stored config
    if not token or not chat_id:
        token, chat_id = await tgmod._get_token_and_chat()

    if not token or not chat_id:
        return

    await tgmod.fire_alert(rule, key, value, threshold, op_label, token=token, chat_id=chat_id)


async def _fire_webhook(rule: dict, key: str, value: float, threshold: float, op_label: str, url: str):
    payload = {
        "text":      f"🚨 LabDash — {rule['name']}: {key} {op_label} {threshold} (valor: {value:.2f})",
        "alert":     rule["name"],
        "metric":    key,
        "value":     value,
        "threshold": threshold,
        "ts":        int(time.time()),
    }
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            await c.post(url, json=payload)
    except Exception as e:
        log.warning("webhook dispatch failed: %s", e)


async def _dispatch(rule: dict, key: str, value: float, threshold: float, op_label: str):
    url = rule.get("notify_url", "").strip()
    # Always try web push
    await _fire_web_push(rule, key, value, threshold, op_label)

    if not url:
        # If no specific URL, still try Telegram if configured globally
        stored_token = await db.get_setting("tg_token", "")
        stored_chat  = await db.get_setting("tg_chat_id", "")
        if stored_token and stored_chat:
            import telegram as tgmod
            await tgmod.fire_alert(rule, key, value, threshold, op_label,
                                   token=stored_token, chat_id=stored_chat)
        return

    if url.startswith("tg://"):
        await _fire_telegram(rule, key, value, threshold, op_label, url)
    elif url.startswith("ntfy://"):
        await _fire_ntfy(rule, key, value, threshold, op_label, url)
    elif url.startswith("smtp://"):
        await _fire_email(rule, key, value, threshold, op_label, url)
    else:
        await _fire_webhook(rule, key, value, threshold, op_label, url)


async def evaluate_unraid():
    """Fire automatic notifications for Unraid disk temperature, capacity, and array state."""
    import unraid as unraid_mod

    if await db.get_global_silence():
        return

    disk_data, disk_err = await unraid_mod.fetch_disks()
    if disk_err or not disk_data:
        return

    # Read configurable thresholds (fall back to sensible defaults)
    temp_warn = float(await db.get_setting("unraid_temp_warn", "") or 50)
    temp_crit = float(await db.get_setting("unraid_temp_crit", "") or 65)
    cap_warn  = float(await db.get_setting("unraid_cap_warn",  "") or 85)
    cap_crit  = float(await db.get_setting("unraid_cap_crit",  "") or 95)

    now = int(time.time())

    # ── Array state ──────────────────────────────────────────────────────────
    arr_state = disk_data.get("status", "")
    if arr_state and arr_state not in ("STARTED", "Started"):
        await db.insert_event(now, "warn", "Unraid",
                              f"Array Unraid no está iniciado: {arr_state}")

    # ── Array capacity ───────────────────────────────────────────────────────
    cap   = disk_data.get("capacity", {})
    total = cap.get("total", 0)
    used  = cap.get("used",  0)
    if total:
        pct = used / total * 100
        if pct >= cap_crit:
            await db.insert_event(now, "error", "Unraid",
                                  f"Array al {pct:.1f}% de capacidad — crítico (umbral: {cap_crit:.0f}%)")
        elif pct >= cap_warn:
            await db.insert_event(now, "warn", "Unraid",
                                  f"Array al {pct:.1f}% de capacidad — espacio bajo (umbral: {cap_warn:.0f}%)")

    # ── Disk temperatures ────────────────────────────────────────────────────
    all_disks = disk_data.get("disks", []) + disk_data.get("parities", [])
    for d in all_disks:
        temp = d.get("temp")
        name = d.get("name") or d.get("device") or "disco"
        if temp is None:
            continue
        if temp >= temp_crit:
            await db.insert_event(now, "error", "Unraid",
                                  f"Disco {name} a {temp}°C — temperatura crítica (umbral: {temp_crit:.0f}°C)")
        elif temp >= temp_warn:
            await db.insert_event(now, "warn", "Unraid",
                                  f"Disco {name} a {temp}°C — temperatura alta (umbral: {temp_warn:.0f}°C)")


async def evaluate_plex():
    """Fire notifications for Plex sessions and transcoding."""
    import plex as plex_mod

    if await db.get_global_silence():
        return

    data, err = await plex_mod.fetch()
    if err or not data:
        return

    now = int(time.time())
    max_streams   = int(await db.get_setting("plex_max_streams",   "") or 10)
    max_transcode = int(await db.get_setting("plex_max_transcode",  "") or 3)

    sessions = data.get("sessions", 0)
    details  = data.get("session_details", [])
    transcoding = sum(1 for s in details if s.get("transcoding"))

    if sessions >= max_streams:
        await db.insert_event(now, "warn", "Plex",
                              f"{sessions} streams activos — límite configurado: {max_streams}")

    if transcoding >= max_transcode:
        await db.insert_event(now, "warn", "Plex",
                              f"{transcoding} transcodificaciones activas — límite configurado: {max_transcode}")


async def evaluate_snmp():
    """Fire notifications for SNMP switch events: port down, high errors, high bandwidth."""
    import snmp as snmp_mod

    if await db.get_global_silence():
        return

    now = int(time.time())
    bw_warn_mbps    = float(await db.get_setting("snmp_bw_warn_pct",  "") or 80)
    err_warn        = int(await db.get_setting("snmp_err_warn",        "") or 100)

    try:
        results, _ = await snmp_mod.fetch_all()
    except Exception:
        return

    for switch in results:
        target = switch.get("target", "switch")
        for port in switch.get("ports", []):
            if not port.get("up"):
                continue
            speed = port.get("speed_mbps", 0) or 0
            if speed > 0:
                in_util  = port.get("in_kbps",  0) / (speed * 1024 / 8) * 100
                out_util = port.get("out_kbps", 0) / (speed * 1024 / 8) * 100
                for direction, util in [("entrada", in_util), ("salida", out_util)]:
                    if util >= bw_warn_mbps:
                        await db.insert_event(now, "warn", f"Switch/{target}",
                            f"Puerto {port['name']}: {direction} al {util:.0f}% ({speed} Mbps)")
            total_err = (port.get("in_errors", 0) or 0) + (port.get("out_errors", 0) or 0)
            key_err = f"{target}:{port['name']}"
            prev_err = _snmp_prev_errors.get(key_err, total_err)
            delta_err = max(total_err - prev_err, 0)
            _snmp_prev_errors[key_err] = total_err
            if delta_err >= err_warn:
                await db.insert_event(now, "warn", f"Switch/{target}",
                    f"Puerto {port['name']}: {delta_err} nuevos errores en el último ciclo (acumulado: {total_err})")


async def run():
    """Infinite loop — call from FastAPI lifespan as asyncio.create_task(run())."""
    await asyncio.sleep(10)
    while True:
        try:
            await evaluate_services()
        except Exception as e:
            log.error("alerting: error inesperado en evaluate_services(): %s", e)
        try:
            await evaluate()
        except Exception as e:
            log.error("alerting: error inesperado en evaluate(): %s", e)
        try:
            await evaluate_unraid()
        except Exception as e:
            log.error("alerting: error inesperado en evaluate_unraid(): %s", e)
        try:
            await evaluate_plex()
        except Exception as e:
            log.error("alerting: error inesperado en evaluate_plex(): %s", e)
        try:
            await evaluate_snmp()
        except Exception as e:
            log.error("alerting: error inesperado en evaluate_snmp(): %s", e)
        await asyncio.sleep(INTERVAL)
