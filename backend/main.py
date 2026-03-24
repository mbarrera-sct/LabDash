"""LabDash — FastAPI backend."""
import asyncio, os, time, json, logging
from collections import defaultdict
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Depends, Request, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

log = logging.getLogger(__name__)

import db, proxmox, opnsense, k8s, unraid, plex, immich, homeassistant, templates, auth, snmp

_SSL_VERIFY = os.environ.get("SSL_VERIFY", "false").lower() in ("true", "1", "yes")
import portainer, uptime_kuma, tailscale, telegram as tgmod
import ping as pingmod
import collector, alerting, snmp_trap

# ── Simple in-memory API response cache ──────────────────────────────────────
import functools
_api_cache: dict[str, tuple[float, object]] = {}

def _cached(ttl: int = 15):
    """Decorator: cache async function result for `ttl` seconds."""
    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            key = fn.__name__ + str(args) + str(sorted(kwargs.items()))
            now = time.time()
            if key in _api_cache:
                ts, val = _api_cache[key]
                if now - ts < ttl:
                    return val
            result = await fn(*args, **kwargs)
            _api_cache[key] = (now, result)
            return result
        return wrapper
    return decorator

FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"

# ── Public paths (no auth required) ──────────────────────────────────────────
PUBLIC_PREFIXES = ("/healthz", "/api/auth/", "/assets/", "/api/maintenance", "/metrics")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    await db.purge_expired_sessions()
    await auth.create_admin_if_needed()
    asyncio.create_task(collector.run())
    asyncio.create_task(alerting.run())
    asyncio.create_task(snmp_trap.run())
    yield

app = FastAPI(title="LabDash", lifespan=lifespan)

app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS: by default allows all origins (homelab — no public exposure).
# Set CORS_ORIGINS=https://dash.home.local to restrict to specific origins.
_cors_origins_raw = os.environ.get("CORS_ORIGINS", "*")
_cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
_cors_credentials = "*" not in _cors_origins  # credentials only when origin is explicit

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth middleware ───────────────────────────────────────────────────────────
# Endpoints that read-only users CAN access (write/mutate operations are blocked)
_READONLY_ALLOWED_METHODS = {"GET", "HEAD", "OPTIONS"}
# Exceptions: read-only users may POST to these specific paths
_READONLY_POST_WHITELIST = {"/api/auth/login", "/api/auth/verify-totp", "/api/auth/logout",
                             "/api/auth/change-password", "/api/auth/totp-enable",
                             "/api/auth/disable-totp", "/api/auth/totp-init", "/api/ping",
                             "/api/telegram/webhook"}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if any(path.startswith(p) for p in PUBLIC_PREFIXES):
        return await call_next(request)
    if not path.startswith("/api/"):
        return await call_next(request)
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
    # Enforce read-only role: block mutating requests
    role = user.get("role", "admin") or "admin"
    if role == "readonly":
        method = request.method.upper()
        if method not in _READONLY_ALLOWED_METHODS and path not in _READONLY_POST_WHITELIST:
            return JSONResponse({"detail": "Acceso de solo lectura — operación no permitida"}, status_code=403)
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

class TotpEnableRequest(BaseModel):
    code: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "admin"

class UpdateUserRoleRequest(BaseModel):
    role: str

class PingRequest(BaseModel):
    ips: list[str]

class VmActionRequest(BaseModel):
    node: str
    vmtype: str
    vmid: int
    action: str

class AlertRuleRequest(BaseModel):
    name: str
    metric_key: str
    operator: str
    threshold: float
    notify_url: str = ""
    cooldown_s: int = 3600

class TelegramConfigRequest(BaseModel):
    token: str
    chat_id: str = ""
    daily_digest: bool = False
    webhook_url: str = ""

class SilenceRequest(BaseModel):
    hours: float = 1.0

class MaintenanceRequest(BaseModel):
    enabled: bool

# ── Auth routes ───────────────────────────────────────────────────────────────
def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="labdash_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=auth.SESSION_TTL,
        path="/",
    )

def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key="labdash_session", path="/")

@app.post("/api/auth/login")
async def login(body: LoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    auth.check_rate_limit(ip, body.username)
    user = await db.get_user_by_username(body.username)
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    auth.clear_rate_limit(ip, body.username)
    if bool(user["totp_enabled"]):
        temp_token = await auth.create_session(user["id"], is_temp=True)
        return {"temp_token": temp_token, "needs_totp": True}
    else:
        token = await auth.create_session(user["id"], is_temp=False)
        await db.insert_audit(int(time.time()), body.username, "login", f"from {ip}")
        _set_session_cookie(response, token)
        return {"token": token, "username": user["username"], "needs_totp": False}

@app.post("/api/auth/verify-totp")
async def verify_totp(body: TotpVerifyRequest, response: Response):
    user = await auth.verify_session(body.temp_token, require_temp=True)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired temp token")
    if not user["totp_enabled"] or not user["totp_secret"]:
        raise HTTPException(status_code=400, detail="TOTP not configured")
    if not auth.verify_totp(user["totp_secret"], body.code):
        raise HTTPException(status_code=401, detail="Invalid TOTP code")
    await db.delete_session(body.temp_token)
    token = await auth.create_session(user["id"], is_temp=False)
    _set_session_cookie(response, token)
    return {"token": token, "username": user["username"]}

@app.get("/api/auth/totp-setup")
async def get_totp_setup(request: Request):
    temp_token = request.headers.get("X-Temp-Token")
    if not temp_token:
        raise HTTPException(status_code=401, detail="Missing temp token")
    user = await auth.verify_session(temp_token, require_temp=True)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired temp token")
    secret = user["totp_secret"] or auth.generate_totp_secret()
    await db.set_totp_secret(user["id"], secret)
    uri = auth.get_totp_uri(secret, user["username"])
    return {"secret": secret, "uri": uri, "username": user["username"]}

@app.post("/api/auth/totp-setup")
async def confirm_totp_setup(body: TotpSetupConfirmRequest, response: Response):
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
    _set_session_cookie(response, token)
    return {"token": token, "username": user["username"]}

@app.get("/api/auth/me")
async def me(user: dict = Depends(auth.get_current_user)):
    return {"id": user["id"], "username": user["username"], "totp_enabled": bool(user["totp_enabled"]), "role": user.get("role", "admin") or "admin"}

@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else request.cookies.get("labdash_session", "")
    if token:
        await auth.delete_session_cached(token)
    _clear_session_cookie(response)
    return {"ok": True}

@app.post("/api/auth/change-password")
async def change_password(body: ChangePasswordRequest, user: dict = Depends(auth.get_current_user)):
    if not auth.verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Contraseña actual incorrecta")
    await db.update_user_password(user["id"], auth.hash_password(body.new_password))
    return {"ok": True}

@app.post("/api/auth/disable-totp")
async def disable_totp_route(user: dict = Depends(auth.get_current_user)):
    await db.disable_totp(user["id"])
    return {"ok": True}

@app.get("/api/auth/totp-init")
async def totp_init(user: dict = Depends(auth.get_current_user)):
    if bool(user["totp_enabled"]):
        raise HTTPException(status_code=400, detail="2FA ya está activado")
    secret = user["totp_secret"] or auth.generate_totp_secret()
    await db.set_totp_secret(user["id"], secret)
    uri = auth.get_totp_uri(secret, user["username"])
    return {"secret": secret, "uri": uri}

@app.post("/api/auth/totp-enable")
async def totp_enable(body: TotpEnableRequest, user: dict = Depends(auth.get_current_user)):
    if bool(user["totp_enabled"]):
        raise HTTPException(status_code=400, detail="2FA ya está activado")
    secret = user["totp_secret"]
    if not secret:
        raise HTTPException(status_code=400, detail="Inicia primero el setup de 2FA")
    if not auth.verify_totp(secret, body.code):
        raise HTTPException(status_code=401, detail="Código incorrecto — revisa tu app")
    await db.enable_totp(user["id"], secret)
    return {"ok": True}

@app.get("/api/auth/totp-qr")
async def totp_qr(request: Request):
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

# ── User management ───────────────────────────────────────────────────────────
@app.get("/api/users")
async def list_users(user: dict = Depends(auth.get_current_user)):
    users = await db.list_users()
    return {"users": [
        {"id": u["id"], "username": u["username"], "totp_enabled": bool(u["totp_enabled"]), "role": u.get("role", "admin") or "admin"}
        for u in users
    ]}

@app.post("/api/users")
async def create_user_route(body: CreateUserRequest, user: dict = Depends(auth.get_current_user)):
    # Only admins can create users
    if (user.get("role", "admin") or "admin") != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores pueden crear usuarios")
    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=400, detail="Usuario y contraseña son obligatorios")
    existing = await db.get_user_by_username(username)
    if existing:
        raise HTTPException(status_code=409, detail="El nombre de usuario ya existe")
    role = body.role if body.role in ("admin", "readonly") else "admin"
    uid = await db.create_user(username, auth.hash_password(body.password))
    if role != "admin":
        await db.update_user_role(uid, role)
    return {"ok": True}

