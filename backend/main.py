"""MXHOME LabDash — FastAPI backend."""
import asyncio, os, time
from collections import defaultdict
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db, proxmox, opnsense, k8s, unraid, plex, immich, homeassistant, templates, auth

FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"

# ── Public paths (no auth required) ──────────────────────────────────────────
PUBLIC_PREFIXES = ("/healthz", "/api/auth/", "/assets/")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await db.purge_expired_sessions()
    await auth.create_admin_if_needed()
    yield

app = FastAPI(title="LabDash", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth middleware ───────────────────────────────────────────────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Allow public paths
    if any(path.startswith(p) for p in PUBLIC_PREFIXES):
        return await call_next(request)
    # Allow SPA root + non-api paths
    if not path.startswith("/api/"):
        return await call_next(request)
    # Require auth for all /api/* except /api/auth/*
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("labdash_session")
    if not token:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    user = await auth.verify_session(token)
    if not user:
        return JSONResponse({"detail": "Session expired"}, status_code=401)
    request.state.user = user
    return await call_next(request)

# ── Pydantic models ───────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

class TotpVerifyRequest(BaseModel):
    temp_token: str
    code: str

class TotpSetupConfirmRequest(BaseModel):
    temp_token: str
    code: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

# ── Auth routes ───────────────────────────────────────────────────────────────
@app.post("/api/auth/login")
async def login(body: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    auth.check_rate_limit(ip)

    user = await db.get_user_by_username(body.username)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    auth.clear_rate_limit(ip)
    temp_token = await auth.create_session(user["id"], is_temp=True)

    return {
        "temp_token": temp_token,
        "needs_totp": bool(user["totp_enabled"]),
        "needs_totp_setup": not bool(user["totp_enabled"]),
    }

@app.post("/api/auth/verify-totp")
async def verify_totp(body: TotpVerifyRequest):
    user = await auth.verify_session(body.temp_token, require_temp=True)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired temp token")
    if not user["totp_enabled"] or not user["totp_secret"]:
        raise HTTPException(status_code=400, detail="TOTP not configured")
    if not auth.verify_totp(user["totp_secret"], body.code):
        raise HTTPException(status_code=401, detail="Invalid TOTP code")
    # Delete temp session, create real session
    await db.delete_session(body.temp_token)
    token = await auth.create_session(user["id"], is_temp=False)
    return {"token": token, "username": user["username"]}

@app.get("/api/auth/totp-setup")
async def get_totp_setup(request: Request):
    """Returns TOTP secret + URI for QR code. Stores pending secret."""
    temp_token = request.headers.get("X-Temp-Token")
    if not temp_token:
        raise HTTPException(status_code=401, detail="Missing temp token")
    user = await auth.verify_session(temp_token, require_temp=True)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired temp token")

    # Generate (or reuse pending) secret
    secret = user["totp_secret"] or auth.generate_totp_secret()
    await db.set_totp_secret(user["id"], secret)
    uri = auth.get_totp_uri(secret, user["username"])
    return {"secret": secret, "uri": uri, "username": user["username"]}

@app.post("/api/auth/totp-setup")
async def confirm_totp_setup(body: TotpSetupConfirmRequest):
    user = await auth.verify_session(body.temp_token, require_temp=True)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired temp token")
    secret = user["totp_secret"]
    if not secret:
        raise HTTPException(status_code=400, detail="TOTP setup not started")
    if not auth.verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid TOTP code — check your authenticator")
    await db.enable_totp(user["id"], secret)
    await db.delete_session(body.temp_token)
    token = await auth.create_session(user["id"], is_temp=False)
    return {"token": token, "username": user["username"]}

@app.get("/api/auth/me")
async def me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"username": user["username"], "totp_enabled": bool(user["totp_enabled"])}

@app.post("/api/auth/logout")
async def logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else request.cookies.get("labdash_session", "")
    if token:
        await db.delete_session(token)
    return {"ok": True}

@app.post("/api/auth/change-password")
async def change_password(body: ChangePasswordRequest, request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not auth.verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password incorrect")
    new_hash = auth.hash_password(body.new_password)
    await db.update_user_password(user["id"], new_hash)
    return {"ok": True}

@app.post("/api/auth/disable-totp")
async def disable_totp_route(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    await db.disable_totp(user["id"])
    return {"ok": True}

@app.get("/api/auth/totp-qr")
async def totp_qr(request: Request):
    """Return a QR code PNG for the TOTP provisioning URI.
    Requires X-Temp-Token header (same as totp-setup).
    Frontend can use as: <img src="/api/auth/totp-qr" headers={X-Temp-Token: ...}>
    — but since img tags can't set headers we use a signed approach:
    the client first calls GET /api/auth/totp-setup to get the URI,
    then encodes the URI as a query param here.
    """
    import io, qrcode
    from fastapi.responses import StreamingResponse

    uri = request.query_params.get("uri", "")
    if not uri or not uri.startswith("otpauth://"):
        raise HTTPException(status_code=400, detail="Missing or invalid uri param")

    qr = qrcode.QRCode(box_size=8, border=2,
                       error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0a0a0a", back_color="#ffffff")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png",
                             headers={"Cache-Control": "no-store"})


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
