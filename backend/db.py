"""SQLite config + diagram store + auth + metrics + events + alerts."""
import json, os, time
import aiosqlite

DB_PATH = os.environ.get("DB_PATH", "/data/labdash.db")

_CREATE = """
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS diagram (id INTEGER PRIMARY KEY, data TEXT);
INSERT OR IGNORE INTO diagram (id, data) VALUES (1, '{"nodes":[],"edges":[]}');
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    totp_secret   TEXT,
    totp_enabled  INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    is_temp    INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS metrics (
    ts    INTEGER NOT NULL,
    key   TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (ts, key)
);
CREATE INDEX IF NOT EXISTS idx_metrics_key_ts ON metrics (key, ts);
CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    level   TEXT NOT NULL,
    source  TEXT NOT NULL,
    message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS uptime_log (
    ts   INTEGER NOT NULL,
    host TEXT NOT NULL,
    up   INTEGER NOT NULL,
    PRIMARY KEY (ts, host)
);
CREATE INDEX IF NOT EXISTS idx_uptime_host_ts ON uptime_log (host, ts);
CREATE TABLE IF NOT EXISTS alert_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    metric_key  TEXT NOT NULL,
    operator    TEXT NOT NULL,
    threshold   REAL NOT NULL,
    notify_url  TEXT DEFAULT '',
    cooldown_s  INTEGER DEFAULT 3600,
    enabled     INTEGER DEFAULT 1,
    last_fired  INTEGER DEFAULT 0
);
"""

# ── Init ──────────────────────────────────────────────────────────────────────

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_CREATE)
        await db.executescript(
            "PRAGMA journal_mode=WAL;"
            "PRAGMA synchronous=NORMAL;"
            "PRAGMA cache_size=10000;"
            "PRAGMA temp_store=MEMORY;"
            "PRAGMA mmap_size=134217728;"  # 128 MB
        )
        await db.commit()

# ── Config ────────────────────────────────────────────────────────────────────
# In-memory settings cache to avoid a DB round-trip on every API call
_settings_cache: dict = {}       # key -> value
_settings_cache_ts: float = 0.0
_SETTINGS_CACHE_TTL = 30         # seconds


def _invalidate_settings_cache() -> None:
    global _settings_cache, _settings_cache_ts
    _settings_cache = {}
    _settings_cache_ts = 0.0


async def get_setting(key: str, default: str = "") -> str:
    global _settings_cache, _settings_cache_ts
    now = time.time()
    if now - _settings_cache_ts < _SETTINGS_CACHE_TTL and key in _settings_cache:
        return _settings_cache[key]
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM config WHERE key=?", (key,)) as cur:
            row = await cur.fetchone()
            val = row[0] if row else default
    _settings_cache[key] = val
    if _settings_cache_ts == 0.0:
        _settings_cache_ts = now
    return val

async def set_setting(key: str, value: str):
    _invalidate_settings_cache()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value)
        )
        await db.commit()

async def set_settings(data: dict):
    _invalidate_settings_cache()
    async with aiosqlite.connect(DB_PATH) as db:
        for k, v in data.items():
            await db.execute(
                "INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, str(v))
            )
        await db.commit()

async def get_settings(keys: list[str]) -> dict:
    global _settings_cache, _settings_cache_ts
    now = time.time()
    # Return from cache if fresh and all keys present
    if now - _settings_cache_ts < _SETTINGS_CACHE_TTL and all(k in _settings_cache for k in keys):
        return {k: _settings_cache[k] for k in keys}
    result = {}
    async with aiosqlite.connect(DB_PATH) as db:
        for k in keys:
            async with db.execute("SELECT value FROM config WHERE key=?", (k,)) as cur:
                row = await cur.fetchone()
                result[k] = row[0] if row else ""
    _settings_cache.update(result)
    _settings_cache_ts = now
    return result

# ── Diagram ───────────────────────────────────────────────────────────────────

async def get_diagram() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT data FROM diagram WHERE id=1") as cur:
            row = await cur.fetchone()
            return json.loads(row[0]) if row else {"nodes": [], "edges": []}

async def save_diagram(data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO diagram (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (json.dumps(data),)
        )
        await db.commit()

# ── Auth ──────────────────────────────────────────────────────────────────────

async def count_users() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM users") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0

async def create_user(username: str, password_hash: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?,?)",
            (username, password_hash)
        )
        await db.commit()
        return cur.lastrowid