@app.patch("/api/users/{user_id}/role")
async def update_user_role_route(user_id: int, body: UpdateUserRoleRequest, current_user: dict = Depends(auth.get_current_user)):
    if (current_user.get("role", "admin") or "admin") != "admin":
        raise HTTPException(status_code=403, detail="Solo los administradores pueden cambiar roles")
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="No puedes cambiar tu propio rol")
    if body.role not in ("admin", "readonly"):
        raise HTTPException(status_code=400, detail="Rol inválido. Usa 'admin' o 'readonly'")
    await db.update_user_role(user_id, body.role)
    return {"ok": True}

@app.delete("/api/users/{user_id}")
async def delete_user_route(user_id: int, current_user: dict = Depends(auth.get_current_user)):
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta")
    await db.delete_user(user_id)
    return {"ok": True}

# ── Setup wizard ──────────────────────────────────────────────────────────────
@app.get("/api/setup/status")
async def setup_status(user: dict = Depends(auth.get_current_user)):
    val = await db.get_setting("setup_completed", "")
    return {"needs_setup": val != "true"}

class SetupCompleteRequest(BaseModel):
    settings: dict = {}

@app.post("/api/setup/complete")
async def setup_complete(body: SetupCompleteRequest, user: dict = Depends(auth.get_current_user)):
    if body.settings:
        filtered = {k: v for k, v in body.settings.items() if v}
        if filtered:
            await db.set_settings(filtered)
    await db.set_setting("setup_completed", "true")
    return {"ok": True}

# ── Public app config (no auth) ──────────────────────────────────────────────
@app.get("/api/app-config")
async def app_config():
    """Returns public app configuration (name, etc.) — no auth required."""
    name = await db.get_setting("app_name", "") or "LabDash"
    return {"app_name": name}

# ── Healthz / Kubernetes probes ───────────────────────────────────────────────
@app.get("/healthz")
async def healthz():
    """Backwards-compatible liveness probe."""
    return "ok"

@app.get("/healthz/live")
async def healthz_live():
    """Kubernetes liveness probe — quick check, no DB."""
    return {"status": "ok"}

@app.get("/healthz/ready")
async def healthz_ready():
    """Kubernetes readiness probe — checks DB connectivity."""
    try:
        await db.get_setting("setup_completed", "")
        return {"status": "ready"}
    except Exception as exc:
        log.warning("healthz/ready: DB check failed: %s", exc)
        return JSONResponse({"status": "not_ready", "error": str(exc)}, status_code=503)

# ── Maintenance / global silence mode ────────────────────────────────────────
@app.get("/api/maintenance")
async def get_maintenance():
    """Public endpoint — returns current maintenance (global silence) state."""
    enabled = await db.get_global_silence()
    return {"enabled": enabled}

@app.post("/api/maintenance")
async def set_maintenance(body: MaintenanceRequest, request: Request):
    """Admin-only — enable or disable global alert silence."""
    # Manual auth (endpoint is in PUBLIC_PREFIXES so middleware is bypassed)
    token = None
    _auth_header = request.headers.get("Authorization", "")
    if _auth_header.startswith("Bearer "):
        token = _auth_header[7:]
    if not token:
        token = request.cookies.get("labdash_session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await auth.verify_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expired")
    role = (user.get("role") or "admin")
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    await db.set_global_silence(body.enabled)
    username = user.get("username", "unknown")
    detail = "maintenance enabled" if body.enabled else "maintenance disabled"
    await db.insert_audit(int(time.time()), username, "maintenance", detail)
    return {"ok": True, "enabled": body.enabled}

# ── SSE — real-time event stream ──────────────────────────────────────────────
@app.get("/api/events/stream")
async def events_stream(request: Request):
    """Server-Sent Events stream for real-time events. Requires auth."""
    # Manual auth check (middleware skips this path — it's not in PUBLIC_PREFIXES
    # but we handle it manually to support streaming)
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

    async def _generator():
        last_id: int | None = None
        last_keepalive = time.time()
        try:
            while True:
                if await request.is_disconnected():
                    break
                events = await db.get_events(limit=10)
                new_events = []
                for ev in reversed(events):  # oldest first
                    if last_id is None or ev["id"] > last_id:
                        new_events.append(ev)
                if new_events:
                    for ev in new_events:
                        last_id = ev["id"]
                        yield f"data: {json.dumps(ev)}\n\n"
                    last_keepalive = time.time()
                else:
                    if time.time() - last_keepalive >= 15:
                        yield ": keepalive\n\n"
                        last_keepalive = time.time()
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

