"""
LabDash Authentication — Password + TOTP 2FA
- Passwords: PBKDF2-HMAC-SHA256 (stdlib, no bcrypt needed)
- TOTP: pyotp (RFC 6238, compatible with Google Auth / Authy)
- Sessions: random tokens stored in SQLite, 12h TTL
- Temp tokens: 5-minute tokens for the login→TOTP step
"""
import hashlib, hmac, os, secrets, time
from functools import lru_cache

import pyotp
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import db

# ── Config ────────────────────────────────────────────────────────────────────
SESSION_TTL   = 12 * 3600   # 12 hours
TEMP_TTL      =  5 * 60     # 5 minutes
PBKDF2_ITERS  = 260_000     # OWASP 2023 recommendation

# ── Password hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERS)
    return f"pbkdf2:sha256:{PBKDF2_ITERS}:{salt}:{dk.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        _, alg, iters, salt, expected = stored.split(":", 4)
        dk = hashlib.pbkdf2_hmac(alg, password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), expected)
    except Exception:
        return False

# ── TOTP ──────────────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    return pyotp.random_base32()

def get_totp_uri(secret: str, username: str, issuer: str = "LabDash") -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)

def verify_totp(secret: str, code: str) -> bool:
    """Accepts current window ±1 (30s drift tolerance)."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code.strip(), valid_window=1)

# ── Session management ────────────────────────────────────────────────────────

async def create_session(user_id: int, is_temp: bool = False) -> str:
    token = secrets.token_urlsafe(32)
    ttl   = TEMP_TTL if is_temp else SESSION_TTL
    expires_at = int(time.time()) + ttl
    await db.create_session(token, user_id, expires_at, is_temp=is_temp)
    return token

async def verify_session(token: str, require_temp: bool = False) -> dict | None:
    """Returns user dict or None. Cleans up expired sessions lazily."""
    row = await db.get_session(token)
    if not row:
        return None
    token_db, user_id, expires_at, is_temp = row
    if int(time.time()) > expires_at:
        await db.delete_session(token)
        return None
    if require_temp and not is_temp:
        return None
    if not require_temp and is_temp:
        return None
    user = await db.get_user_by_id(user_id)
    return user

# ── FastAPI dependency ────────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)

async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    token = None
    if creds:
        token = creds.credentials
    if not token:
        # fallback: cookie
        token = request.cookies.get("labdash_session")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    user = await verify_session(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return user

async def get_temp_token_user(request: Request) -> tuple[str, dict]:
    """Returns (temp_token, user) — used in TOTP setup/verify routes."""
    token = request.headers.get("X-Temp-Token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing temp token")
    user = await verify_session(token, require_temp=True)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired temp token")
    return token, user

# ── Rate limiting (in-memory, simple) ────────────────────────────────────────

_login_attempts: dict[str, list[float]] = {}
_MAX_ATTEMPTS = 10
_WINDOW = 300  # 5 minutes

def check_rate_limit(key: str) -> None:
    now = time.time()
    attempts = [t for t in _login_attempts.get(key, []) if now - t < _WINDOW]
    _login_attempts[key] = attempts
    if len(attempts) >= _MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many login attempts. Try again in {_WINDOW // 60} minutes.",
        )
    _login_attempts[key].append(now)

def clear_rate_limit(key: str) -> None:
    _login_attempts.pop(key, None)

# ── Bootstrap ─────────────────────────────────────────────────────────────────

async def create_admin_if_needed() -> None:
    """Create admin user on first startup if no users exist."""
    count = await db.count_users()
    if count == 0:
        username = os.environ.get("LABDASH_USER", "admin")
        password = os.environ.get("LABDASH_PASS", "changeme")
        await db.create_user(username, hash_password(password))
        print(f"[auth] Created admin user: {username!r}")
        if password == "changeme":
            print("[auth] WARNING: Using default password — change it in Settings after login!")
