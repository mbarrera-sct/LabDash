"""MXHOME LabDash — FastAPI backend."""
import asyncio, os, time
from collections import defaultdict
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

import db, proxmox, opnsense, k8s, unraid, plex, immich, homeassistant, templates

FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    yield

app = FastAPI(title="LabDash", lifespan=lifespan)

# ──────────────────────────────────────────────────────────────
# Healthz
# ──────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz():
    return "ok"

# ──────────────────────────────────────────────────────────────
# Proxmox
# ──────────────────────────────────────────────────────────────
@app.get("/api/proxmox/nodes")
async def pve_nodes():
    data, err = await proxmox.fetch()
    nodes_raw = data.get("nodes", []) if data else []
    resources = data.get("resources", []) if data else []
    by_node = defaultdict(lambda: {"vms": 0, "lxc": 0, "running": 0, "templates": 0})
    for r in resources:
        t = r.get("type")
        n = r.get("node", "")
        if t in ("qemu", "lxc"):
            if r.get("template"):
                by_node[n]["templates"] += 1
            else:
                by_node[n]["vms" if t == "qemu" else "lxc"] += 1
                if r.get("status") == "running":
                    by_node[n]["running"] += 1
    nodes = [
        {
            "name": n.get("node"),
            "status": n.get("status"),
            "cpu": round(n.get("cpu", 0) * 100, 1),
            "mem_used": n.get("mem", 0),
            "mem_max": n.get("maxmem", 1),
            "uptime": n.get("uptime", 0),
            **by_node.get(n.get("node", ""), {}),
        }
        for n in nodes_raw
    ]
    return {"nodes": nodes, "error": err}

@app.get("/api/proxmox/vms")
async def pve_vms():
    data, err = await proxmox.fetch()
    resources = data.get("resources", []) if data else []
    items = [r for r in resources if r.get("type") in ("qemu", "lxc")]
    by_node = defaultdict(list)
    for r in items:
        by_node[r["node"]].append({
            "vmid":     r.get("vmid"),
            "name":     r.get("name", ""),
            "type":     r.get("type"),
            "status":   r.get("status"),
            "template": bool(r.get("template")),
            "maxmem":   r.get("maxmem", 0),
            "maxdisk":  r.get("maxdisk", 0),
            "cpu":      round(r.get("cpu", 0) * 100, 1),
            "uptime":   r.get("uptime", 0),
        })
    return {"by_node": dict(by_node), "error": err}

# ──────────────────────────────────────────────────────────────
# OPNsense
# ──────────────────────────────────────────────────────────────
@app.get("/api/opnsense/interfaces")
async def opn_interfaces():
    data, err = await opnsense.fetch()
    return {"data": data.get("interfaces", {}) if data else {}, "error": err}

@app.get("/api/opnsense/gateways")
async def opn_gateways():
    data, err = await opnsense.fetch()
    return {"data": data.get("gateways", {}) if data else {}, "error": err}

# ──────────────────────────────────────────────────────────────
# Kubernetes
# ──────────────────────────────────────────────────────────────
@app.get("/api/k8s/nodes")
async def k8s_nodes():
    data, err = await k8s.fetch()
    if not data:
        return {"nodes": [], "error": err}
    raw_nodes = data.get("nodes", {}).get("items", [])
    nodes = [
        {
            "name": n["metadata"]["name"],
            "ready": any(
                c["type"] == "Ready" and c["status"] == "True"
                for c in n.get("status", {}).get("conditions", [])
            ),
            "roles": [k.split("/")[-1] for k in n["metadata"].get("labels", {}) if "node-role.kubernetes.io/" in k],
            "version": n.get("status", {}).get("nodeInfo", {}).get("kubeletVersion", ""),
        }
        for n in raw_nodes
    ]
    return {"nodes": nodes, "error": err}

@app.get("/api/k8s/workloads")
async def k8s_workloads():
    data, err = await k8s.fetch()
    if not data:
        return {"namespaces": {}, "error": err}
    deployments = data.get("deployments", {}).get("items", [])
    pods        = data.get("pods", {}).get("items", [])
    by_ns: dict = defaultdict(lambda: {"deployments": [], "pod_count": 0, "running_pods": 0})
    for d in deployments:
        ns   = d["metadata"]["namespace"]
        name = d["metadata"]["name"]
        ready   = d.get("status", {}).get("readyReplicas", 0) or 0
        desired = d.get("spec", {}).get("replicas", 0) or 0
        by_ns[ns]["deployments"].append({"name": name, "ready": ready, "desired": desired})
    for p in pods:
        ns = p["metadata"]["namespace"]
        phase = p.get("status", {}).get("phase", "")
        by_ns[ns]["pod_count"] += 1
        if phase == "Running":
            by_ns[ns]["running_pods"] += 1
    return {"namespaces": dict(by_ns), "error": err}

