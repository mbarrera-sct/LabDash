"""PostgreSQL backend — mirrors every function in db.py.
Activated when DATABASE_URL env var starts with 'postgres'.

Usage:
    DATABASE_URL=postgresql://user:pass@host:5432/labdash
"""
import json, os, time
import asyncpg

DATABASE_URL = os.environ.get("DATABASE_URL", "")

_pool: asyncpg.Pool | None = None

# ── Schema ────────────────────────────────────────────────────────────────────
_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS diagram (
        id   INTEGER PRIMARY KEY,
        data TEXT
    )
    """,
    "INSERT INTO diagram (id, data) VALUES (1, '{\"nodes\":[],\"edges\":[]}') ON CONFLICT DO NOTHING",
    """
    CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        totp_secret   TEXT,
        totp_enabled  INTEGER DEFAULT 0,
        role          TEXT DEFAULT 'admin'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        expires_at BIGINT NOT NULL,
        is_temp    INTEGER DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS metrics (
        ts    BIGINT NOT NULL,
        key   TEXT NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        PRIMARY KEY (ts, key)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_metrics_key_ts ON metrics (key, ts)",
    """
    CREATE TABLE IF NOT EXISTS events (
        id      SERIAL PRIMARY KEY,
        ts      BIGINT NOT NULL,
        level   TEXT NOT NULL,
        source  TEXT NOT NULL,
        message TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts)",
    """
    CREATE TABLE IF NOT EXISTS uptime_log (
        ts   BIGINT NOT NULL,
        host TEXT NOT NULL,
        up   INTEGER NOT NULL,
        PRIMARY KEY (ts, host)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_uptime_host_ts ON uptime_log (host, ts)",
    """
    CREATE TABLE IF NOT EXISTS alert_rules (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        operator   TEXT NOT NULL,
        threshold  DOUBLE PRECISION NOT NULL,
        notify_url TEXT DEFAULT '',
        cooldown_s INTEGER DEFAULT 3600,
        enabled    INTEGER DEFAULT 1,
        last_fired BIGINT DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id       SERIAL PRIMARY KEY,
        ts       BIGINT NOT NULL,
        username TEXT NOT NULL,
        action   TEXT NOT NULL,
        detail   TEXT DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts)",
    """
    CREATE TABLE IF NOT EXISTS alert_history (
        id         SERIAL PRIMARY KEY,
        ts         BIGINT NOT NULL,
        rule_id    INTEGER NOT NULL,
        rule_name  TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        value      DOUBLE PRECISION NOT NULL,
        threshold  DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_alert_history_ts ON alert_history (ts)",
    """
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at BIGINT NOT NULL
    )
    """,
]

# ── Connection pool ───────────────────────────────────────────────────────────

async def _get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


def _row(r) -> dict | None:
    return dict(r) if r else None


def _rows(rs) -> list[dict]:
    return [dict(r) for r in rs]

# ── Init ──────────────────────────────────────────────────────────────────────

async def init_db():
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for stmt in _TABLES:
                await conn.execute(stmt)
            # Migration: add role column if missing
            await conn.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'"
            )

# ── Settings cache ────────────────────────────────────────────────────────────

_settings_cache: dict = {}
_settings_cache_ts: float = 0.0
_SETTINGS_CACHE_TTL = 30


def _invalidate_settings_cache() -> None:
    global _settings_cache, _settings_cache_ts
    _settings_cache = {}
    _settings_cache_ts = 0.0


async def get_setting(key: str, default: str = "") -> str:
    global _settings_cache, _settings_cache_ts
    now = time.time()
    if now - _settings_cache_ts < _SETTINGS_CACHE_TTL and key in _settings_cache:
        return _settings_cache[key]
    pool = await _get_pool()
    val = await pool.fetchval("SELECT value FROM config WHERE key=$1", key)
    val = val if val is not None else default
    _settings_cache[key] = val
    if _settings_cache_ts == 0.0:
        _settings_cache_ts = now
    return val


async def set_setting(key: str, value: str):
    _invalidate_settings_cache()
    pool = await _get_pool()
    await pool.execute(
        "INSERT INTO config (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        key, value
    )


async def set_settings(data: dict):
    _invalidate_settings_cache()
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for k, v in data.items():
                await conn.execute(
                    "INSERT INTO config (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                    k, str(v)
                )


async def get_settings(keys: list[str]) -> dict:
    global _settings_cache, _settings_cache_ts
    now = time.time()
    if now - _settings_cache_ts < _SETTINGS_CACHE_TTL and all(k in _settings_cache for k in keys):
        return {k: _settings_cache[k] for k in keys}
    pool = await _get_pool()
    rows = await pool.fetch("SELECT key, value FROM config WHERE key = ANY($1::text[])", keys)
    result = {k: "" for k in keys}
    for r in rows:
        result[r["key"]] = r["value"]
    _settings_cache.update(result)
    _settings_cache_ts = now
    return result

# ── Diagram ───────────────────────────────────────────────────────────────────

async def get_diagram() -> dict:
    pool = await _get_pool()
    val = await pool.fetchval("SELECT data FROM diagram WHERE id=1")
    return json.loads(val) if val else {"nodes": [], "edges": []}


async def save_diagram(data: dict):
    pool = await _get_pool()
    await pool.execute(
        "INSERT INTO diagram (id,data) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
        json.dumps(data)
    )

# ── Auth ──────────────────────────────────────────────────────────────────────

async def count_users() -> int:
    pool = await _get_pool()
    return await pool.fetchval("SELECT COUNT(*) FROM users") or 0


async def create_user(username: str, password_hash: str) -> int:
    pool = await _get_pool()
    return await pool.fetchval(
        "INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id",
        username, password_hash
    )


async def get_user_by_username(username: str) -> dict | None:
    pool = await _get_pool()
    row = await pool.fetchrow(
        "SELECT id, username, password_hash, totp_secret, totp_enabled, role FROM users WHERE username=$1",
        username
    )
    return _row(row)


async def get_user_by_id(user_id: int) -> dict | None:
    pool = await _get_pool()
    row = await pool.fetchrow(
        "SELECT id, username, password_hash, totp_secret, totp_enabled, role FROM users WHERE id=$1",
        user_id
    )
    return _row(row)


async def update_user_role(user_id: int, role: str):
    pool = await _get_pool()
    await pool.execute("UPDATE users SET role=$1 WHERE id=$2", role, user_id)


async def update_user_password(user_id: int, password_hash: str):
    pool = await _get_pool()
    await pool.execute("UPDATE users SET password_hash=$1 WHERE id=$2", password_hash, user_id)


async def enable_totp(user_id: int, secret: str):
    pool = await _get_pool()
    await pool.execute(
        "UPDATE users SET totp_secret=$1, totp_enabled=1 WHERE id=$2", secret, user_id
    )


async def disable_totp(user_id: int):
    pool = await _get_pool()
    await pool.execute(
        "UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=$1", user_id
    )


async def set_totp_secret(user_id: int, secret: str):
    pool = await _get_pool()
    await pool.execute("UPDATE users SET totp_secret=$1 WHERE id=$2", secret, user_id)


async def create_session(token: str, user_id: int, expires_at: int, is_temp: bool = False):
    pool = await _get_pool()
    await pool.execute(
        "INSERT INTO sessions (token, user_id, expires_at, is_temp) VALUES ($1,$2,$3,$4)",
        token, user_id, expires_at, 1 if is_temp else 0
    )


async def get_session(token: str) -> tuple | None:
    pool = await _get_pool()
    row = await pool.fetchrow(
        "SELECT token, user_id, expires_at, is_temp FROM sessions WHERE token=$1", token
    )
    return tuple(row.values()) if row else None


async def delete_session(token: str):
    pool = await _get_pool()
    await pool.execute("DELETE FROM sessions WHERE token=$1", token)


async def purge_expired_sessions():
    pool = await _get_pool()
    await pool.execute("DELETE FROM sessions WHERE expires_at < $1", int(time.time()))


async def list_users() -> list[dict]:
    pool = await _get_pool()
    rows = await pool.fetch("SELECT id, username, totp_enabled, role FROM users ORDER BY id")
    return _rows(rows)


async def delete_user(user_id: int):
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM sessions WHERE user_id=$1", user_id)
            await conn.execute("DELETE FROM users WHERE id=$1", user_id)

# ── Metrics ───────────────────────────────────────────────────────────────────

async def insert_metric(ts: int, key: str, value: float):
    pool = await _get_pool()
    await pool.execute(
        "INSERT INTO metrics (ts,key,value) VALUES ($1,$2,$3) ON CONFLICT(ts,key) DO UPDATE SET value=EXCLUDED.value",
        ts, key, float(value)
    )


async def batch_insert_metrics(rows: list[tuple]):
    if not rows:
        return
    pool = await _get_pool()
    await pool.executemany(
        "INSERT INTO metrics (ts,key,value) VALUES ($1,$2,$3) ON CONFLICT(ts,key) DO UPDATE SET value=EXCLUDED.value",
        [(ts, key, float(val)) for ts, key, val in rows]
    )


async def get_metrics(key: str, hours: int = 24, limit: int = 200) -> list[dict]:
    since = int(time.time()) - hours * 3600
    pool = await _get_pool()
    rows = await pool.fetch(
        "SELECT ts, value FROM metrics WHERE key=$1 AND ts>=$2 ORDER BY ts ASC LIMIT $3",
        key, since, limit
    )
    return _rows(rows)


async def get_metric_latest(key: str) -> float | None:
    pool = await _get_pool()
    return await pool.fetchval(
        "SELECT value FROM metrics WHERE key=$1 ORDER BY ts DESC LIMIT 1", key
    )


async def purge_old_metrics(days: int = 7):
    cutoff = int(time.time()) - days * 86400
    pool = await _get_pool()
    await pool.execute("DELETE FROM metrics WHERE ts < $1", cutoff)

# ── Events ────────────────────────────────────────────────────────────────────

async def insert_event(ts: int, level: str, source: str, message: str):
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO events (ts,level,source,message) VALUES ($1,$2,$3,$4)",
                ts, level, source, message
            )
            await conn.execute(
                "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT 500)"
            )


