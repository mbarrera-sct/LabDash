"""SQLite config + diagram store."""
import json, os
import aiosqlite

DB_PATH = os.environ.get("DB_PATH", "/data/labdash.db")

_CREATE = """
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS diagram (id INTEGER PRIMARY KEY, data TEXT);
INSERT OR IGNORE INTO diagram (id, data) VALUES (1, '{"nodes":[],"edges":[]}');
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
