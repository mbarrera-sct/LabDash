"""API tests for LabDash backend."""
import sys
import os

# Ensure the backend directory is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """Create a TestClient with a fresh app instance."""
    from main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ── 1. GET /healthz returns 200 ───────────────────────────────────────────────
def test_healthz(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200


# ── 2. GET /healthz/live returns 200 ─────────────────────────────────────────
def test_healthz_live(client):
    resp = client.get("/healthz/live")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"


# ── 3. GET /healthz/ready returns 200 or 503 with status key ─────────────────
def test_healthz_ready(client):
    resp = client.get("/healthz/ready")
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "status" in data


# ── 4. GET /api/auth/login with bad method returns 405 ───────────────────────
def test_get_login_not_allowed(client):
    resp = client.get("/api/auth/login")
    assert resp.status_code == 405


# ── 5. POST /api/auth/login with bad credentials returns 401 ─────────────────
def test_post_login_bad_credentials(client):
    resp = client.post(
        "/api/auth/login",
        json={"username": "wrong", "password": "wrong"},
    )
    assert resp.status_code == 401


# ── 6. GET /api/maintenance returns 200 with enabled bool ────────────────────
def test_get_maintenance(client):
    resp = client.get("/api/maintenance")
    assert resp.status_code == 200
    data = resp.json()
    assert "enabled" in data
    assert isinstance(data["enabled"], bool)


# ── 7. GET /metrics returns 200 with text/plain content-type ─────────────────
def test_prometheus_metrics(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
    ct = resp.headers.get("content-type", "")
    assert "text/plain" in ct


# ── 8. Auth-protected endpoints return 401 without token ─────────────────────
def test_protected_endpoint_requires_auth(client):
    resp = client.get("/api/proxmox/nodes")
    assert resp.status_code == 401
