"""Telegram bot integration for LabDash.

Features:
- Rich alert messages with inline silence buttons
- Bot commands: /status /vms /alerts /silence /help
- Webhook receiver (Telegram → LabDash)
- Auto-register chat_id via /start
- Daily digest (optional)
"""
import asyncio, time, json
from datetime import datetime
import httpx
import db

_BASE = "https://api.telegram.org/bot{token}/{method}"


# ── Low-level helpers ─────────────────────────────────────────────────────────

async def _get_token_and_chat() -> tuple[str, str]:
    """Return (token, chat_id) from settings, or ('', '') if not configured."""
    cfg = await db.get_settings(["tg_token", "tg_chat_id"])
    return cfg.get("tg_token", ""), cfg.get("tg_chat_id", "")


async def _api(token: str, method: str, payload: dict | None = None) -> dict:
    url = _BASE.format(token=token, method=method)
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            if payload:
                r = await c.post(url, json=payload)
            else:
                r = await c.get(url)
        return r.json()
    except Exception as e:
        return {"ok": False, "description": str(e)}


async def send_message(text: str, token: str = "", chat_id: str = "",
                       parse_mode: str = "HTML", reply_markup: dict | None = None) -> dict:
    """Send a message, using stored token/chat_id if not provided."""
    if not token or not chat_id:
        token, chat_id = await _get_token_and_chat()
    if not token or not chat_id:
        return {"ok": False, "description": "Telegram not configured"}
    payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return await _api(token, "sendMessage", payload)


async def get_bot_info(token: str) -> dict:
    return await _api(token, "getMe")


async def set_webhook(token: str, webhook_url: str) -> dict:
    return await _api(token, "setWebhook", {"url": webhook_url, "allowed_updates": ["message", "callback_query"]})


async def delete_webhook(token: str) -> dict:
    return await _api(token, "deleteWebhook")