async def get_events(limit: int = 50) -> list[dict]:
    pool = await _get_pool()
    rows = await pool.fetch(
        "SELECT id, ts, level, source, message FROM events ORDER BY ts DESC LIMIT $1", limit
    )
    return _rows(rows)

# ── Uptime ────────────────────────────────────────────────────────────────────

async def insert_uptime(ts: int, host: str, up: bool):
    pool = await _get_pool()
    await pool.execute(
        "INSERT INTO uptime_log (ts,host,up) VALUES ($1,$2,$3) ON CONFLICT(ts,host) DO UPDATE SET up=EXCLUDED.up",
        ts, host, 1 if up else 0
    )


async def batch_insert_uptime(rows: list[tuple]):
    if not rows:
        return
    pool = await _get_pool()
    await pool.executemany(
        "INSERT INTO uptime_log (ts,host,up) VALUES ($1,$2,$3) ON CONFLICT(ts,host) DO UPDATE SET up=EXCLUDED.up",
        [(ts, host, 1 if up else 0) for ts, host, up in rows]
    )


async def get_uptime_pct(host: str, hours: int = 24) -> float:
    since = int(time.time()) - hours * 3600
    pool = await _get_pool()
    row = await pool.fetchrow(
        "SELECT COUNT(*) as total, SUM(up) as up_count FROM uptime_log WHERE host=$1 AND ts>=$2",
        host, since
    )
    total    = row["total"]    if row else 0
    up_count = row["up_count"] if row else 0
    if not total:
        return -1.0
    return round((up_count or 0) / total * 100, 1)


