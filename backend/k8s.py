"""Async Kubernetes API client (in-cluster or token-based)."""
import time, os
import httpx
from db import get_setting

_cache: dict = {"data": None, "ts": 0}
TTL = 30

# In-cluster paths
_SA_TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token"
_SA_CA    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"

async def _creds() -> tuple[str, str, bool]:
    """Returns (url, token, verify_ssl)."""
    url   = await get_setting("k8s_url",   os.environ.get("K8S_URL",   ""))
    token = await get_setting("k8s_token", os.environ.get("K8S_TOKEN", ""))
    # Auto-detect in-cluster
    if not url and os.path.exists(_SA_TOKEN):
        url   = "https://kubernetes.default.svc"
        token = open(_SA_TOKEN).read().strip()
        return url, token, _SA_CA if os.path.exists(_SA_CA) else False
    return url, token, False

async def fetch() -> tuple[dict, str | None]:
    global _cache
    if _cache["data"] and time.time() - _cache["ts"] < TTL:
        return _cache["data"], None
    try:
        url, token, verify = await _creds()
        if not (url and token):
            return _cache.get("data") or {}, "Kubernetes credentials not configured"

        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=url, verify=verify, timeout=10, headers=headers) as c:
            nodes       = (await c.get("/api/v1/nodes")).json()
            deployments = (await c.get("/apis/apps/v1/deployments")).json()
            pods        = (await c.get("/api/v1/pods")).json()

        data = {"nodes": nodes, "deployments": deployments, "pods": pods}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache.get("data") or {}, str(e)
