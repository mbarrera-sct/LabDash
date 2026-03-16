"""SQLite config + diagram store + auth."""
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
"""

async def _db():
    return aiosqlite.connect(DB_PATH)

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_CREATE)
        await db.commit()

async def get_setting(key: str, default: str = "") -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM config WHERE key=?", (key,)) as cur:
            row = await cur.fetchone()
            return row[0] if row else default

async def set_setting(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value)
        )
        await db.commit()

async def set_settings(data: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        for k, v in data.items():
            await db.execute(
                "INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, str(v))
            )
        await db.commit()

async def get_settings(keys: list[str]) -> dict:
    result = {}
    async with aiosqlite.connect(DB_PATH) as db:
        for k in keys:
            async with db.execute("SELECT value FROM config WHERE key=?", (k,)) as cur:
                row = await cur.fetchone()
                result[k] = row[0] if row else ""
    return result

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

# ── Auth helpers ──────────────────────────────────────────────────────────────

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
    """Store pending TOTP secret (not yet enabled)."""
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
