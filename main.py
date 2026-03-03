#!/usr/bin/env python3
"""MXHOME Dynamic Dashboard - queries Proxmox API on every request"""
import json, ssl, time, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import URLError
from collections import defaultdict

PVE_URL  = os.environ.get("PVE_URL",  "https://192.168.1.7:8006")
PVE_USER = os.environ.get("PVE_USER", "root@pam")
PVE_PASS = os.environ.get("PVE_PASS", "alguna")
CACHE_TTL = 20  # seconds

_cache = {"data": None, "ts": 0}
_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE

def pve_get(path, ticket):
    req = Request(f"{PVE_URL}/api2/json{path}", headers={"Cookie": f"PVEAuthCookie={ticket}"})
    with urlopen(req, context=_ctx, timeout=8) as r:
        return json.loads(r.read())["data"]

def fetch_data():
    global _cache
    if _cache["data"] and time.time() - _cache["ts"] < CACHE_TTL:
        return _cache["data"], None
    try:
        body = urlencode({"username": PVE_USER, "password": PVE_PASS}).encode()
        req = Request(f"{PVE_URL}/api2/json/access/ticket", data=body, method="POST")
        with urlopen(req, context=_ctx, timeout=8) as r:
            auth = json.loads(r.read())["data"]
        ticket = auth["ticket"]
        resources = pve_get("/cluster/resources", ticket)
        nodes     = pve_get("/nodes", ticket)
        data = {"resources": resources, "nodes": nodes, "ticket": ticket}
        _cache = {"data": data, "ts": time.time()}
        return data, None
    except Exception as e:
        return _cache["data"], str(e)

def fmt_bytes(b):
    for u in ["B","KB","MB","GB","TB"]:
        if b < 1024: return f"{b:.1f} {u}"
        b /= 1024
    return f"{b:.1f} PB"

def row(key, val, cls=""):
    return f'<div class="sr"><span class="sk">{key}</span><span class="sv {cls}">{val}</span></div>'

def pill(txt, cls="pg"):
    dot = '<span class="dot dg" style="width:5px;height:5px"></span>' if cls=="pg" else ""
    return f'<span class="pill {cls}">{dot}{txt}</span>'

def badge_type(t):
    if t == "lxc":
        return '<span class="lxc-badge">LXC</span>'
    return '<span class="vm-badge">VM</span>'