# ── Prometheus /metrics ───────────────────────────────────────────────────────
@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus exposition format metrics endpoint."""
    lines: list[str] = []
    lines.append('# HELP labdash_info LabDash instance info')
    lines.append('# TYPE labdash_info gauge')
    lines.append('labdash_info{version="2.0.0"} 1')

    try:
        keys = await db.get_metric_keys()
    except Exception:
        keys = []

    for key in keys:
        try:
            val = await db.get_metric_latest(key)
        except Exception:
            val = None
        if val is None:
            continue
        metric_name = "labdash_metric_" + key.replace(".", "_").replace("-", "_")
        safe_key = key.replace('"', '\\"')
        lines.append(f'# HELP {metric_name} LabDash metric {key}')
        lines.append(f'# TYPE {metric_name} gauge')
        lines.append(f'{metric_name}{{key="{safe_key}"}} {val}')

    return Response(
        content="\n".join(lines) + "\n",
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )

# ── Proxmox ───────────────────────────────────────────────────────────────────
@app.get("/api/proxmox/nodes")
async def pve_nodes():
    data, err = await proxmox.fetch()
    nodes_raw  = data.get("nodes", []) if data else []
    resources  = data.get("resources", []) if data else []
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
            "name":     n.get("node"),
            "status":   n.get("status"),
            "cpu":      round(n.get("cpu", 0) * 100, 1),
            "mem_used": n.get("mem", 0),
            "mem_max":  n.get("maxmem", 1),
            "uptime":   n.get("uptime", 0),
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
            "node":     r.get("node"),
        })
    return {"by_node": dict(by_node), "error": err}

@app.post("/api/proxmox/test")
async def pve_test():
    ok, msg = await proxmox.test_connection()
    return {"ok": ok, "message": msg}

@app.post("/api/proxmox/vm-action")
async def pve_vm_action(body: VmActionRequest):
    ok, msg = await proxmox.vm_action(body.node, body.vmtype, body.vmid, body.action)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "upid": msg}

# ── OPNsense ──────────────────────────────────────────────────────────────────
@app.get("/api/opnsense/interfaces")
async def opn_interfaces():
    data, err = await opnsense.fetch()
    return {"data": data.get("interfaces", {}) if data else {}, "error": err}

@app.get("/api/opnsense/gateways")
async def opn_gateways():
    data, err = await opnsense.fetch()
    return {"data": data.get("gateways", {}) if data else {}, "error": err}

@app.get("/api/opnsense/sysinfo")
async def opn_sysinfo():
    import re as _re
    data, err = await opnsense.fetch()
    if not data:
        return {"data": {}, "error": err}

    # ── Version (/api/diagnostics/system/systemInformation) ──────────────────
    sys_info = data.get("sys_information", {}) or {}
    version = None
    versions_list = sys_info.get("versions", [])
    if versions_list:
        # First entry is e.g. "OPNsense 26.1.4-amd64" → extract "26.1.4"
        m = _re.search(r'OPNsense\s+([\d.]+)', versions_list[0])
        version = m.group(1) if m else versions_list[0]
    hostname = sys_info.get("name")

    # ── Memory (/api/diagnostics/system/systemResources) ─────────────────────
    sys_res = data.get("sys_resources", {}) or {}
    mem = sys_res.get("memory", {}) or {}
    mem_total = int(mem["total"]) if mem.get("total") else None
    mem_used  = int(mem["used"])  if mem.get("used")  else None

    # ── CPU & Uptime (/api/diagnostics/activity/getActivity) ─────────────────
    sys_act  = data.get("sys_activity", {}) or {}
    headers  = sys_act.get("headers", [])
    cpu_pct  = None
    uptime_s = None

    for line in headers:
        # Uptime — "up 5+20:01:52" (days) or "up 1:30:45" (no days)
        if uptime_s is None:
            m = _re.search(r'\bup\s+(?:(\d+)\+)?(\d+):(\d+):(\d+)', line)
            if m:
                days = int(m.group(1) or 0)
                h, mn, s = int(m.group(2)), int(m.group(3)), int(m.group(4))
                uptime_s = days * 86400 + h * 3600 + mn * 60 + s
        # CPU — "99.2% idle"
        if cpu_pct is None:
            m = _re.search(r'([\d.]+)%\s+idle', line)
            if m:
                cpu_pct = round(100.0 - float(m.group(1)), 1)

    normalized = {
        "product_version":   version,
        "hostname":          hostname,
        "uptime":            uptime_s,       # seconds — fmtUptime() on frontend
        "cpu_usage_percent": cpu_pct,
        "memory_used":       mem_used,
        "memory_total":      mem_total,
    }
    return {"data": normalized, "error": err}

@app.get("/api/opnsense/dhcp")
async def opn_dhcp():
    data, err = await opnsense.fetch()
    raw  = data.get("dhcp", {}) if data else {}
    rows = raw.get("rows", [])
    leases = []
    for r in rows:
        leases.append({
            "ip":       r.get("address") or r.get("ip-address") or "",
            "mac":      r.get("hwaddr")  or r.get("hw-address") or r.get("mac", ""),
            "hostname": r.get("hostname") or r.get("client-hostname") or "",
            "state":    r.get("state", 0),
            "expire":   r.get("expire") or r.get("valid-lft") or "",
        })
    return {"leases": leases, "error": err}

@app.get("/api/opnsense/arp")
async def opn_arp():
    data, err = await opnsense.fetch()
    raw = data.get("arp", {}) if data else {}
    # OPNsense returns {"rows": [...]} or direct array
    rows = raw.get("rows", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    entries = [
        {
            "ip":        r.get("ip", ""),
            "mac":       r.get("mac", ""),
            "hostname":  r.get("hostname", ""),
            "interface": r.get("intf", r.get("interface", "")),
            "permanent": bool(r.get("permanent", False)),
        }
        for r in rows if r.get("ip")
    ]
    return {"entries": entries, "error": err}

@app.get("/api/opnsense/fwlog")
async def opn_fwlog():
    data, err = await opnsense.fetch()
    raw = data.get("fw_log", {}) if data else {}
    rows = raw.get("rows", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    entries = [
        {
            "action":  r.get("action", r.get("__action__", "")),
            "src":     r.get("src", r.get("__src__", "")),
            "dst":     r.get("dst", r.get("__dst__", "")),
            "srcport": r.get("srcport", r.get("__srcport__", "")),
            "dstport": r.get("dstport", r.get("__dstport__", "")),
            "proto":   r.get("proto", r.get("__proto__", "")),
            "iface":   r.get("interface", r.get("__if__", r.get("if", ""))),
            "label":   r.get("label", r.get("__label__", "")),
        }
        for r in rows[:100]
    ]
    return {"entries": entries, "error": err}

@app.post("/api/ping")
async def ping_hosts(body: PingRequest):
    results = await pingmod.ping_batch(body.ips)
    return {"results": results}

@app.get("/api/network/live")
async def network_live():
    """Real-time ping status for all diagram nodes + latest SNMP bandwidth."""
    diagram = await db.get_diagram()
    ips = list({
        n["data"]["ip"]
        for n in diagram.get("nodes", [])
        if n.get("data", {}).get("ip")
    })
    ping_results = await pingmod.ping_batch(ips) if ips else {}
    snmp_in  = await db.get_metric_latest("snmp.in_kbps")
    snmp_out = await db.get_metric_latest("snmp.out_kbps")
    return {"ping": ping_results, "snmp_in_kbps": snmp_in, "snmp_out_kbps": snmp_out}

# ── Kubernetes ────────────────────────────────────────────────────────────────
@app.get("/api/k8s/nodes")
async def k8s_nodes():
    all_results, errors = await k8s.fetch_all()
    nodes = []
    for result in all_results:
        cluster_name = result.get("cluster", "default")
        raw_nodes = result.get("nodes", {}).get("items", [])
        for n in raw_nodes:
            nodes.append({
                "name": n["metadata"]["name"],
                "cluster": cluster_name,
                "ready": any(
                    c["type"] == "Ready" and c["status"] == "True"
                    for c in n.get("status", {}).get("conditions", [])
                ),
                "roles": [k.split("/")[-1] for k in n["metadata"].get("labels", {}) if "node-role.kubernetes.io/" in k],
                "version": n.get("status", {}).get("nodeInfo", {}).get("kubeletVersion", ""),
            })
    return {"nodes": nodes, "error": "; ".join(errors) if errors and not nodes else None}

@app.get("/api/k8s/workloads")
async def k8s_workloads():
    all_results, errors = await k8s.fetch_all()
    if not all_results:
        return {"namespaces": {}, "error": "; ".join(errors) if errors else None}
    # Use first cluster for workloads (primary cluster)
    data = all_results[0]
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
    return {"namespaces": dict(by_ns), "error": None}

# ── Unraid ────────────────────────────────────────────────────────────────────
@app.get("/api/unraid/system")
async def unraid_system():
    data, err = await unraid.fetch()
    return {"data": data.get("system", {}) if data else {}, "error": err}

@app.get("/api/unraid/docker")
async def unraid_docker():
    data, err = await unraid.fetch()
    return {"containers": data.get("docker", []) if data else [], "error": err}

@app.get("/api/unraid/disks")
async def unraid_disks():
    data, err = await unraid.fetch_disks()
    return {
        "status":   data.get("status", "") if data else "",
        "capacity": data.get("capacity", {}) if data else {},
        "disks":    data.get("disks", []) if data else [],
        "parities": data.get("parities", []) if data else [],
        "error":    err,
    }

# ── Plex ──────────────────────────────────────────────────────────────────────
@app.get("/api/plex/info")
async def plex_info():
    data, err = await plex.fetch()
    return {"data": data or {}, "error": err}

# ── Immich ────────────────────────────────────────────────────────────────────
@app.get("/api/immich/stats")
async def immich_stats():
    data, err = await immich.fetch()
    return {"data": data or {}, "error": err}

# ── Home Assistant ────────────────────────────────────────────────────────────
@app.get("/api/ha/states")
async def ha_states():
    data, err = await homeassistant.fetch()
    return {"states": data.get("states", []) if data else [], "error": err}

# ── Aggregate status ──────────────────────────────────────────────────────────
@app.get("/api/status")
async def status():
    # Run all three fetches in parallel — avoids sequential blocking
    (pve_data, pve_err), (k8s_data, _), (opn_data, _) = await asyncio.gather(
        proxmox.fetch(),
        k8s.fetch(),
        opnsense.fetch(),
    )
    resources  = pve_data.get("resources", []) if pve_data else []
    nodes_raw  = pve_data.get("nodes", []) if pve_data else []
    vms        = [r for r in resources if r.get("type") in ("qemu","lxc") and not r.get("template")]
    running    = [v for v in vms if v.get("status") == "running"]
    templates  = [r for r in resources if r.get("type") in ("qemu","lxc") and r.get("template")]

    k8s_nodes_count = len(k8s_data.get("nodes", {}).get("items", [])) if k8s_data else 0

    gw_items = opn_data.get("gateways", {}).get("items", []) if opn_data else []
    wan_up   = sum(1 for g in gw_items if g.get("status_translated") == "Online")

    return {
        "proxmox": {
            "nodes":     len(nodes_raw),
            "vms_total": len(vms),
            "running":   len(running),
            "templates": len(templates),
            "error":     pve_err,
        },
        "k8s": {
            "nodes": k8s_nodes_count,
            "error": None,
        },
        "opnsense": {
            "wan_up":   wan_up,
            "gateways": len(gw_items),
        },
        "ts": int(time.time()),
    }

# ── Diagram CRUD ──────────────────────────────────────────────────────────────
@app.get("/api/diagram")
async def get_diagram():
    return await db.get_diagram()

@app.post("/api/diagram")
async def save_diagram(payload: dict):
    await db.save_diagram(payload)
    return {"ok": True}

# ── Diagram templates ─────────────────────────────────────────────────────────
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

# ── Settings ──────────────────────────────────────────────────────────────────
ALL_KEYS = [
    "pve_url", "pve_user", "pve_pass",
    "opn_url", "opn_key", "opn_secret",
    "k8s_url", "k8s_token",
    "unraid_url", "unraid_key",
    "unraid_temp_warn", "unraid_temp_crit", "unraid_cap_warn", "unraid_cap_crit",
    "plex_url", "plex_token",
    "plex_max_streams", "plex_max_transcode",
    "immich_url", "immich_key",
    "ha_url", "ha_token", "ha_entities",
    "snmp_host", "snmp_community", "snmp_port", "snmp_targets",
    "snmp_bw_warn_pct", "snmp_err_warn",
    "session_timeout_hours",
    "portainer_url", "portainer_token",
    "uptime_kuma_url", "uptime_kuma_slug",
    "tailscale_tailnet", "tailscale_token",
    "snmp_trap_port",
    "app_name",
]
SECRET_KEYS = {"pve_pass", "opn_key", "opn_secret", "k8s_token", "unraid_key", "plex_token", "immich_key", "ha_token", "portainer_token", "tailscale_token"}

@app.get("/api/settings")
async def get_settings():
    raw = await db.get_settings(ALL_KEYS)
    return {k: ("***" if k in SECRET_KEYS and raw[k] else raw[k]) for k in ALL_KEYS}

@app.post("/api/settings")
async def save_settings(payload: dict, request: Request):
    filtered = {k: v for k, v in payload.items() if k in ALL_KEYS and v != "***"}
    await db.set_settings(filtered)
    proxmox._cache = {"data": None, "ts": 0}
    opnsense._cache = {"data": None, "ts": 0}
    k8s._cache = {"data": None, "ts": 0}
    unraid._cache = {"data": None, "ts": 0}
    unraid._disks_cache = {"data": None, "ts": 0}
    plex._cache = {"data": None, "ts": 0}
    immich._cache = {"data": None, "ts": 0}
    homeassistant._cache = {"data": None, "ts": 0}
    snmp._cache = {}
    portainer._cache = {"data": None, "ts": 0}
    uptime_kuma._cache = {"data": None, "ts": 0}
    tailscale._cache = {"data": None, "ts": 0}
    username = getattr(request.state, "user", {}).get("username", "unknown") if hasattr(request, "state") else "unknown"
    await db.insert_audit(int(time.time()), username, "settings_saved", str(list(filtered.keys())))
    return {"ok": True}

# ── SNMP ──────────────────────────────────────────────────────────────────────
@app.get("/api/snmp/interfaces")
async def snmp_interfaces():
    all_results, errors = await snmp.fetch_all()
    if not all_results:
        return {"ports": [], "targets": [], "error": "; ".join(errors) if errors else None}
    # Flatten all targets' ports with target name attached
    all_ports = []
    systems = {}
    for result in all_results:
        target_name = result.get("target", "default")
        for port in result.get("ports", []):
            all_ports.append({**port, "target": target_name})
        if result.get("system"):
            systems[target_name] = result["system"]
    target_names = [r.get("target", "default") for r in all_results]
    return {"ports": all_ports, "targets": target_names, "systems": systems, "error": "; ".join(errors) if errors and not all_ports else None}

# ── Metrics ───────────────────────────────────────────────────────────────────
@app.get("/api/metrics/{key:path}")
async def get_metrics(key: str, hours: int = 24):
    data = await db.get_metrics(key, hours=hours, limit=300)
    return {"key": key, "points": data}

@app.get("/api/metrics-keys")
async def metrics_keys():
    """Return distinct metric keys available."""
    import aiosqlite
    async with aiosqlite.connect(db.DB_PATH) as conn:
        async with conn.execute(
            "SELECT DISTINCT key FROM metrics ORDER BY key"
        ) as cur:
            rows = await cur.fetchall()
    return {"keys": [r[0] for r in rows]}

# ── Events ────────────────────────────────────────────────────────────────────
@app.get("/api/events")
async def get_events(limit: int = 50):
    events = await db.get_events(limit=limit)
    return {"events": events}

@app.delete("/api/events")
async def clear_events_route(current_user: dict = Depends(auth.get_current_user)):
    if current_user.get("role") == "readonly":
        raise HTTPException(status_code=403, detail="Readonly user")
    await db.clear_events()
    return {"ok": True}

# ── Alert rules ───────────────────────────────────────────────────────────────
@app.get("/api/alert-rules")
async def list_alert_rules():
    rules = await db.get_alert_rules()
    return {"rules": rules}

@app.post("/api/alert-rules")
async def create_alert_rule(body: AlertRuleRequest):
    rule_id = await db.create_alert_rule(
        body.name, body.metric_key, body.operator,
        body.threshold, body.notify_url, body.cooldown_s
    )
    return {"ok": True, "id": rule_id}

@app.delete("/api/alert-rules/{rule_id}")
async def delete_alert_rule(rule_id: int):
    await db.delete_alert_rule(rule_id)
    return {"ok": True}

@app.patch("/api/alert-rules/{rule_id}/toggle")
async def toggle_alert_rule(rule_id: int, enabled: bool = True):
    await db.toggle_alert_rule(rule_id, enabled)
    return {"ok": True}

# ── Uptime ────────────────────────────────────────────────────────────────────
@app.get("/api/uptime/{host:path}")
async def get_uptime(host: str, hours: int = 24):
    pct = await db.get_uptime_pct(host, hours=hours)
    return {"host": host, "hours": hours, "pct": pct}

# ── Portainer ─────────────────────────────────────────────────────────────────
@app.get("/api/portainer/data")
async def portainer_data():
    data, err = await portainer.fetch()
    return {"data": data or {}, "error": err}

@app.get("/api/portainer/stacks/{stack_id}/compose")
async def portainer_stack_compose(stack_id: int):
    """Fetch the docker-compose YAML for a Portainer stack."""
    import os, httpx
    url   = await db.get_setting("portainer_url",   os.environ.get("PORTAINER_URL", ""))
    token = await db.get_setting("portainer_token", os.environ.get("PORTAINER_TOKEN", ""))
    if not (url and token):
        raise HTTPException(status_code=503, detail="Portainer not configured")
    headers = {"X-API-Key": token}
    try:
        async with httpx.AsyncClient(base_url=url, verify=_SSL_VERIFY, timeout=10, headers=headers) as c:
            r = await c.get(f"/api/stacks/{stack_id}/file")
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=f"Portainer error: {r.text[:200]}")
            body = r.json()
            # Portainer returns {"StackFileContent": "version: '3'\\n..."}
            compose = body.get("StackFileContent") or body.get("content") or ""
            return {"stack_id": stack_id, "compose": compose}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

# ── Uptime Kuma ────────────────────────────────────────────────────────────────
@app.get("/api/uptime-kuma/monitors")
async def uptime_kuma_monitors():
    data, err = await uptime_kuma.fetch()
    return {"data": data or {}, "error": err}

# ── OPNsense firewall rules ────────────────────────────────────────────────────
@app.get("/api/opnsense/fw-rules")
async def opn_fw_rules():
    data, err = await opnsense.fetch()
    rules = data.get("fw_rules", []) if data else []
    return {"rules": rules, "error": err}

# ── OPNsense WiFi clients ──────────────────────────────────────────────────────
@app.get("/api/opnsense/wifi")
async def opn_wifi():
    """
    Returns devices on the 'wifi' interface (192.168.2.0/24).
    OPNsense doesn't have a wireless module — 'wifi' is a bridged interface
    connected to APs. We filter DHCP leases by interface name 'wifi' and
    ARP entries by subnet 192.168.2.x.
    """
    data, err = await opnsense.fetch()

    # --- DHCP leases on the wifi interface ---
    raw_dhcp = data.get("dhcp", {}) if data else {}
    dhcp_rows = raw_dhcp.get("rows", []) if isinstance(raw_dhcp, dict) else []
    wifi_clients: list[dict] = []
    seen_ips: set[str] = set()
    for r in dhcp_rows:
        ip = r.get("address") or r.get("ip-address") or ""
        iface = (r.get("if") or r.get("interface") or "").lower()
        # Match by interface name containing "wifi" OR IP in 192.168.2.x
        in_wifi_subnet = ip.startswith("192.168.2.")
        on_wifi_iface  = "wifi" in iface
        if in_wifi_subnet or on_wifi_iface:
            seen_ips.add(ip)
            wifi_clients.append({
                "ip":       ip,
                "mac":      r.get("hwaddr") or r.get("hw-address") or r.get("mac", ""),
                "hostname": r.get("hostname") or r.get("client-hostname") or "",
                "source":   "dhcp",
                "interface": iface or "wifi",
            })

    # --- ARP entries on 192.168.2.x as fallback (for devices without DHCP lease) ---
    raw_arp = data.get("arp", {}) if data else {}
    arp_rows = raw_arp.get("rows", []) if isinstance(raw_arp, dict) else (raw_arp if isinstance(raw_arp, list) else [])
    for r in arp_rows:
        ip = r.get("ip", "")
        iface = (r.get("intf") or r.get("interface") or "").lower()
        in_wifi_subnet = ip.startswith("192.168.2.")
        on_wifi_iface  = "wifi" in iface
        if (in_wifi_subnet or on_wifi_iface) and ip not in seen_ips:
            seen_ips.add(ip)
            wifi_clients.append({
                "ip":       ip,
                "mac":      r.get("mac", ""),
                "hostname": r.get("hostname", ""),
                "source":   "arp",
                "interface": iface or "wifi",
            })

    return {"clients": wifi_clients, "error": err}

# ── Audit log ─────────────────────────────────────────────────────────────────
@app.get("/api/audit-log")
async def get_audit_log(limit: int = 100, user: dict = Depends(auth.get_current_user)):
    entries = await db.get_audit_log(limit=limit)
    return {"entries": entries}

# ── Alert history ─────────────────────────────────────────────────────────────
@app.get("/api/alert-history")
async def get_alert_history(limit: int = 100):
    entries = await db.get_alert_history(limit=limit)
    return {"entries": entries}

# ── Active sessions ────────────────────────────────────────────────────────────
@app.get("/api/sessions")
async def list_sessions(user: dict = Depends(auth.get_current_user)):
    sessions = await db.list_active_sessions(user["id"])
    return {"sessions": [{"token_hint": s["token_hint"], "expires_at": s["expires_at"], "token": s["token"]} for s in sessions]}

@app.delete("/api/sessions/{token}")
async def revoke_session(token: str, user: dict = Depends(auth.get_current_user)):
    sessions = await db.list_active_sessions(user["id"])
    own_tokens = {s["token"] for s in sessions}
    if token not in own_tokens:
        raise HTTPException(status_code=403, detail="Not your session")
    await auth.delete_session_cached(token)
    return {"ok": True}

# ── Backup / Restore ──────────────────────────────────────────────────────────
@app.get("/api/backup")
async def backup(request: Request, user: dict = Depends(auth.get_current_user)):
    """Export all settings (plaintext), diagram and alert rules as a JSON file."""
    import json as _json
    from fastapi.responses import Response

    # Read all settings including secrets (plaintext for backup purposes)
    raw_settings = await db.get_settings(ALL_KEYS)

    diagram   = await db.get_diagram()
    rules_raw = await db.get_alert_rules()
    rules = [
        {k: v for k, v in r.items() if k not in ("id", "last_fired")}
        for r in rules_raw
    ]

    payload = {
        "version":  2,
        "ts":       int(time.time()),
        "settings": raw_settings,
        "diagram":  diagram,
        "alert_rules": rules,
    }
    username = user.get("username", "unknown")
    await db.insert_audit(int(time.time()), username, "backup_downloaded", "full backup")

    filename = f"labdash-backup-{time.strftime('%Y%m%d-%H%M%S')}.json"
    return Response(
        content=_json.dumps(payload, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class RestoreRequest(BaseModel):
    payload: dict

@app.post("/api/restore")
async def restore(body: RestoreRequest, request: Request, user: dict = Depends(auth.get_current_user)):
    """Restore settings, diagram and alert rules from a backup JSON."""
    data = body.payload
    version = data.get("version", 1)
    if version not in (1, 2):
        raise HTTPException(status_code=400, detail=f"Unsupported backup version: {version}")

    restored: list[str] = []

    # Restore settings
    if "settings" in data and isinstance(data["settings"], dict):
        filtered = {k: str(v) for k, v in data["settings"].items() if k in ALL_KEYS and v}
        if filtered:
            await db.set_settings(filtered)
            # Invalidate all module caches
            for mod in (proxmox, opnsense, k8s, unraid, plex, immich, homeassistant, snmp, portainer, uptime_kuma, tailscale):
                mod._cache = {"data": None, "ts": 0}
            restored.append(f"settings ({len(filtered)} keys)")

    # Restore diagram
    if "diagram" in data and isinstance(data["diagram"], dict):
        diag = data["diagram"]
        if "nodes" in diag or "edges" in diag:
            await db.save_diagram(diag)
            restored.append("diagram")

    # Restore alert rules (append, skip duplicates by name)
    if "alert_rules" in data and isinstance(data["alert_rules"], list):
        existing = {r["name"] for r in await db.get_alert_rules()}
        added = 0
        for rule in data["alert_rules"]:
            name = rule.get("name", "")
            if not name or name in existing:
                continue
            await db.create_alert_rule(
                name=name,
                metric_key=rule.get("metric_key", ""),
                operator=rule.get("operator", "gt"),
                threshold=float(rule.get("threshold", 0)),
                notify_url=rule.get("notify_url", ""),
                cooldown_s=int(rule.get("cooldown_s", 3600)),
            )
            existing.add(name)
            added += 1
        if added:
            restored.append(f"alert_rules ({added} new)")

    username = user.get("username", "unknown")
    await db.insert_audit(int(time.time()), username, "backup_restored", ", ".join(restored))
    return {"ok": True, "restored": restored}


# ── Proxmox node detail (temps + disks) ──────────────────────────────────────
@app.get("/api/proxmox/node-detail/{node}")
async def pve_node_detail(node: str):
    ok, msg = await proxmox.test_connection()
    if not ok:
        raise HTTPException(status_code=503, detail=msg)
    from db import get_setting
    import os, httpx
    pve_url  = await get_setting("pve_url",  os.environ.get("PVE_URL",  ""))
    pve_user = await get_setting("pve_user", os.environ.get("PVE_USER", "root@pam"))
    pve_pass = await get_setting("pve_pass", os.environ.get("PVE_PASS", ""))
    if not (pve_url and pve_pass):
        raise HTTPException(status_code=503, detail="Proxmox not configured")
    # Determine auth method: API token or password
    if "!" in pve_user:
        headers = {"Authorization": f"PVEAPIToken={pve_user}={pve_pass}"}
        auth_header = headers
    else:
        # Use ticket auth — get ticket first
        try:
            async with httpx.AsyncClient(base_url=pve_url, verify=_SSL_VERIFY, timeout=10) as c:
                tr = await c.post("/api2/json/access/ticket",
                                  data={"username": pve_user, "password": pve_pass})
                td = tr.json().get("data", {})
                ticket = td.get("ticket", "")
                csrf   = td.get("CSRFPreventionToken", "")
            auth_header = {"Cookie": f"PVEAuthCookie={ticket}", "CSRFPreventionToken": csrf}
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))

    try:
        async with httpx.AsyncClient(base_url=pve_url, verify=_SSL_VERIFY, timeout=10, headers=auth_header) as c:
            sr = await c.get(f"/api2/json/nodes/{node}/status")
            node_status = sr.json().get("data", {}) if sr.status_code == 200 else {}
            dr = await c.get(f"/api2/json/nodes/{node}/disks/list")
            disks_raw = dr.json().get("data", []) if dr.status_code == 200 else []
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

    disks = [
        {
            "dev":    d.get("devpath", d.get("dev", "")),
            "model":  d.get("model", ""),
            "size":   d.get("size", 0),
            "type":   d.get("type", ""),
            "health": d.get("health", ""),
            "temp":   d.get("temperature", None),
            "wearout": d.get("wearout", None),
        }
        for d in (disks_raw if isinstance(disks_raw, list) else [])
    ]

    # Extract CPU temp from node status sensors
    cpu_temp = None
    sensors = node_status.get("sensors", {})
    if isinstance(sensors, dict):
        for k, v in sensors.items():
            if "cpu" in k.lower() or "core" in k.lower() or "temp" in k.lower():
                if isinstance(v, (int, float)):
                    cpu_temp = v
                    break

    return {
        "node":     node,
        "cpu_temp": cpu_temp,
        "disks":    disks,
        "sensors":  sensors,
    }


# ── Proxmox config (public URL only) ─────────────────────────────────────────
@app.get("/api/proxmox/config")
async def pve_config():
    from db import get_setting
    import os
    pve_url = await get_setting("pve_url", os.environ.get("PVE_URL", ""))
    return {"pve_url": pve_url}


# ── Alert rule test ───────────────────────────────────────────────────────────
@app.post("/api/alert-rules/{rule_id}/test")
async def test_alert_rule(rule_id: int):
    rules = await db.get_alert_rules()
    rule = next((r for r in rules if r["id"] == rule_id), None)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    # Use a fake value that would trigger the rule
    fake_value = float(rule["threshold"]) + 1.0
    op_label = {"gt": ">", "lt": "<", "eq": "=", "ne": "≠", "gte": "≥", "lte": "≤"}.get(rule["operator"], rule["operator"])
    await alerting._dispatch(rule, rule["metric_key"], fake_value, float(rule["threshold"]), op_label)
    return {"ok": True, "message": f"Test notification dispatched for rule '{rule['name']}'"}


# ── OPNsense WireGuard ────────────────────────────────────────────────────────
@app.get("/api/opnsense/wireguard")
async def opn_wireguard():
    data, err = await opnsense.fetch()
    wg = data.get("wireguard", {}) if data else {}
    return {"data": wg, "error": err}


# ── Tailscale ─────────────────────────────────────────────────────────────────
@app.get("/api/tailscale/devices")
async def tailscale_devices():
    data, err = await tailscale.fetch()
    return {"data": data or {}, "error": err}


# ── Wake-on-LAN ───────────────────────────────────────────────────────────────
class WolRequest(BaseModel):
    mac: str
    broadcast: str = "255.255.255.255"

@app.post("/api/wol")
async def wake_on_lan(body: WolRequest):
    import socket, re
    mac = re.sub(r'[:\-\.]', '', body.mac.strip()).upper()
    if len(mac) != 12 or not all(c in '0123456789ABCDEF' for c in mac):
        raise HTTPException(status_code=400, detail="Invalid MAC address")
    # Build magic packet: 6x 0xFF + 16x MAC
    mac_bytes = bytes.fromhex(mac)
    magic = b'\xff' * 6 + mac_bytes * 16
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            s.sendto(magic, (body.broadcast, 9))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "mac": body.mac}


# ── Push notifications ────────────────────────────────────────────────────────
class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str

@app.get("/api/push/vapid-public-key")
async def push_vapid_key():
    """Return the VAPID public key for the browser to use when subscribing."""
    try:
        from py_vapid import Vapid
    except ImportError:
        return {"key": None, "error": "py_vapid not installed"}
    vapid_private = await db.get_setting("vapid_private_key", "")
    if not vapid_private:
        # Generate a new VAPID key pair on first request
        try:
            v = Vapid()
            v.generate_keys()
            private_b64 = v.private_key_urlsafe_b64encode().decode()
            public_b64  = v.public_key_urlsafe_b64encode().decode()
            await db.set_settings({"vapid_private_key": private_b64, "vapid_public_key": public_b64})
        except Exception as e:
            return {"key": None, "error": str(e)}
    public_key = await db.get_setting("vapid_public_key", "")
    return {"key": public_key}

@app.post("/api/push/subscribe")
async def push_subscribe(body: PushSubscribeRequest, user: dict = Depends(auth.get_current_user)):
    await db.save_push_subscription(user["id"], body.endpoint, body.p256dh, body.auth)
    return {"ok": True}

@app.delete("/api/push/unsubscribe")
async def push_unsubscribe(request: Request, user: dict = Depends(auth.get_current_user)):
    data = await request.json()
    endpoint = data.get("endpoint", "")
    if endpoint:
        await db.delete_push_subscription(endpoint)
    return {"ok": True}

# ── Alert silences ────────────────────────────────────────────────────────────
@app.post("/api/alert-rules/{rule_id}/silence")
async def silence_alert_rule(rule_id: int, body: SilenceRequest):
    until_ts = int(time.time()) + int(body.hours * 3600)
    await db.silence_rule(rule_id, until_ts)
    return {"ok": True, "until_ts": until_ts}

@app.get("/api/alert-silences")
async def list_silences():
    return {"silences": await db.get_silences()}

@app.patch("/api/alert-rules/{rule_id}")
async def update_alert_rule(rule_id: int, body: AlertRuleRequest):
    await db.update_alert_rule(
        rule_id, body.name, body.metric_key, body.operator,
        body.threshold, body.notify_url, body.cooldown_s
    )
    return {"ok": True}

# ── Telegram configuration ────────────────────────────────────────────────────
@app.get("/api/telegram/status")
async def telegram_status():
    token, chat_id = await tgmod._get_token_and_chat()
    if not token:
        return {"configured": False, "bot": None, "chat_id": None}
    info = await tgmod.get_bot_info(token)
    bot  = info.get("result") if info.get("ok") else None
    daily = await db.get_setting("tg_daily_digest", "false")
    return {"configured": bool(token), "bot": bot, "chat_id": chat_id, "daily_digest": daily == "true"}

@app.post("/api/telegram/config")
async def telegram_config(body: TelegramConfigRequest, user: dict = Depends(auth.get_current_user)):
    await db.set_settings({
        "tg_token":        body.token,
        "tg_chat_id":      body.chat_id,
        "tg_daily_digest": "true" if body.daily_digest else "false",
    })
    if body.webhook_url:
        result = await tgmod.set_webhook(body.token, body.webhook_url)
        if not result.get("ok"):
            return {"ok": False, "error": result.get("description", "Webhook error")}
    await db.insert_audit(int(time.time()), user.get("username","?"), "telegram_config", "updated")
    return {"ok": True}

@app.post("/api/telegram/test")
async def telegram_test(user: dict = Depends(auth.get_current_user)):
    token, chat_id = await tgmod._get_token_and_chat()
    if not token or not chat_id:
        raise HTTPException(status_code=400, detail="Telegram no configurado")
    result = await tgmod.send_message(
        f"✅ <b>LabDash — Test de notificación</b>\nMensaje enviado correctamente.\n"
        f"<i>{time.strftime('%d/%m/%Y %H:%M:%S')}</i>"
    )
    if result.get("ok"):
        return {"ok": True, "message": "Mensaje enviado correctamente"}
    raise HTTPException(status_code=500, detail=result.get("description", "Error Telegram"))

@app.post("/api/telegram/register")
async def telegram_register_chat(request: Request):
    """Accept a chat_id sent by user via /start command (auto-link)."""
    data = await request.json()
    chat_id = str(data.get("chat_id", ""))
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id required")
    await db.set_setting("tg_chat_id", chat_id)
    return {"ok": True}

_tg_webhook_hits: dict[str, list[float]] = {}
_TG_WEBHOOK_LIMIT = 30   # max requests per minute per IP

@app.post("/api/telegram/webhook")
async def telegram_webhook(request: Request):
    """Receive Telegram updates (messages + callback queries)."""
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    hits = [t for t in _tg_webhook_hits.get(ip, []) if now - t < 60]
    if len(hits) >= _TG_WEBHOOK_LIMIT:
        return JSONResponse({"ok": False}, status_code=429)
    hits.append(now)
    _tg_webhook_hits[ip] = hits
    try:
        update = await request.json()
        asyncio.create_task(tgmod.handle_update(update))
    except Exception:
        pass
    return {"ok": True}

@app.delete("/api/telegram/config")
async def telegram_delete_config(user: dict = Depends(auth.get_current_user)):
    token, _ = await tgmod._get_token_and_chat()
    if token:
        await tgmod.delete_webhook(token)
    await db.set_settings({"tg_token": "", "tg_chat_id": "", "tg_daily_digest": "false"})
    await db.insert_audit(int(time.time()), user.get("username","?"), "telegram_config", "deleted")
    return {"ok": True}

# ── Dashboard bundle (single endpoint for all dashboard data) ─────────────────
@app.get("/api/dashboard/bundle")
async def dashboard_bundle():
    """Aggregate endpoint: returns all data needed for the dashboard in one request."""
    results = await asyncio.gather(
        _bundle_status(),
        _bundle_proxmox(),
        _bundle_opnsense(),
        _bundle_k8s(),
        _bundle_services(),
        return_exceptions=True
    )
    def _safe(v):
        return None if isinstance(v, Exception) else v

    status_d, pv_d, opn_d, k8s_d, svc_d = [_safe(r) for r in results]
    return {
        "status":   status_d,
        "proxmox":  pv_d,
        "opnsense": opn_d,
        "k8s":      k8s_d,
        "services": svc_d,
    }

@_cached(ttl=30)
async def _bundle_status():
    cfg = await db.get_settings(["proxmox_url","proxmox_user","proxmox_pass",
                                  "opnsense_url","opnsense_key","opnsense_secret"])
    pv_raw  = await proxmox.get_nodes(cfg["proxmox_url"], cfg["proxmox_user"], cfg["proxmox_pass"])
    opn_raw = await opnsense.fetch()
    nodes   = pv_raw.get("nodes", [])
    gws     = opn_raw[0].get("gateways", {}).get("items", []) if opn_raw[0] else []
    return {
        "proxmox": {
            "nodes":      len(nodes),
            "online":     sum(1 for n in nodes if n.get("status") == "online"),
            "running":    0,
            "vms_total":  0,
        },
        "opnsense": {"wan_up": sum(1 for g in gws if g.get("status_translated") == "Online")},
    }

@_cached(ttl=30)
async def _bundle_proxmox():
    cfg = await db.get_settings(["proxmox_url","proxmox_user","proxmox_pass"])
    nodes = await proxmox.get_nodes(cfg["proxmox_url"], cfg["proxmox_user"], cfg["proxmox_pass"])
    vms   = await proxmox.get_vms(cfg["proxmox_url"], cfg["proxmox_user"], cfg["proxmox_pass"])
    return {"nodes": nodes, "vms": vms}

@_cached(ttl=15)
async def _bundle_opnsense():
    cfg = await db.get_settings(["opnsense_url","opnsense_key","opnsense_secret"])
    data, err = await opnsense.fetch()
    gws  = await opnsense.get_gateways(cfg["opnsense_url"], cfg["opnsense_key"], cfg["opnsense_secret"])
    return {"data": data, "gateways": gws, "error": err}

@_cached(ttl=30)
async def _bundle_k8s():
    nodes     = await k8s.get_nodes()
    workloads = await k8s.get_workloads()
    return {"nodes": nodes, "workloads": workloads}

@_cached(ttl=60)
async def _bundle_services():
    results = await asyncio.gather(
        plex.fetch(), immich.fetch(), homeassistant.fetch(),
        portainer.fetch(), uptime_kuma.fetch(),
        return_exceptions=True
    )
    def _s(v):
        return None if isinstance(v, Exception) else v
    pl, im, ha, pt, uk = [_s(r) for r in results]
    return {
        "plex":        pl[0] if pl else None,
        "immich":      im[0] if im else None,
        "ha":          ha[0] if ha else None,
        "portainer":   pt[0] if pt else None,
        "uptime_kuma": uk[0] if uk else None,
    }

# ── Serve React SPA (must come last) ─────────────────────────────────────────
if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        file = FRONTEND / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND / "index.html")
