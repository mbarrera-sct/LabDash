"""Concurrent ICMP ping (Linux/Docker via subprocess)."""
import asyncio, time, re

_cache: dict = {"ts": 0.0, "results": {}}
_CACHE_TTL = 10
_IP_RE = re.compile(r'^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{3,39}$')


async def ping_batch(ips: list[str]) -> dict[str, bool]:
    safe = [ip for ip in ips if _IP_RE.match(ip)][:20]
    if not safe:
        return {}
    now = time.time()
    if now - _cache["ts"] < _CACHE_TTL and all(ip in _cache["results"] for ip in safe):
        return {ip: _cache["results"][ip] for ip in safe}
    results = await asyncio.gather(*[_ping_one(ip) for ip in safe], return_exceptions=True)
    out = {ip: (res is True) for ip, res in zip(safe, results)}
    _cache["ts"] = now
    _cache["results"].update(out)
    return out


async def _ping_one(ip: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", "1", ip,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=3)
        return proc.returncode == 0
    except Exception:
        return False