def generate_html(data, err):
    resources = data["resources"] if data else []
    nodes_raw = data["nodes"] if data else []

    # Organise VMs/LXC
    items = [r for r in resources if r.get("type") in ("qemu","lxc")]
    templates = [r for r in items if r.get("template")]
    vms = [r for r in items if not r.get("template")]
    running = [r for r in vms if r.get("status") == "running"]
    by_node = defaultdict(list)
    for r in items:
        by_node[r["node"]].append(r)

    # Node stats
    node_info = {n["node"]: n for n in nodes_raw}

    total_vms = len(vms)
    total_run = len(running)
    total_tmpl = len(templates)
    total_nodes = len(set(r["node"] for r in resources if r.get("type")=="node") or node_info.keys())

    err_banner = f'<div style="background:rgba(252,129,129,.1);border:1px solid rgba(252,129,129,.3);border-radius:8px;padding:10px 16px;margin-bottom:20px;font-size:12px;color:#fc8181"><i class="fa-solid fa-triangle-exclamation"></i> Error al conectar con Proxmox: {err} (mostrando caché)</div>' if err else ""

    # Build node sections
    node_sections = ""
    sorted_nodes = sorted(by_node.keys())
    for node in sorted_nodes:
        node_vms = sorted(by_node[node], key=lambda x: x.get("vmid",0))
        ni = node_info.get(node, {})
        n_run = sum(1 for v in node_vms if v.get("status")=="running" and not v.get("template"))
        n_all = sum(1 for v in node_vms if not v.get("template"))
        n_tmpl = sum(1 for v in node_vms if v.get("template"))
        cpu_pct = round(ni.get("cpu",0)*100, 1)
        mem_used = ni.get("mem",0)
        mem_max  = ni.get("maxmem",1)
        mem_pct  = round(mem_used/mem_max*100, 1) if mem_max else 0
        node_status = ni.get("status","unknown")
        node_pill = pill("Online","pg") if node_status=="online" else pill("Offline","pr")

        rows = ""
        for v in node_vms:
            if v.get("template"):
                continue
            vmid = v.get("vmid","")
            name = v.get("name","")
            typ  = v.get("type","")
            stat = v.get("status","")
            mem  = v.get("maxmem",0)//1048576
            disk = round(v.get("maxdisk",0)/1073741824,1)
            uptime = v.get("uptime",0)
            stat_pill = pill("Running","pg") if stat=="running" else pill("Stopped","py")
            mem_str  = f"{mem} MB" if mem < 1024 else f"{mem//1024} GB"
            disk_str = f"{disk} GB" if disk > 0 else "—"
            rows += f"""
            <tr>
              <td class="vy">{vmid}</td>
              <td>{badge_type(typ)}</td>
              <td>{name}</td>
              <td>{mem_str}</td>
              <td>{disk_str}</td>
              <td>{stat_pill}</td>
            </tr>"""

        node_sections += f"""
        <div style="margin-bottom:24px">
          <div class="node-hdr" style="margin-bottom:12px">
            <i class="fa-solid fa-cubes" style="color:var(--accent)"></i>
            <div><div class="nh">{node}</div><div class="ns">{n_all} VMs/LXC · {n_run} running · {n_tmpl} templates</div></div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:var(--muted)">CPU <span style="color:var(--accent4)">{cpu_pct}%</span></span>
              <span style="font-size:11px;color:var(--muted)">RAM <span style="color:var(--accent2)">{mem_pct}%</span></span>
              {node_pill}
            </div>
          </div>
          <div class="card">
            <table class="vt">
              <tr><th>ID</th><th>Tipo</th><th>Nombre</th><th>RAM</th><th>Disco</th><th>Estado</th></tr>
              {rows}
            </table>
          </div>
        </div>"""

    # Templates section
    tmpl_cards = ""
    os_emoji = {"ubuntu":"🐧","debian":"🌀","rocky":"🪨","alma":"⭐","alpine":"🏔️","centos":"🎩","fedora":"🎩","windows":"🪟","win":"🪟"}
    for t in sorted(templates, key=lambda x: x.get("vmid",0)):
        name = t.get("name","")
        vmid = t.get("vmid","")
        emoji = "🖥️"
        for k,v in os_emoji.items():
            if k in name.lower(): emoji=v; break
        disk = round(t.get("maxdisk",0)/1073741824,1)
        mem  = t.get("maxmem",0)//1048576
        mem_str = f"{mem} MB" if mem<1024 else f"{mem//1024} GB"
        tmpl_cards += f"""
        <div class="tmpl-c">
          <div style="font-size:26px">{emoji}</div>
          <div>
            <div style="font-size:13px;font-weight:600">{name}</div>
            <div style="font-size:11px;color:var(--muted);font-family:JetBrains Mono,monospace">{mem_str} · {disk} GB disk</div>
          </div>
          <div class="tid">#{vmid}</div>
        </div>"""

    ts = time.strftime("%H:%M:%S UTC", time.gmtime())
    cache_age = round(time.time() - _cache["ts"]) if _cache["ts"] else 0

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>MXHOME — Infrastructure Dashboard</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{{--bg:#0a0e1a;--card:rgba(255,255,255,0.04);--border:rgba(99,179,237,0.15);--accent:#63b3ed;--accent2:#68d391;--accent3:#fc8181;--accent4:#fbd38d;--text:#e2e8f0;--muted:#718096;--glow:rgba(99,179,237,0.3)}}
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{background:var(--bg);color:var(--text);font-family:Inter,sans-serif;min-height:100vh;overflow-x:hidden}}
    body::before{{content:"";position:fixed;inset:0;background-image:linear-gradient(rgba(99,179,237,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(99,179,237,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}}
    .wrap{{max-width:1500px;margin:0 auto;padding:0 24px;position:relative;z-index:1}}
    header{{padding:32px 0 24px;border-bottom:1px solid var(--border);margin-bottom:32px}}
    .hdr{{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}}
    .logo{{display:flex;align-items:center;gap:16px}}
    .logo-icon{{width:52px;height:52px;background:linear-gradient(135deg,#2b6cb0,#63b3ed);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 0 20px var(--glow)}}
    .logo h1{{font-size:28px;font-weight:700}}.logo h1 span{{color:var(--accent)}}
    .logo p{{color:var(--muted);font-size:13px;margin-top:2px}}
    .badges{{display:flex;gap:8px;flex-wrap:wrap}}
    .badge{{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:500}}
    .dot{{width:7px;height:7px;border-radius:50%;animation:pulse 2s infinite}}
    .dg{{background:var(--accent2);box-shadow:0 0 6px var(--accent2)}}.db{{background:var(--accent);box-shadow:0 0 6px var(--accent)}}.dy{{background:var(--accent4);box-shadow:0 0 6px var(--accent4)}}
    @keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:.4}}}}
    .stats-bar{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:36px}}
    .stat-card{{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center}}
    .stat-card .sv{{font-size:26px;font-weight:700;font-family:"JetBrains Mono",monospace}}
    .stat-card .sk{{font-size:11px;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:1px}}
    .sec{{margin-bottom:40px}}
    .sec-t{{font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-bottom:16px;display:flex;align-items:center;gap:10px}}
    .sec-t::after{{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)}}
    .g3{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}}
    .g2{{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px}}
    .g5{{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}}
    .card{{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;transition:all .2s;backdrop-filter:blur(8px)}}
    .card:hover{{border-color:rgba(99,179,237,.4);transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.3)}}
    .ch{{display:flex;align-items:center;gap:12px;margin-bottom:14px}}
    .ci{{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}}
    .ib{{background:rgba(99,179,237,.15);color:var(--accent)}}.ig{{background:rgba(104,211,145,.15);color:var(--accent2)}}.ir{{background:rgba(252,129,129,.15);color:var(--accent3)}}.iy{{background:rgba(251,211,141,.15);color:var(--accent4)}}.ip{{background:rgba(183,148,246,.15);color:#b794f4}}.ic{{background:rgba(129,230,217,.15);color:#81e6d9}}
    .ct{{font-size:15px;font-weight:600}}.cs{{font-size:11px;color:var(--muted);margin-top:1px}}
    .sr{{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px}}
    .sr:last-child{{border-bottom:none}}.sk{{color:var(--muted)}}.sv{{font-family:"JetBrains Mono",monospace;font-size:12px}}
    .vb{{color:var(--accent)}}.vg{{color:var(--accent2)}}.vy{{color:var(--accent4)}}.vr{{color:var(--accent3)}}.vp{{color:#b794f4}}
    .pill{{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px}}
    .pg{{background:rgba(104,211,145,.15);color:var(--accent2)}}.py{{background:rgba(251,211,141,.15);color:var(--accent4)}}.pr{{background:rgba(252,129,129,.15);color:var(--accent3)}}.pb{{background:rgba(99,179,237,.15);color:var(--accent)}}
    .net{{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:32px;margin-bottom:40px}}
    .net-t{{text-align:center;font-size:13px;color:var(--muted);margin-bottom:28px;letter-spacing:1px;text-transform:uppercase}}
    .nn{{display:flex;flex-direction:column;align-items:center;gap:6px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px;padding:12px 16px;min-width:95px;text-align:center;transition:all .2s}}
    .nn:hover{{border-color:var(--accent);box-shadow:0 0 16px var(--glow)}}
    .nn i{{font-size:22px}}.nm{{font-size:11px;font-weight:600}}.ni{{font-size:10px;color:var(--muted);font-family:"JetBrains Mono",monospace}}
    .nl{{width:2px;height:24px;background:linear-gradient(180deg,var(--accent),rgba(99,179,237,.2));position:relative}}
    .nl::after{{content:"";position:absolute;bottom:0;left:50%;transform:translateX(-50%);border-left:4px solid transparent;border-right:4px solid transparent;border-top:6px solid var(--accent)}}
    .vl{{font-size:10px;font-weight:600;color:var(--accent4);background:rgba(251,211,141,.1);border:1px solid rgba(251,211,141,.2);border-radius:6px;padding:2px 8px;font-family:"JetBrains Mono",monospace;white-space:nowrap}}
    .vl-b{{color:var(--accent);background:rgba(99,179,237,.1);border-color:rgba(99,179,237,.2)}}
    .vl-g{{color:var(--accent2);background:rgba(104,211,145,.1);border-color:rgba(104,211,145,.2)}}
    .vl-p{{color:#b794f4;background:rgba(183,148,246,.1);border-color:rgba(183,148,246,.2)}}
    .vl-r{{color:var(--accent3);background:rgba(252,129,129,.1);border-color:rgba(252,129,129,.2)}}
    .col{{display:flex;flex-direction:column;align-items:center}}
    .row{{display:flex;justify-content:center;align-items:flex-start;gap:16px;flex-wrap:wrap}}
    .vt{{width:100%;border-collapse:collapse;font-size:12px}}
    .vt th{{text-align:left;padding:7px 10px;color:var(--muted);font-size:10px;font-weight:600;border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:.5px}}
    .vt td{{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.03);font-family:"JetBrains Mono",monospace;font-size:11px}}
    .vt tr:last-child td{{border-bottom:none}}.vt tr:hover td{{background:rgba(255,255,255,.02)}}
    .lxc-badge{{display:inline-block;font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(129,230,217,.15);color:#81e6d9;border:1px solid rgba(129,230,217,.2)}}
    .vm-badge{{display:inline-block;font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(99,179,237,.1);color:var(--accent);border:1px solid rgba(99,179,237,.2)}}
    .node-hdr{{display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:10px}}
    .node-hdr i{{font-size:20px}}.nh{{font-size:14px;font-weight:600}}.ns{{font-size:11px;color:var(--muted)}}
    .tmpl-c{{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;transition:all .2s}}
    .tmpl-c:hover{{border-color:rgba(99,179,237,.4);transform:translateY(-1px)}}
    .tid{{margin-left:auto;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);background:rgba(255,255,255,.05);padding:3px 8px;border-radius:6px}}
    .live-badge{{display:inline-flex;align-items:center;gap:5px;background:rgba(104,211,145,.08);border:1px solid rgba(104,211,145,.2);border-radius:8px;padding:4px 10px;font-size:11px;color:var(--accent2)}}
    footer{{margin-top:60px;padding:24px 0;border-top:1px solid var(--border);text-align:center;color:var(--muted);font-size:12px}}
    footer span{{color:var(--accent)}}
    @media(max-width:700px){{.hdr{{flex-direction:column}}.row{{flex-direction:column;align-items:center}}.stats-bar{{grid-template-columns:repeat(2,1fr)}}}}
  </style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="hdr">
      <div class="logo">
        <div class="logo-icon"><i class="fa-solid fa-server"></i></div>
        <div>
          <h1>MX<span>HOME</span></h1>
          <p>Home Lab Infrastructure Dashboard — Live desde Proxmox API</p>
        </div>
      </div>
      <div class="badges">
        <div class="live-badge"><span class="dot dg"></span> LIVE · actualizado {ts}</div>
        <div class="badge"><span class="dot dg"></span> PVE 9.1.6 · {len(node_info)} nodos</div>
        <div class="badge"><span class="dot dg"></span> K3s v1.34.4</div>
        <div class="badge"><span class="dot dg"></span> OPNsense</div>
        <div class="badge"><span class="dot dy"></span> Digi 10G + KEIO 600M</div>
      </div>
    </div>
  </header>

  {err_banner}

  <!-- Stats bar (dinámico) -->
  <div class="stats-bar">
    <div class="stat-card"><div class="sv" style="color:var(--accent)">{len(node_info)}</div><div class="sk">Nodos Proxmox</div></div>
    <div class="stat-card"><div class="sv" style="color:var(--accent2)">{total_run}</div><div class="sk">Running</div></div>
    <div class="stat-card"><div class="sv" style="color:var(--accent4)">{total_vms}</div><div class="sk">VMs/LXC Total</div></div>
    <div class="stat-card"><div class="sv" style="color:#b794f4">{total_tmpl}</div><div class="sk">Templates</div></div>
    <div class="stat-card"><div class="sv" style="color:#81e6d9">6</div><div class="sk">VLANs</div></div>
    <div class="stat-card"><div class="sv" style="color:var(--accent3)">2</div><div class="sk">WAN Links</div></div>
    <div class="stat-card"><div class="sv" style="color:var(--accent2)">~2.6 TB</div><div class="sk">Storage</div></div>
    <div class="stat-card"><div class="sv" style="color:var(--accent4)">{cache_age}s</div><div class="sk">Caché age</div></div>
  </div>

  <!-- Network Diagram (estático, no cambia) -->
  <div class="net">
    <div class="net-t"><i class="fa-solid fa-network-wired"></i> &nbsp; Topología de Red — MXHOME</div>
    <div class="row" style="margin-bottom:4px">
      <div class="nn" style="border-color:rgba(104,211,145,.35)"><i class="fa-solid fa-tower-broadcast" style="color:#68d391"></i><div class="nm">Digi 10G</div><div class="ni">WAN Principal</div></div>
      <div class="nn" style="border-color:rgba(251,211,141,.35)"><i class="fa-solid fa-tower-broadcast" style="color:#fbd38d"></i><div class="nm">KEIO 600M</div><div class="ni">WAN Failover</div></div>
    </div>
    <div style="display:flex;justify-content:center;gap:120px">
      <div class="col"><div class="nl" style="background:linear-gradient(180deg,#68d391,rgba(104,211,145,.2))"></div></div>
      <div class="col"><div class="nl" style="background:linear-gradient(180deg,#fbd38d,rgba(251,211,141,.2))"></div></div>
    </div>
    <div style="display:flex;justify-content:center;margin-bottom:4px">
      <div class="nn" style="border-color:rgba(252,129,129,.4);background:rgba(252,129,129,.05)">
        <i class="fa-solid fa-shield-halved" style="color:#fc8181"></i>
        <div class="nm">OPNsense</div><div class="ni">VM 102 · pve-M90Q</div><div class="ni">192.168.1.1</div>
        <span class="pill pg" style="font-size:9px;margin-top:2px"><span class="dot dg" style="width:5px;height:5px"></span>Running</span>
      </div>
    </div>
    <div class="col" style="align-items:center"><div class="nl"></div></div>
    <div style="display:flex;justify-content:center;margin-bottom:4px">
      <div class="nn" style="border-color:rgba(104,211,145,.3)"><i class="fa-solid fa-sitemap" style="color:#68d391"></i><div class="nm">Core Switch</div><div class="ni">VLAN Trunk</div></div>
    </div>
    <div class="row" style="margin-top:16px;gap:10px;align-items:flex-start">
      <div class="col" style="gap:4px"><div class="vl vl-b">VLAN 1 · LAN</div><div style="font-size:9px;color:var(--muted);font-family:JetBrains Mono,monospace">192.168.1.x · Gestión</div><div class="nl"></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div class="nn"><i class="fa-solid fa-cubes" style="color:#63b3ed"></i><div class="nm">pve-m90G1</div><div class="ni">192.168.1.7</div></div>
          <div class="nn"><i class="fa-solid fa-cubes" style="color:#63b3ed"></i><div class="nm">pve-M90Q</div><div class="ni">192.168.1.x</div></div>
          <div class="nn"><i class="fa-solid fa-cubes" style="color:#63b3ed"></i><div class="nm">pve-Jonsbo</div><div class="ni">192.168.1.9</div></div>
          <div class="nn"><i class="fa-solid fa-database" style="color:#b794f4"></i><div class="nm">DSM NAS</div><div class="ni">192.168.1.80</div></div>
        </div>
      </div>
      <div class="col" style="gap:4px"><div class="vl" style="color:#fbd38d">VLAN 20 · WAN</div><div style="font-size:9px;color:var(--muted);font-family:JetBrains Mono,monospace">Digi 10G</div><div class="nl" style="background:linear-gradient(180deg,#fbd38d,rgba(251,211,141,.2))"></div><div class="nn" style="border-color:rgba(251,211,141,.3)"><i class="fa-solid fa-plug" style="color:#fbd38d"></i><div class="nm">WAN-A</div><div class="ni">uplink</div></div></div>
      <div class="col" style="gap:4px"><div class="vl vl-r">VLAN 30 · WAN-B</div><div style="font-size:9px;color:var(--muted);font-family:JetBrains Mono,monospace">KEIO 600M</div><div class="nl" style="background:linear-gradient(180deg,#fc8181,rgba(252,129,129,.2))"></div><div class="nn" style="border-color:rgba(252,129,129,.3)"><i class="fa-solid fa-plug" style="color:#fc8181"></i><div class="nm">WAN-B</div><div class="ni">failover</div></div></div>
      <div class="col" style="gap:4px"><div class="vl vl-b">VLAN 25 · WiFi</div><div style="font-size:9px;color:var(--muted);font-family:JetBrains Mono,monospace">192.168.2.x</div><div class="nl" style="background:linear-gradient(180deg,#63b3ed,rgba(99,179,237,.2))"></div><div class="nn" style="border-color:rgba(99,179,237,.3)"><i class="fa-solid fa-wifi" style="color:#63b3ed"></i><div class="nm">WiFi AP</div><div class="ni">192.168.2.x</div></div></div>
      <div class="col" style="gap:4px"><div class="vl vl-g">VLAN 50 · Homelab</div><div style="font-size:9px;color:var(--muted);font-family:JetBrains Mono,monospace">192.168.3.x</div><div class="nl" style="background:linear-gradient(180deg,#68d391,rgba(104,211,145,.2))"></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div class="nn"><i class="fa-solid fa-dharmachakra" style="color:#68d391"></i><div class="nm">k3s-single</div><div class="ni">192.168.3.202</div></div>
          <div class="nn"><i class="fa-solid fa-shield-halved" style="color:#fc8181"></i><div class="nm">Ingress LB</div><div class="ni">192.168.3.220</div></div>
        </div>
      </div>
      <div class="col" style="gap:4px"><div class="vl vl-p">VLAN 60 · MAAS</div><div style="font-size:9px;color:var(--muted);font-family:JetBrains Mono,monospace">10.10.9.x</div><div class="nl" style="background:linear-gradient(180deg,#b794f4,rgba(183,148,246,.2))"></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div class="nn"><i class="fa-solid fa-server" style="color:#b794f4"></i><div class="nm">maas-ctrl</div><div class="ni">10.10.9.x</div></div>
          <div class="nn"><i class="fa-solid fa-network-wired" style="color:#b794f4"></i><div class="nm">juju-ctrl</div><div class="ni">10.10.9.x</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- VMs por nodo (DINÁMICO) -->
  <div class="sec">
    <div class="sec-t"><i class="fa-solid fa-display"></i> Inventario en tiempo real — {total_vms} VMs/LXC · {total_run} running · {total_tmpl} templates</div>
    {node_sections}
  </div>

  <!-- Templates (DINÁMICO) -->
  <div class="sec">
    <div class="sec-t"><i class="fa-solid fa-clone"></i> Cloud-Init Templates ({total_tmpl} disponibles)</div>
    <div class="g5">{tmpl_cards}</div>
  </div>

  <!-- K3s (estático) -->
  <div class="sec">
    <div class="sec-t"><i class="fa-solid fa-dharmachakra"></i> Kubernetes — k3s-single · 192.168.3.202</div>
    <div class="g2">
      <div class="card">
        <div class="ch"><div class="ci ig"><i class="fa-solid fa-dharmachakra"></i></div><div><div class="ct">k3s-single (VM 200)</div><div class="cs">Ubuntu 24.04 · pve-m90G1 · control-plane</div></div><span class="pill pg" style="margin-left:auto"><span class="dot dg" style="width:5px;height:5px"></span>Ready</span></div>
        {row("k3s","v1.34.4+k3s1","vg")}{row("Helm","v3.20.0","vy")}{row("CPU / RAM","4 vCPU · 8 GB")}{row("Ingress IP","192.168.3.220","vb")}
      </div>
      <div class="card">
        <div class="ch"><div class="ci ib"><i class="fa-solid fa-cubes-stacked"></i></div><div><div class="ct">Stack instalado</div></div></div>
        <table class="vt">
          <tr><th>Componente</th><th>Versión</th><th>Estado</th></tr>
          <tr><td>MetalLB</td><td>v0.14.9 · pool .220-.240</td><td><span class="pill pg">Running</span></td></tr>
          <tr><td>Ingress NGINX</td><td>192.168.3.220</td><td><span class="pill pg">Running</span></td></tr>
          <tr><td>cert-manager</td><td>v1.19.4</td><td><span class="pill pg">Running</span></td></tr>
          <tr><td>metrics-server</td><td>built-in</td><td><span class="pill pg">Running</span></td></tr>
          <tr><td>mxhome dashboard</td><td>live · auto-refresh 30s</td><td><span class="pill pg">Running</span></td></tr>
        </table>
      </div>
    </div>
  </div>

  <footer>
    <p>MXHOME Infrastructure Dashboard &nbsp;·&nbsp; <span>OPNsense</span> + <span>Proxmox VE 9.1</span> + <span>K3s</span> + <span>openclaw AI</span></p>
    <p style="margin-top:6px;font-size:11px;color:#4a5568">Live data desde Proxmox API · auto-refresh 30s · caché {cache_age}s · {ts} &nbsp;·&nbsp; Dual WAN · 6 VLANs · 2026</p>
  </footer>
</div>
</body>
</html>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type","text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        data, err = fetch_data()
        html = generate_html(data, err)
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type","text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]} {args[1]}")

if __name__ == "__main__":
    port = int(os.environ.get("PORT","8080"))
    print(f"MXHOME backend starting on :{port}")
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