# ──────────────────────────────────────────────────────────────
# Unraid
# ──────────────────────────────────────────────────────────────
@app.get("/api/unraid/system")
async def unraid_system():
    data, err = await unraid.fetch()
    return {"data": data.get("system", {}) if data else {}, "error": err}

@app.get("/api/unraid/docker")
async def unraid_docker():
    data, err = await unraid.fetch()
    return {"containers": data.get("docker", []) if data else [], "error": err}

# ──────────────────────────────────────────────────────────────
# Plex
# ──────────────────────────────────────────────────────────────
@app.get("/api/plex/info")
async def plex_info():
    data, err = await plex.fetch()
    return {"data": data or {}, "error": err}

# ──────────────────────────────────────────────────────────────
# Immich
# ──────────────────────────────────────────────────────────────
@app.get("/api/immich/stats")
async def immich_stats():
    data, err = await immich.fetch()
    return {"data": data or {}, "error": err}

# ──────────────────────────────────────────────────────────────
# Home Assistant
# ──────────────────────────────────────────────────────────────
@app.get("/api/ha/states")
async def ha_states():
    data, err = await homeassistant.fetch()
    return {"states": data.get("states", []) if data else [], "error": err}

# ──────────────────────────────────────────────────────────────
# Aggregate status
# ──────────────────────────────────────────────────────────────
@app.get("/api/status")
async def status():
    pve_data, pve_err = await proxmox.fetch()
    resources  = pve_data.get("resources", []) if pve_data else []
    nodes_raw  = pve_data.get("nodes", []) if pve_data else []
    vms        = [r for r in resources if r.get("type") in ("qemu","lxc") and not r.get("template")]
    running    = [v for v in vms if v.get("status") == "running"]
    templates  = [r for r in resources if r.get("type") in ("qemu","lxc") and r.get("template")]

    k8s_data, _ = await k8s.fetch()
    k8s_nodes  = len(k8s_data.get("nodes", {}).get("items", [])) if k8s_data else 0

    opn_data, _ = await opnsense.fetch()
    gw_items    = opn_data.get("gateways", {}).get("items", []) if opn_data else []
    wan_up      = sum(1 for g in gw_items if g.get("status_translated") == "Online")

    return {
        "proxmox": {
            "nodes":     len(nodes_raw),
            "vms_total": len(vms),
            "running":   len(running),
            "templates": len(templates),
            "error":     pve_err,
        },
        "k8s": {
            "nodes": k8s_nodes,
            "error": None,
        },
        "opnsense": {
            "wan_up": wan_up,
            "gateways": len(gw_items),
        },
        "ts": int(time.time()),
    }

# ──────────────────────────────────────────────────────────────
# Diagram CRUD
# ──────────────────────────────────────────────────────────────
@app.get("/api/diagram")
async def get_diagram():
    return await db.get_diagram()

@app.post("/api/diagram")
async def save_diagram(payload: dict):
    await db.save_diagram(payload)
    return {"ok": True}

# ──────────────────────────────────────────────────────────────
# Diagram templates
# ──────────────────────────────────────────────────────────────
@app.get("/api/templates")
async def list_templates():
    return [
        {"id": k, "name": v["name"], "description": v["description"]}
        for k, v in templates.TEMPLATES.items()
    ]

@app.get("/api/templates/{template_id}")
async def get_template(template_id: str):
    tpl = templates.TEMPLATES.get(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl["diagram"]

# ──────────────────────────────────────────────────────────────
# Settings
# ──────────────────────────────────────────────────────────────
ALL_KEYS = [
    "pve_url", "pve_user", "pve_pass",
    "opn_url", "opn_key", "opn_secret",
    "k8s_url", "k8s_token",
    "unraid_url", "unraid_key",
    "plex_url", "plex_token",
    "immich_url", "immich_key",
    "ha_url", "ha_token", "ha_entities",
]
SECRET_KEYS = {"pve_pass", "opn_key", "opn_secret", "k8s_token", "unraid_key", "plex_token", "immich_key", "ha_token"}

@app.get("/api/settings")
async def get_settings():
    raw = await db.get_settings(ALL_KEYS)
    return {k: ("***" if k in SECRET_KEYS and raw[k] else raw[k]) for k in ALL_KEYS}

@app.post("/api/settings")
async def save_settings(payload: dict):
    # Only save keys we know about; skip masked values
    filtered = {k: v for k, v in payload.items() if k in ALL_KEYS and v != "***"}
    await db.set_settings(filtered)
    # Invalidate caches
    proxmox._cache = {"data": None, "ts": 0}
    opnsense._cache = {"data": None, "ts": 0}
    k8s._cache = {"data": None, "ts": 0}
    unraid._cache = {"data": None, "ts": 0}
    plex._cache = {"data": None, "ts": 0}
    immich._cache = {"data": None, "ts": 0}
    homeassistant._cache = {"data": None, "ts": 0}
    return {"ok": True}

# ──────────────────────────────────────────────────────────────
# Serve React SPA (must come last)
# ──────────────────────────────────────────────────────────────
if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        file = FRONTEND / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND / "index.html")