async def answer_callback(token: str, callback_query_id: str, text: str = "") -> dict:
    return await _api(token, "answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})


async def edit_message_text(token: str, chat_id: str, message_id: int, text: str,
                             parse_mode: str = "HTML", reply_markup: dict | None = None) -> dict:
    payload: dict = {"chat_id": chat_id, "message_id": message_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return await _api(token, "editMessageText", payload)


# ── Rich alert message ────────────────────────────────────────────────────────

_LEVEL_EMOJI = {"gt": "📈", "lt": "📉", "gte": "📈", "lte": "📉", "eq": "🎯", "ne": "⚠️"}
_OP_LABELS   = {"gt": ">", "lt": "<", "eq": "=", "ne": "≠", "gte": "≥", "lte": "≤"}


def build_alert_message(rule: dict, key: str, value: float, threshold: float, op_label: str) -> str:
    ts_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    emoji  = _LEVEL_EMOJI.get(rule.get("operator", "gt"), "🚨")
    pct    = f"{value:.1f}%" if "cpu" in key or "mem" in key else f"{value:.2f}"
    parts  = key.split(".")
    source = parts[1].upper() if len(parts) > 1 else key
    metric = ".".join(parts[2:]) if len(parts) > 2 else key

    return (
        f"🚨 <b>LabDash — Alerta</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"{emoji} <b>{rule['name']}</b>\n\n"
        f"📊 <b>Fuente:</b> <code>{source}</code>\n"
        f"📋 <b>Métrica:</b> <code>{metric or key}</code>\n"
        f"📈 <b>Valor:</b> <code>{pct}</code>  (umbral: {op_label} {threshold})\n"
        f"⏰ <b>Hora:</b> {ts_str}\n"
    )


def build_alert_keyboard(rule_id: int) -> dict:
    """Inline keyboard with silence options."""
    return {
        "inline_keyboard": [[
            {"text": "🔕 1h",  "callback_data": f"silence:{rule_id}:3600"},
            {"text": "🔕 6h",  "callback_data": f"silence:{rule_id}:21600"},
            {"text": "🔕 24h", "callback_data": f"silence:{rule_id}:86400"},
            {"text": "✅ OK",   "callback_data": f"ack:{rule_id}"},
        ]]
    }


async def fire_alert(rule: dict, key: str, value: float, threshold: float, op_label: str,
                     token: str = "", chat_id: str = ""):
    """Send a rich alert with inline silence buttons."""
    text = build_alert_message(rule, key, value, threshold, op_label)
    keyboard = build_alert_keyboard(rule["id"])
    return await send_message(text, token=token, chat_id=chat_id, reply_markup=keyboard)


# ── Command handlers ──────────────────────────────────────────────────────────

async def cmd_start(token: str, chat_id: str, username: str = ""):
    """Auto-register the chat_id and welcome the user."""
    stored_chat = await db.get_setting("tg_chat_id", "")
    if not stored_chat:
        await db.set_setting("tg_chat_id", str(chat_id))
        msg = (
            f"👋 <b>¡Bienvenido a LabDash!</b>\n\n"
            f"Tu chat ha sido registrado automáticamente.\n"
            f"Chat ID: <code>{chat_id}</code>\n\n"
            f"Usa /help para ver los comandos disponibles."
        )
    else:
        msg = (
            f"👋 <b>LabDash Bot</b>\n\n"
            f"Chat ID registrado: <code>{stored_chat}</code>\n"
            f"Usa /help para ver los comandos."
        )
    await send_message(msg, token=token, chat_id=chat_id)


async def cmd_help(token: str, chat_id: str):
    msg = (
        "🤖 <b>LabDash Bot — Comandos</b>\n\n"
        "/status — Resumen del sistema\n"
        "/vms — VMs y contenedores Proxmox\n"
        "/alerts — Reglas de alerta activas\n"
        "/silences — Alertas silenciadas\n"
        "/help — Esta ayuda\n\n"
        "<i>También puedes silenciar alertas usando los botones que aparecen en cada notificación.</i>"
    )
    await send_message(msg, token=token, chat_id=chat_id)


async def cmd_status(token: str, chat_id: str):
    """Quick system status summary from DB metrics."""
    try:
        import proxmox as pv, opnsense as opn
        cfg = await db.get_settings(["proxmox_url", "proxmox_user", "proxmox_pass",
                                     "opnsense_url", "opnsense_key", "opnsense_secret"])

        lines = ["📊 <b>Estado del sistema</b>\n"]

        # Proxmox nodes
        try:
            pv_data = await pv.get_nodes(cfg.get("proxmox_url",""), cfg.get("proxmox_user",""), cfg.get("proxmox_pass",""))
            nodes = pv_data.get("nodes", [])
            online = [n for n in nodes if n.get("status") == "online"]
            lines.append(f"🖥️ <b>Proxmox:</b> {len(online)}/{len(nodes)} nodos online")
        except Exception:
            lines.append("🖥️ <b>Proxmox:</b> sin datos")

        # OPNsense gateways
        try:
            gw_data = await opn.get_gateways(cfg.get("opnsense_url",""), cfg.get("opnsense_key",""), cfg.get("opnsense_secret",""))
            gws = gw_data.get("data", {}).get("items", [])
            up_gws = [g for g in gws if g.get("status_translated") == "Online"]
            lines.append(f"🛡️ <b>Gateways:</b> {len(up_gws)}/{len(gws)} online")
        except Exception:
            lines.append("🛡️ <b>Gateways:</b> sin datos")

        # Latest metrics
        cpu_val = await db.get_metric_latest("pve.cpu.*") or await db.get_metric_latest("pve.cpu.pve")
        if cpu_val is not None:
            lines.append(f"⚡ <b>CPU:</b> {cpu_val:.1f}%")

        lines.append(f"\n⏰ {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
        await send_message("\n".join(lines), token=token, chat_id=chat_id)
    except Exception as e:
        await send_message(f"❌ Error obteniendo estado: {e}", token=token, chat_id=chat_id)


async def cmd_vms(token: str, chat_id: str):
    """List Proxmox VMs."""
    try:
        import proxmox as pv
        cfg = await db.get_settings(["proxmox_url", "proxmox_user", "proxmox_pass"])
        vms_data = await pv.get_vms(cfg.get("proxmox_url",""), cfg.get("proxmox_user",""), cfg.get("proxmox_pass",""))
        by_node = vms_data.get("by_node", {})
        lines = ["🖥️ <b>Proxmox — VMs y LXC</b>\n"]
        for node_name, vms in by_node.items():
            lines.append(f"<b>📦 {node_name}</b>")
            for v in vms:
                if v.get("template"):
                    continue
                icon = "🟢" if v.get("status") == "running" else "🔴"
                vtype = "VM" if v.get("type") == "qemu" else "LXC"
                lines.append(f"  {icon} [{vtype}] {v.get('name','?')} (#{v.get('vmid')})")
        if len(lines) == 1:
            lines.append("Sin VMs disponibles")
        await send_message("\n".join(lines), token=token, chat_id=chat_id)
    except Exception as e:
        await send_message(f"❌ Error obteniendo VMs: {e}", token=token, chat_id=chat_id)


async def cmd_alerts(token: str, chat_id: str):
    """List alert rules."""
    rules = await db.get_alert_rules()
    silences = {s["rule_id"]: s["until_ts"] for s in await db.get_silences()}
    lines = ["🔔 <b>Reglas de alerta</b>\n"]
    if not rules:
        lines.append("No hay reglas configuradas.")
    for r in rules:
        enabled = bool(r.get("enabled"))
        silenced = r["id"] in silences
        icon = "🔕" if silenced else ("✅" if enabled else "❌")
        op_label = _OP_LABELS.get(r["operator"], r["operator"])
        last = ""
        if r.get("last_fired"):
            dt = datetime.fromtimestamp(r["last_fired"]).strftime("%d/%m %H:%M")
            last = f" · última: {dt}"
        sil_txt = ""
        if silenced:
            until = datetime.fromtimestamp(silences[r["id"]]).strftime("%H:%M")
            sil_txt = f" (silenciada hasta {until})"
        lines.append(f"{icon} <b>{r['name']}</b>{sil_txt}\n   <code>{r['metric_key']} {op_label} {r['threshold']}</code>{last}")
    await send_message("\n".join(lines), token=token, chat_id=chat_id)


async def cmd_silences(token: str, chat_id: str):
    silences = await db.get_silences()
    rules    = {r["id"]: r for r in await db.get_alert_rules()}
    if not silences:
        await send_message("✅ No hay alertas silenciadas actualmente.", token=token, chat_id=chat_id)
        return
    lines = ["🔕 <b>Alertas silenciadas</b>\n"]
    for s in silences:
        rule = rules.get(s["rule_id"], {})
        until = datetime.fromtimestamp(s["until_ts"]).strftime("%d/%m/%Y %H:%M")
        rule_name = rule.get("name") or f"Regla #{s['rule_id']}"
        lines.append(f"• <b>{rule_name}</b>\n  hasta {until}")
    await send_message("\n".join(lines), token=token, chat_id=chat_id)


# ── Callback query handler (inline buttons) ───────────────────────────────────

async def handle_callback(token: str, callback_query: dict):
    cq_id   = callback_query.get("id", "")
    data    = callback_query.get("data", "")
    chat_id = str(callback_query.get("message", {}).get("chat", {}).get("id", ""))
    msg_id  = callback_query.get("message", {}).get("message_id")

    if data.startswith("silence:"):
        _, rule_id_str, secs_str = data.split(":")
        rule_id  = int(rule_id_str)
        secs     = int(secs_str)
        until_ts = int(time.time()) + secs
        await db.silence_rule(rule_id, until_ts)

        until_str = datetime.fromtimestamp(until_ts).strftime("%H:%M")
        hours = secs // 3600
        await answer_callback(token, cq_id, f"🔕 Silenciada {hours}h (hasta {until_str})")

        # Edit the original message to remove buttons
        if msg_id:
            rules = {r["id"]: r for r in await db.get_alert_rules()}
            rule  = rules.get(rule_id, {"name": f"Regla #{rule_id}"})
            new_text = (
                callback_query.get("message", {}).get("text", "") +
                f"\n\n🔕 <i>Silenciada {hours}h por usuario</i>"
            )
            await edit_message_text(token, chat_id, msg_id, new_text)

    elif data.startswith("ack:"):
        _, rule_id_str = data.split(":")
        await answer_callback(token, cq_id, "✅ Reconocida")
        if msg_id:
            orig = callback_query.get("message", {}).get("text", "")
            await edit_message_text(token, chat_id, msg_id, orig + "\n\n✅ <i>Reconocida</i>")


# ── Webhook message dispatcher ────────────────────────────────────────────────

async def handle_update(update: dict):
    """Process a Telegram update (message or callback_query)."""
    token, _ = await _get_token_and_chat()
    if not token:
        return

    # Callback query (inline button press)
    if "callback_query" in update:
        await handle_callback(token, update["callback_query"])
        return

    # Regular message
    msg = update.get("message", {})
    if not msg:
        return

    chat_id  = str(msg.get("chat", {}).get("id", ""))
    username = msg.get("from", {}).get("username", "")
    text     = (msg.get("text") or "").strip()

    if not text.startswith("/"):
        return

    cmd = text.split()[0].lower().split("@")[0]

    if cmd == "/start":
        await cmd_start(token, chat_id, username)
    elif cmd == "/help":
        await cmd_help(token, chat_id)
    elif cmd == "/status":
        await cmd_status(token, chat_id)
    elif cmd == "/vms":
        await cmd_vms(token, chat_id)
    elif cmd == "/alerts":
        await cmd_alerts(token, chat_id)
    elif cmd == "/silences":
        await cmd_silences(token, chat_id)
    else:
        await send_message(
            f"❓ Comando desconocido: <code>{cmd}</code>\nUsa /help para ver los disponibles.",
            token=token, chat_id=chat_id
        )


# ── Daily digest ──────────────────────────────────────────────────────────────

async def send_daily_digest():
    """Send a daily summary. Call from scheduler."""
    token, chat_id = await _get_token_and_chat()
    if not token or not chat_id:
        return
    digest_enabled = await db.get_setting("tg_daily_digest", "false")
    if digest_enabled != "true":
        return

    # Alert history last 24h
    history = await db.get_alert_history(limit=100)
    now = int(time.time())
    day_history = [h for h in history if now - h["ts"] < 86400]

    lines = [
        f"📋 <b>LabDash — Resumen diario</b>",
        f"<i>{datetime.now().strftime('%d/%m/%Y')}</i>\n",
    ]

    if day_history:
        lines.append(f"🔔 <b>Alertas disparadas (24h):</b> {len(day_history)}")
        by_rule: dict[str, int] = {}
        for h in day_history:
            by_rule[h["rule_name"]] = by_rule.get(h["rule_name"], 0) + 1
        for name, count in sorted(by_rule.items(), key=lambda x: -x[1]):
            lines.append(f"  • {name}: {count}x")
    else:
        lines.append("✅ Sin alertas en las últimas 24h")

    await send_message("\n".join(lines), token=token, chat_id=chat_id)