async def purge_old_uptime(days: int = 30):
    cutoff = int(time.time()) - days * 86400
    pool = await _get_pool()
    await pool.execute("DELETE FROM uptime_log WHERE ts < $1", cutoff)

# ── Alert rules ───────────────────────────────────────────────────────────────

async def get_alert_rules() -> list[dict]:
    pool = await _get_pool()
    rows = await pool.fetch("SELECT * FROM alert_rules ORDER BY id")
    return _rows(rows)


async def create_alert_rule(
    name: str, metric_key: str, operator: str,
    threshold: float, notify_url: str = "", cooldown_s: int = 3600
) -> int:
    pool = await _get_pool()
    return await pool.fetchval(
        "INSERT INTO alert_rules (name,metric_key,operator,threshold,notify_url,cooldown_s) "
        "VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        name, metric_key, operator, threshold, notify_url, cooldown_s
    )


async def delete_alert_rule(rule_id: int):
    pool = await _get_pool()
    await pool.execute("DELETE FROM alert_rules WHERE id=$1", rule_id)


async def toggle_alert_rule(rule_id: int, enabled: bool):
    pool = await _get_pool()
    await pool.execute(
        "UPDATE alert_rules SET enabled=$1 WHERE id=$2", 1 if enabled else 0, rule_id
    )