async def get_user_by_username(username: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, username, password_hash, totp_secret, totp_enabled FROM users WHERE username=?",
            (username,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

async def get_user_by_id(user_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, username, password_hash, totp_secret, totp_enabled FROM users WHERE id=?",
            (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

async def update_user_password(user_id: int, password_hash: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET password_hash=? WHERE id=?", (password_hash, user_id)
        )
        await db.commit()

async def enable_totp(user_id: int, secret: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET totp_secret=?, totp_enabled=1 WHERE id=?", (secret, user_id)
        )
        await db.commit()

async def disable_totp(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=?", (user_id,)
        )
        await db.commit()

async def set_totp_secret(user_id: int, secret: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET totp_secret=? WHERE id=?", (secret, user_id)
        )
        await db.commit()

async def create_session(token: str, user_id: int, expires_at: int, is_temp: bool = False):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO sessions (token, user_id, expires_at, is_temp) VALUES (?,?,?,?)",
            (token, user_id, expires_at, 1 if is_temp else 0)
        )
        await db.commit()

async def get_session(token: str) -> tuple | None:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT token, user_id, expires_at, is_temp FROM sessions WHERE token=?", (token,)
        ) as cur:
            return await cur.fetchone()

async def delete_session(token: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE token=?", (token,))
        await db.commit()

async def purge_expired_sessions():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        await db.commit()

async def list_users() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, username, totp_enabled FROM users ORDER BY id"
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

async def delete_user(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        await db.execute("DELETE FROM users WHERE id=?", (user_id,))
        await db.commit()

# ── Metrics ───────────────────────────────────────────────────────────────────

async def insert_metric(ts: int, key: str, value: float):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO metrics (ts, key, value) VALUES (?,?,?)",
            (ts, key, float(value))
        )
        await db.commit()

async def batch_insert_metrics(rows: list[tuple]):
    """Insert multiple (ts, key, value) tuples in a single connection."""
    if not rows:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executemany(
            "INSERT OR REPLACE INTO metrics (ts, key, value) VALUES (?,?,?)",
            [(ts, key, float(val)) for ts, key, val in rows]
        )
        await db.commit()

async def get_metrics(key: str, hours: int = 24, limit: int = 200) -> list[dict]:
    since = int(time.time()) - hours * 3600
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT ts, value FROM metrics WHERE key=? AND ts>=? ORDER BY ts ASC LIMIT ?",
            (key, since, limit)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

async def get_metric_latest(key: str) -> float | None:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT value FROM metrics WHERE key=? ORDER BY ts DESC LIMIT 1", (key,)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else None

async def purge_old_metrics(days: int = 7):
    cutoff = int(time.time()) - days * 86400
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM metrics WHERE ts < ?", (cutoff,))
        await db.commit()

# ── Events ────────────────────────────────────────────────────────────────────

async def insert_event(ts: int, level: str, source: str, message: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO events (ts, level, source, message) VALUES (?,?,?,?)",
            (ts, level, source, message)
        )
        # Keep only last 500 events
        await db.execute(
            "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT 500)"
        )
        await db.commit()

async def get_events(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, ts, level, source, message FROM events ORDER BY ts DESC LIMIT ?",
            (limit,)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

# ── Uptime log ────────────────────────────────────────────────────────────────

async def insert_uptime(ts: int, host: str, up: bool):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO uptime_log (ts, host, up) VALUES (?,?,?)",
            (ts, host, 1 if up else 0)
        )
        await db.commit()

async def batch_insert_uptime(rows: list[tuple]):
    """Insert multiple (ts, host, up) tuples in a single connection."""
    if not rows:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executemany(
            "INSERT OR REPLACE INTO uptime_log (ts, host, up) VALUES (?,?,?)",
            [(ts, host, 1 if up else 0) for ts, host, up in rows]
        )
        await db.commit()

async def get_uptime_pct(host: str, hours: int = 24) -> float:
    since = int(time.time()) - hours * 3600
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) as total, SUM(up) as up_count FROM uptime_log WHERE host=? AND ts>=?",
            (host, since)
        ) as cur:
            row = await cur.fetchone()
            total, up_count = row
            if not total:
                return -1.0
            return round((up_count or 0) / total * 100, 1)

async def purge_old_uptime(days: int = 30):
    cutoff = int(time.time()) - days * 86400
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM uptime_log WHERE ts < ?", (cutoff,))
        await db.commit()

# ── Alert rules ───────────────────────────────────────────────────────────────

async def get_alert_rules() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM alert_rules ORDER BY id") as cur:
            return [dict(r) for r in await cur.fetchall()]

async def create_alert_rule(
    name: str, metric_key: str, operator: str,
    threshold: float, notify_url: str = "", cooldown_s: int = 3600
) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO alert_rules (name, metric_key, operator, threshold, notify_url, cooldown_s) VALUES (?,?,?,?,?,?)",
            (name, metric_key, operator, threshold, notify_url, cooldown_s)
        )
        await db.commit()
        return cur.lastrowid

async def delete_alert_rule(rule_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM alert_rules WHERE id=?", (rule_id,))
        await db.commit()

async def toggle_alert_rule(rule_id: int, enabled: bool):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE alert_rules SET enabled=? WHERE id=?", (1 if enabled else 0, rule_id)
        )
        await db.commit()

async def update_alert_last_fired(rule_id: int, ts: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE alert_rules SET last_fired=? WHERE id=?", (ts, rule_id)
        )
        await db.commit()
