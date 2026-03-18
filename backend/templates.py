"""
Generic network diagram templates for LabDash.
Add new templates to the TEMPLATES dict below.
"""

# ── Template: Simple Home Lab ─────────────────────────────────────────────────
SIMPLE_HOMELAB: dict = {
    "nodes": [
        {"id": "hl-isp",   "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "ISP",          "ip": "WAN",          "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "hl-fw",    "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Router/Firewall","ip": "192.168.1.1", "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "hl-sw",    "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "Switch",        "ip": "L2",           "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "hl-wifi",  "type": "infra", "position": {"x": 80,  "y": 460},
         "data": {"label": "WiFi AP",       "ip": "192.168.1.2",  "ntype": "wifi",   "icon": "fa-wifi",            "color": "#63b3ed"}},
        {"id": "hl-srv",   "type": "infra", "position": {"x": 240, "y": 460},
         "data": {"label": "Home Server",   "ip": "192.168.1.10", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "hl-nas",   "type": "infra", "position": {"x": 400, "y": 460},
         "data": {"label": "NAS",           "ip": "192.168.1.20", "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
        {"id": "hl-pi",    "type": "infra", "position": {"x": 540, "y": 460},
         "data": {"label": "Raspberry Pi",  "ip": "192.168.1.30", "ntype": "server", "icon": "fa-microchip",       "color": "#68d391"}},
    ],
    "edges": [
        {"id": "e1", "source": "hl-isp",  "target": "hl-fw",   "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "hl-fw",   "target": "hl-sw",   "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e3", "source": "hl-sw",   "target": "hl-wifi", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "hl-sw",   "target": "hl-srv",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "hl-sw",   "target": "hl-nas",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        {"id": "e6", "source": "hl-sw",   "target": "hl-pi",   "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1}},
    ],
}

# ── Template: Small Office ────────────────────────────────────────────────────
SMALL_OFFICE: dict = {
    "nodes": [
        {"id": "so-isp",   "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "ISP",          "ip": "WAN",          "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "so-fw",    "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Firewall",     "ip": "192.168.0.1",  "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "so-sw",    "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "Core Switch",  "ip": "L2",           "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "so-wifi",  "type": "infra", "position": {"x": 80,  "y": 460},
         "data": {"label": "WiFi AP",      "ip": "192.168.0.50", "ntype": "wifi",   "icon": "fa-wifi",            "color": "#63b3ed"}},
        {"id": "so-srv1",  "type": "infra", "position": {"x": 220, "y": 460},
         "data": {"label": "Server 01",    "ip": "192.168.0.10", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "so-srv2",  "type": "infra", "position": {"x": 360, "y": 460},
         "data": {"label": "Server 02",    "ip": "192.168.0.11", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "so-nas",   "type": "infra", "position": {"x": 500, "y": 460},
         "data": {"label": "NAS / Storage","ip": "192.168.0.20", "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
        {"id": "so-print", "type": "infra", "position": {"x": 300, "y": 600},
         "data": {"label": "Impresora",    "ip": "192.168.0.60", "ntype": "generic","icon": "fa-print",           "color": "#fbd38d"}},
    ],
    "edges": [
        {"id": "e1", "source": "so-isp",  "target": "so-fw",    "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "so-fw",   "target": "so-sw",    "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e3", "source": "so-sw",   "target": "so-wifi",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "so-sw",   "target": "so-srv1",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "so-sw",   "target": "so-srv2",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e6", "source": "so-sw",   "target": "so-nas",   "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        {"id": "e7", "source": "so-sw",   "target": "so-print", "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
    ],
}

# ── Template: Dual WAN Failover ───────────────────────────────────────────────
DUAL_WAN: dict = {
    "nodes": [
        {"id": "dw-isp1",  "type": "infra", "position": {"x": 160, "y": 40},
         "data": {"label": "ISP Principal", "ip": "WAN 1",        "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "dw-isp2",  "type": "infra", "position": {"x": 440, "y": 40},
         "data": {"label": "ISP Failover",  "ip": "WAN 2",        "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#fbd38d"}},
        {"id": "dw-fw",    "type": "infra", "position": {"x": 300, "y": 200},
         "data": {"label": "Firewall",      "ip": "192.168.1.1",  "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "dw-sw",    "type": "infra", "position": {"x": 300, "y": 360},
         "data": {"label": "Core Switch",   "ip": "L2",           "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "dw-srv1",  "type": "infra", "position": {"x": 100, "y": 500},
         "data": {"label": "Servidor 01",   "ip": "192.168.1.10", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "dw-srv2",  "type": "infra", "position": {"x": 260, "y": 500},
         "data": {"label": "Servidor 02",   "ip": "192.168.1.11", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "dw-wifi",  "type": "infra", "position": {"x": 420, "y": 500},
         "data": {"label": "WiFi AP",       "ip": "192.168.1.50", "ntype": "wifi",   "icon": "fa-wifi",            "color": "#63b3ed"}},
        {"id": "dw-nas",   "type": "infra", "position": {"x": 580, "y": 500},
         "data": {"label": "NAS",           "ip": "192.168.1.20", "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
    ],
    "edges": [
        {"id": "e1", "source": "dw-isp1", "target": "dw-fw",   "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "dw-isp2", "target": "dw-fw",   "animated": True,  "style": {"stroke": "#fbd38d", "strokeWidth": 2, "strokeDasharray": "6 3"}},
        {"id": "e3", "source": "dw-fw",   "target": "dw-sw",   "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e4", "source": "dw-sw",   "target": "dw-srv1", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "dw-sw",   "target": "dw-srv2", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e6", "source": "dw-sw",   "target": "dw-wifi", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e7", "source": "dw-sw",   "target": "dw-nas",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

# ── Template: DMZ Architecture ────────────────────────────────────────────────
DMZ: dict = {
    "nodes": [
        {"id": "dmz-wan",  "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "Internet",      "ip": "WAN",          "ntype": "wan",    "icon": "fa-globe",           "color": "#68d391"}},
        {"id": "dmz-fw",   "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Firewall",      "ip": "192.168.1.1",  "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "dmz-swD",  "type": "infra", "position": {"x": 120, "y": 340},
         "data": {"label": "Switch DMZ",    "ip": "10.0.0.1",     "ntype": "switch", "icon": "fa-sitemap",         "color": "#fbd38d"}},
        {"id": "dmz-swL",  "type": "infra", "position": {"x": 480, "y": 340},
         "data": {"label": "Switch LAN",    "ip": "192.168.2.1",  "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "dmz-web",  "type": "infra", "position": {"x": 40,  "y": 480},
         "data": {"label": "Web Server",    "ip": "10.0.0.10",    "ntype": "server", "icon": "fa-globe",           "color": "#fbd38d"}},
        {"id": "dmz-prx",  "type": "infra", "position": {"x": 180, "y": 480},
         "data": {"label": "Reverse Proxy", "ip": "10.0.0.11",    "ntype": "server", "icon": "fa-arrows-left-right","color": "#fbd38d"}},
        {"id": "dmz-db",   "type": "infra", "position": {"x": 380, "y": 480},
         "data": {"label": "Database",      "ip": "192.168.2.10", "ntype": "server", "icon": "fa-database",        "color": "#63b3ed"}},
        {"id": "dmz-app",  "type": "infra", "position": {"x": 520, "y": 480},
         "data": {"label": "App Server",    "ip": "192.168.2.11", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "dmz-nas",  "type": "infra", "position": {"x": 660, "y": 480},
         "data": {"label": "NAS Interno",   "ip": "192.168.2.20", "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
    ],
    "edges": [
        {"id": "e1", "source": "dmz-wan",  "target": "dmz-fw",  "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "dmz-fw",   "target": "dmz-swD", "animated": True,  "style": {"stroke": "#fbd38d", "strokeWidth": 2}},
        {"id": "e3", "source": "dmz-fw",   "target": "dmz-swL", "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e4", "source": "dmz-swD",  "target": "dmz-web", "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
        {"id": "e5", "source": "dmz-swD",  "target": "dmz-prx", "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
        {"id": "e6", "source": "dmz-swL",  "target": "dmz-db",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e7", "source": "dmz-swL",  "target": "dmz-app", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e8", "source": "dmz-swL",  "target": "dmz-nas", "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

# ── Template: Kubernetes Cluster ──────────────────────────────────────────────
K8S_CLUSTER: dict = {
    "nodes": [
        {"id": "k-gw",  "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "Gateway",       "ip": "192.168.100.1",  "ntype": "router", "icon": "fa-shield-halved", "color": "#fc8181"}},
        {"id": "k-sw",  "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Switch",        "ip": "L2",              "ntype": "switch", "icon": "fa-sitemap",      "color": "#68d391"}},
        {"id": "k-cp",  "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "control-plane", "ip": "192.168.100.10",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#68d391"}},
        {"id": "k-w1",  "type": "infra", "position": {"x": 80,  "y": 460},
         "data": {"label": "worker-01",     "ip": "192.168.100.11",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#63b3ed"}},
        {"id": "k-w2",  "type": "infra", "position": {"x": 300, "y": 460},
         "data": {"label": "worker-02",     "ip": "192.168.100.12",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#63b3ed"}},
        {"id": "k-w3",  "type": "infra", "position": {"x": 520, "y": 460},
         "data": {"label": "worker-03",     "ip": "192.168.100.13",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#63b3ed"}},
        {"id": "k-lb",  "type": "infra", "position": {"x": 80,  "y": 600},
         "data": {"label": "Ingress / LB",  "ip": "192.168.100.200", "ntype": "generic","icon": "fa-shield-halved","color": "#fc8181"}},
        {"id": "k-nfs", "type": "infra", "position": {"x": 520, "y": 600},
         "data": {"label": "NFS Storage",   "ip": "192.168.100.80",  "ntype": "nas",    "icon": "fa-database",    "color": "#b794f4"}},
    ],
    "edges": [
        {"id": "e1", "source": "k-gw", "target": "k-sw",  "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e2", "source": "k-sw", "target": "k-cp",  "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e3", "source": "k-cp", "target": "k-w1",  "animated": True,  "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "k-cp", "target": "k-w2",  "animated": True,  "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "k-cp", "target": "k-w3",  "animated": True,  "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e6", "source": "k-w1", "target": "k-lb",  "animated": False, "style": {"stroke": "#fc8181", "strokeWidth": 1}},
        {"id": "e7", "source": "k-w3", "target": "k-nfs", "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

# ── Template: Multi-VLAN Enterprise ──────────────────────────────────────────
MULTI_VLAN: dict = {
    "nodes": [
        {"id": "mv-isp",  "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "ISP",           "ip": "WAN",          "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "mv-fw",   "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Firewall",      "ip": "10.0.0.1",     "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "mv-csw",  "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "Core Switch",   "ip": "VLAN Trunk",   "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "mv-v10",  "type": "infra", "position": {"x": 60,  "y": 460},
         "data": {"label": "VLAN 10 · Mgmt","ip": "10.10.10.x",   "ntype": "generic","icon": "fa-tag",             "color": "#63b3ed"}},
        {"id": "mv-v20",  "type": "infra", "position": {"x": 200, "y": 460},
         "data": {"label": "VLAN 20 · Srv", "ip": "10.10.20.x",   "ntype": "generic","icon": "fa-tag",             "color": "#b794f4"}},
        {"id": "mv-v30",  "type": "infra", "position": {"x": 340, "y": 460},
         "data": {"label": "VLAN 30 · WiFi","ip": "10.10.30.x",   "ntype": "generic","icon": "fa-tag",             "color": "#fbd38d"}},
        {"id": "mv-v40",  "type": "infra", "position": {"x": 480, "y": 460},
         "data": {"label": "VLAN 40 · IoT", "ip": "10.10.40.x",   "ntype": "generic","icon": "fa-tag",             "color": "#fc8181"}},
        {"id": "mv-v50",  "type": "infra", "position": {"x": 620, "y": 460},
         "data": {"label": "VLAN 50 · Guest","ip": "10.10.50.x",  "ntype": "generic","icon": "fa-tag",             "color": "#68d391"}},
        {"id": "mv-srv1", "type": "infra", "position": {"x": 160, "y": 600},
         "data": {"label": "Servidor 01",   "ip": "10.10.20.10",  "ntype": "server", "icon": "fa-server",          "color": "#b794f4"}},
        {"id": "mv-srv2", "type": "infra", "position": {"x": 280, "y": 600},
         "data": {"label": "Servidor 02",   "ip": "10.10.20.11",  "ntype": "server", "icon": "fa-server",          "color": "#b794f4"}},
        {"id": "mv-wifi", "type": "infra", "position": {"x": 340, "y": 600},
         "data": {"label": "WiFi AP",       "ip": "10.10.30.2",   "ntype": "wifi",   "icon": "fa-wifi",            "color": "#fbd38d"}},
    ],
    "edges": [
        {"id": "e1",  "source": "mv-isp",  "target": "mv-fw",   "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2",  "source": "mv-fw",   "target": "mv-csw",  "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e3",  "source": "mv-csw",  "target": "mv-v10",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e4",  "source": "mv-csw",  "target": "mv-v20",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e5",  "source": "mv-csw",  "target": "mv-v30",  "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e6",  "source": "mv-csw",  "target": "mv-v40",  "animated": False, "style": {"stroke": "#fc8181", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e7",  "source": "mv-csw",  "target": "mv-v50",  "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e8",  "source": "mv-v20",  "target": "mv-srv1", "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        {"id": "e9",  "source": "mv-v20",  "target": "mv-srv2", "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        {"id": "e10", "source": "mv-v30",  "target": "mv-wifi", "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
    ],
}

# ── Template: Proxmox Cluster ─────────────────────────────────────────────────
PROXMOX_CLUSTER: dict = {
    "nodes": [
        {"id": "px-isp",  "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "ISP",          "ip": "WAN",          "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "px-fw",   "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Firewall",     "ip": "192.168.1.1",  "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "px-sw",   "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "Switch",       "ip": "L2",           "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "px-n1",   "type": "infra", "position": {"x": 80,  "y": 460},
         "data": {"label": "pve-node-01",  "ip": "192.168.1.11", "ntype": "server", "icon": "fa-cubes",           "color": "#63b3ed"}},
        {"id": "px-n2",   "type": "infra", "position": {"x": 300, "y": 460},
         "data": {"label": "pve-node-02",  "ip": "192.168.1.12", "ntype": "server", "icon": "fa-cubes",           "color": "#63b3ed"}},
        {"id": "px-n3",   "type": "infra", "position": {"x": 520, "y": 460},
         "data": {"label": "pve-node-03",  "ip": "192.168.1.13", "ntype": "server", "icon": "fa-cubes",           "color": "#63b3ed"}},
        {"id": "px-ceph", "type": "infra", "position": {"x": 80,  "y": 600},
         "data": {"label": "Ceph / Shared","ip": "Cluster Net",  "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
        {"id": "px-vm1",  "type": "infra", "position": {"x": 240, "y": 600},
         "data": {"label": "VM / LXC",     "ip": "192.168.1.20", "ntype": "vm",     "icon": "fa-display",         "color": "#68d391"}},
        {"id": "px-vm2",  "type": "infra", "position": {"x": 380, "y": 600},
         "data": {"label": "VM / LXC",     "ip": "192.168.1.21", "ntype": "vm",     "icon": "fa-display",         "color": "#68d391"}},
        {"id": "px-nas",  "type": "infra", "position": {"x": 520, "y": 600},
         "data": {"label": "NAS Storage",  "ip": "192.168.1.80", "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
    ],
    "edges": [
        {"id": "e1", "source": "px-isp",  "target": "px-fw",   "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "px-fw",   "target": "px-sw",   "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e3", "source": "px-sw",   "target": "px-n1",   "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "px-sw",   "target": "px-n2",   "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "px-sw",   "target": "px-n3",   "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e6", "source": "px-n1",   "target": "px-ceph", "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        {"id": "e7", "source": "px-n2",   "target": "px-vm1",  "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1}},
        {"id": "e8", "source": "px-n2",   "target": "px-vm2",  "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1}},
        {"id": "e9", "source": "px-n3",   "target": "px-nas",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

# ── Template: Docker / Self-hosted ────────────────────────────────────────────
DOCKER_HOST: dict = {
    "nodes": [
        {"id": "dk-isp",  "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "ISP",          "ip": "WAN",          "ntype": "wan",    "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "dk-fw",   "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Router",       "ip": "192.168.1.1",  "ntype": "router", "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "dk-sw",   "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "Switch",       "ip": "L2",           "ntype": "switch", "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "dk-host", "type": "infra", "position": {"x": 300, "y": 460},
         "data": {"label": "Docker Host",  "ip": "192.168.1.10", "ntype": "server", "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "dk-prx",  "type": "infra", "position": {"x": 80,  "y": 600},
         "data": {"label": "Traefik",      "ip": ":80/:443",     "ntype": "generic","icon": "fa-arrows-left-right","color": "#fbd38d"}},
        {"id": "dk-arr",  "type": "infra", "position": {"x": 220, "y": 600},
         "data": {"label": "*arr Stack",   "ip": ":8989…",       "ntype": "vm",     "icon": "fa-film",            "color": "#b794f4"}},
        {"id": "dk-mon",  "type": "infra", "position": {"x": 360, "y": 600},
         "data": {"label": "Monitoring",   "ip": "Grafana…",     "ntype": "generic","icon": "fa-chart-line",      "color": "#68d391"}},
        {"id": "dk-nas",  "type": "infra", "position": {"x": 500, "y": 600},
         "data": {"label": "NAS / Volumes","ip": "192.168.1.20", "ntype": "nas",    "icon": "fa-database",        "color": "#b794f4"}},
        {"id": "dk-wifi", "type": "infra", "position": {"x": 500, "y": 460},
         "data": {"label": "WiFi AP",      "ip": "192.168.1.50", "ntype": "wifi",   "icon": "fa-wifi",            "color": "#63b3ed"}},
    ],
    "edges": [
        {"id": "e1", "source": "dk-isp",  "target": "dk-fw",   "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "dk-fw",   "target": "dk-sw",   "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e3", "source": "dk-sw",   "target": "dk-host", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "dk-sw",   "target": "dk-wifi", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "dk-host", "target": "dk-prx",  "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
        {"id": "e6", "source": "dk-host", "target": "dk-arr",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        {"id": "e7", "source": "dk-host", "target": "dk-mon",  "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1}},
        {"id": "e8", "source": "dk-host", "target": "dk-nas",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

# ── Registry ──────────────────────────────────────────────────────────────────
TEMPLATES = {
    "simple-homelab": {
        "name": "Home Lab simple",
        "description": "ISP → Router → Switch → Servidor + NAS + WiFi + Raspberry Pi. Punto de partida para cualquier home lab.",
        "diagram": SIMPLE_HOMELAB,
    },
    "small-office": {
        "name": "Oficina pequeña",
        "description": "ISP → Firewall → Switch → WiFi AP + 2 servidores + NAS + impresora. Template genérico para oficinas o branches.",
        "diagram": SMALL_OFFICE,
    },
    "dual-wan": {
        "name": "Dual WAN / Failover",
        "description": "Dos ISPs (principal + failover) → Firewall → Switch → Infraestructura. Ideal para alta disponibilidad de red.",
        "diagram": DUAL_WAN,
    },
    "dmz": {
        "name": "Arquitectura DMZ",
        "description": "WAN → Firewall → Switch DMZ (web, proxy) + Switch LAN (DB, app, NAS). Segmentación segura para servicios públicos.",
        "diagram": DMZ,
    },
    "k8s-cluster": {
        "name": "Kubernetes Multi-Node",
        "description": "Gateway → Switch → Control Plane → 3 Workers + Ingress LB + NFS Storage. Template para clústeres k8s/k3s.",
        "diagram": K8S_CLUSTER,
    },
    "multi-vlan": {
        "name": "Multi-VLAN Enterprise",
        "description": "Firewall → Core Switch → VLANs (Mgmt, Servers, WiFi, IoT, Guest). Segmentación avanzada para redes empresariales.",
        "diagram": MULTI_VLAN,
    },
    "proxmox-cluster": {
        "name": "Clúster Proxmox VE",
        "description": "Router → Switch → 3 nodos Proxmox con Ceph/storage compartido + VMs/LXC + NAS. Template para virtualización.",
        "diagram": PROXMOX_CLUSTER,
    },
    "docker-host": {
        "name": "Docker / Self-hosted",
        "description": "Router → Switch → Docker Host (Traefik + *arr + Monitoring) + NAS + WiFi. Template para stacks self-hosted.",
        "diagram": DOCKER_HOST,
    },
}
