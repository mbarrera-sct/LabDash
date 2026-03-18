"""Async Kubernetes API client — supports multiple clusters via k8s_clusters JSON config."""
import json, time, os
import httpx
from db import get_setting

TTL = 30

# In-cluster paths
_SA_TOKEN = "/var/run/secrets/kubernetes.io/serviceaccount/token"
_SA_CA    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"

# Per-cluster cache: name -> {"data": ..., "ts": ...}
_cluster_cache: dict = {}


async def get_clusters() -> list[dict]:
    """Return list of {name, url, token} from k8s_clusters JSON, with legacy fallback."""
    clusters_json = await get_setting("k8s_clusters", "")
    if clusters_json:
        try:
            clusters = json.loads(clusters_json)
            if isinstance(clusters, list) and clusters:
                return clusters
        except Exception:
            pass
    # Legacy single-cluster fallback
    url   = await get_setting("k8s_url",   os.environ.get("K8S_URL",   ""))
    token = await get_setting("k8s_token", os.environ.get("K8S_TOKEN", ""))
    if not url and os.path.exists(_SA_TOKEN):
        url   = "https://kubernetes.default.svc"
        token = open(_SA_TOKEN).read().strip()
        return [{"name": "in-cluster", "url": url, "token": token, "verify": _SA_CA if os.path.exists(_SA_CA) else False}]
    if url and token:
        return [{"name": "default", "url": url, "token": token, "verify": False}]
    return []


async def _fetch_cluster(cluster: dict) -> tuple[dict, str | None]:
    name   = cluster.get("name", "default")
    url    = cluster.get("url", "")
    token  = cluster.get("token", "")
    verify = cluster.get("verify", False)
    cache  = _cluster_cache.get(name, {"data": None, "ts": 0})
    if cache["data"] and time.time() - cache["ts"] < TTL:
        return cache["data"], None
    try:
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=url, verify=verify, timeout=10, headers=headers) as c:
            nodes       = (await c.get("/api/v1/nodes")).json()
            deployments = (await c.get("/apis/apps/v1/deployments")).json()
            pods        = (await c.get("/api/v1/pods")).json()
        data = {"nodes": nodes, "deployments": deployments, "pods": pods, "cluster": name}
        _cluster_cache[name] = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return cache.get("data") or {}, str(e)


async def fetch() -> tuple[dict, str | None]:
    """Fetch from first available cluster (backward compat for single-cluster callers)."""
    clusters = await get_clusters()
    if not clusters:
        return {}, "Kubernetes credentials not configured"
    data, err = await _fetch_cluster(clusters[0])
    return data, err


async def fetch_all() -> tuple[list[dict], list[str]]:
    """Fetch from all clusters and return aggregated list of (data, errors)."""
    clusters = await get_clusters()
    if not clusters:
        return [], ["Kubernetes credentials not configured"]
    results, errors = [], []
    for cluster in clusters:
        data, err = await _fetch_cluster(cluster)
        if data:
            results.append({"cluster": cluster.get("name", "default"), **data})
        if err:
            errors.append(f"{cluster.get('name', 'default')}: {err}")
    return results, errors
