"""Alert evaluation + webhook/Telegram notifications — runs every 60 s."""
import asyncio, time
from datetime import datetime
import httpx
import db

INTERVAL = 60

_OPS = {
    "gt": lambda v, t: v > t,
    "lt": lambda v, t: v < t,
    "eq": lambda v, t: abs(v - t) < 0.001,
    "ne": lambda v, t: abs(v - t) >= 0.001,
    "gte": lambda v, t: v >= t,
    "lte": lambda v, t: v <= t,
}

_OP_LABELS = {
    "gt": ">", "lt": "<", "eq": "=", "ne": "≠", "gte": "≥", "lte": "≤"
}


async def evaluate():
    rules = await db.get_alert_rules()
    now = int(time.time())

    for rule in rules:
        if not rule.get("enabled"):
            continue

        key       = rule["metric_key"]
        op        = rule["operator"]
        threshold = float(rule["threshold"])
        cooldown  = int(rule.get("cooldown_s", 3600))
        last_fired = int(rule.get("last_fired", 0))

        # Get latest metric value
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
            await _dispatch(rule, key, val, threshold, op_label)


async def _dispatch(rule: dict, key: str, value: float, threshold: float, op_label: str):
    url = rule.get("notify_url", "").strip()
    if not url:
        return
    if url.startswith("tg://"):
        await _fire_telegram(rule, key, value, threshold, op_label, url)
    else:
        await _fire_webhook(rule, key, value, threshold, op_label, url)


async def _fire_webhook(rule: dict, key: str, value: float, threshold: float, op_label: str, url: str):
    """Slack/Discord-compatible JSON POST webhook."""
    payload = {
        "text": f"🚨 LabDash — {rule['name']}: {key} {op_label} {threshold} (valor: {value:.2f})",
        "alert": rule["name"],
        "metric": key,
        "value": value,
        "threshold": threshold,
        "ts": int(time.time()),
    }
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            await c.post(url, json=payload)
    except Exception:
        pass


async def _fire_telegram(rule: dict, key: str, value: float, threshold: float, op_label: str, url: str):
    """
    Telegram Bot API.  notify_url format:  tg://BOT_TOKEN/CHAT_ID
    Example: tg://123456789:AABBccDDeeFF.../-100123456789
    Get token from @BotFather, get chat_id from @userinfobot.
    """
    path  = url[5:]  # strip "tg://"
    slash = path.find("/")
    if slash < 0:
        return
    token   = path[:slash]
    chat_id = path[slash + 1:]
    if not token or not chat_id:
        return

    ts_str = datetime.now().strftime("%H:%M:%S")
    text = (
        f"🚨 *LabDash Alert*\n"
        f"*{rule['name']}*\n"
        f"`{key}` {op_label} `{threshold}`\n"
        f"Valor actual: `{value:.2f}`\n"
        f"⏰ {ts_str}"
    )
    tg_url  = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post(tg_url, json=payload)
    except Exception:
        pass


async def run():
    """Infinite loop — call from FastAPI lifespan as asyncio.create_task(run())."""
    await asyncio.sleep(10)
    while True:
        try:
            await evaluate()
        except Exception:
            pass
        await asyncio.sleep(INTERVAL)