async def update_alert_last_fired(rule_id: int, ts: int):
    pool = await _get_pool()
    await pool.execute("UPDATE alert_rules SET last_fired=$1 WHERE id=$2", ts, rule_id)

# ── Audit log ─────────────────────────────────────────────────────────────────

async def insert_audit(ts: int, username: str, action: str, detail: str = ""):
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO audit_log (ts,username,action,detail) VALUES ($1,$2,$3,$4)",
                ts, username, action, detail
            )
            await conn.execute(
                "DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY ts DESC LIMIT 1000)"
            )


async def get_audit_log(limit: int = 100) -> list[dict]:
    pool = await _get_pool()
    rows = await pool.fetch(
        "SELECT id,ts,username,action,detail FROM audit_log ORDER BY ts DESC LIMIT $1", limit
    )
    return _rows(rows)

# ── Alert history ─────────────────────────────────────────────────────────────

async def insert_alert_history(ts: int, rule_id: int, rule_name: str, metric_key: str, value: float, threshold: float):
    pool = await _get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO alert_history (ts,rule_id,rule_name,metric_key,value,threshold) VALUES ($1,$2,$3,$4,$5,$6)",
                ts, rule_id, rule_name, metric_key, float(value), float(threshold)
            )
            await conn.execute(
                "DELETE FROM alert_history WHERE id NOT IN (SELECT id FROM alert_history ORDER BY ts DESC LIMIT 500)"
            )


async def get_alert_history(limit: int = 100) -> list[dict]:
    pool = await _get_pool()
    rows = await pool.fetch(
        "SELECT id,ts,rule_id,rule_name,metric_key,value,threshold FROM alert_history ORDER BY ts DESC LIMIT $1",
        limit
    )
    return _rows(rows)

# ── Push subscriptions ────────────────────────────────────────────────────────

async def save_push_subscription(user_id: int, endpoint: str, p256dh: str, auth_key: str):
    pool = await _get_pool()
    await pool.execute(
        "INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth,created_at) VALUES ($1,$2,$3,$4,$5) "
        "ON CONFLICT(endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth",
        user_id, endpoint, p256dh, auth_key, int(time.time())
    )


async def delete_push_subscription(endpoint: str):
    pool = await _get_pool()
    await pool.execute("DELETE FROM push_subscriptions WHERE endpoint=$1", endpoint)


async def get_push_subscriptions() -> list[dict]:
    pool = await _get_pool()
    rows = await pool.fetch("SELECT * FROM push_subscriptions")
    return _rows(rows)

# ── Sessions ──────────────────────────────────────────────────────────────────

async def list_active_sessions(user_id: int) -> list[dict]:
    now = int(time.time())
    pool = await _get_pool()
    rows = await pool.fetch(
        "SELECT token, expires_at, is_temp FROM sessions WHERE user_id=$1 AND expires_at>$2 AND is_temp=0 ORDER BY expires_at DESC",
        user_id, now
    )
    return [{"token_hint": r["token"][:8] + "…", "expires_at": r["expires_at"], "token": r["token"]} for r in rows]
