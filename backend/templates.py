"""
MXHOME network diagram templates.
Add more templates here, they will be selectable from the frontend.
"""

MXHOME_TOPOLOGY: dict = {
    "nodes": [
        # ── WANs ──────────────────────────────────────────────────────────
        {
            "id": "wan-digi",
            "type": "infra",
            "position": {"x": 200, "y": 30},
            "data": {
                "label": "Digi 10G",
                "ip": "WAN Principal",
                "ntype": "wan",
                "icon": "fa-tower-broadcast",
                "color": "#68d391",
            },
        },
        {
            "id": "wan-keio",
            "type": "infra",
            "position": {"x": 420, "y": 30},
            "data": {
                "label": "KEIO 600M",
                "ip": "WAN Failover",
                "ntype": "wan",
                "icon": "fa-tower-broadcast",
                "color": "#68d391",
            },
        },
        # ── Router/Firewall ───────────────────────────────────────────────
        {
            "id": "opnsense",
            "type": "infra",
            "position": {"x": 310, "y": 175},
            "data": {
                "label": "OPNsense",
                "ip": "VM 102 · pve-M9Q · 192.168.1.1",
                "ntype": "router",
                "icon": "fa-shield-halved",
                "color": "#fc8181",
                "status": "ok",
            },
        },
        # ── Core Switch ───────────────────────────────────────────────────
        {
            "id": "core-sw",
            "type": "infra",
            "position": {"x": 310, "y": 340},
            "data": {
                "label": "Core Switch",
                "ip": "VLAN Trunk",
                "ntype": "switch",
                "icon": "fa-sitemap",
                "color": "#68d391",
            },
        },
        # ── VLAN labels ───────────────────────────────────────────────────
        {
            "id": "vlan-1",
            "type": "infra",
            "position": {"x": -100, "y": 460},
            "data": {
                "label": "VLAN 1 · LAB",
                "ip": "192.168.1.x · Gestión",
                "ntype": "generic",
                "icon": "fa-tag",
                "color": "#63b3ed",
            },
        },
        {
            "id": "vlan-20",
            "type": "infra",
            "position": {"x": 80, "y": 460},
            "data": {
                "label": "VLAN 20 · WAN",
                "ip": "Digi 10G",
                "ntype": "generic",
                "icon": "fa-tag",
                "color": "#68d391",
            },
        },
        {
            "id": "vlan-30",
            "type": "infra",
            "position": {"x": 215, "y": 460},
            "data": {
                "label": "VLAN 30 · WAN-B",
                "ip": "KEIO 600M",
                "ntype": "generic",
                "icon": "fa-tag",
                "color": "#68d391",
            },
        },
        {
            "id": "vlan-25",
            "type": "infra",
            "position": {"x": 360, "y": 460},
            "data": {
                "label": "VLAN 25 · WiFi1",
                "ip": "192.168.2.x",
                "ntype": "generic",
                "icon": "fa-tag",
                "color": "#63b3ed",
            },
        },
        {
            "id": "vlan-50",
            "type": "infra",
            "position": {"x": 500, "y": 460},
            "data": {
                "label": "VLAN 50 · HomeLab",
                "ip": "192.168.2.x",
                "ntype": "generic",
                "icon": "fa-tag",
                "color": "#b794f4",
            },
        },
        {
            "id": "vlan-60",
            "type": "infra",
            "position": {"x": 640, "y": 460},
            "data": {
                "label": "VLAN 60 · MAAS",
                "ip": "10.10.9.x",
                "ntype": "generic",
                "icon": "fa-tag",
                "color": "#fbd38d",
            },
        },
        # ── VLAN 1 devices ────────────────────────────────────────────────
        {
            "id": "pve-m90g1",
            "type": "infra",
            "position": {"x": -140, "y": 580},
            "data": {
                "label": "pve-m90G1",
                "ip": "192.168.1.7",
                "ntype": "server",
                "icon": "fa-cubes",
                "color": "#63b3ed",
                "status": "ok",
            },
        },
        {
            "id": "pve-m90q",
            "type": "infra",
            "position": {"x": -140, "y": 700},
            "data": {
                "label": "pve-M90Q",
                "ip": "192.168.1.x",
                "ntype": "server",
                "icon": "fa-cubes",
                "color": "#63b3ed",
                "status": "ok",
            },
        },
        {
            "id": "pve-jonesbo",
            "type": "infra",
            "position": {"x": -140, "y": 820},
            "data": {
                "label": "pve-Jonesbo",
                "ip": "192.168.1.9",
                "ntype": "server",
                "icon": "fa-cubes",
                "color": "#63b3ed",
                "status": "ok",
            },
        },
        {
            "id": "dsm-nas",
            "type": "infra",
            "position": {"x": -140, "y": 940},
            "data": {
                "label": "DSM NAS",
                "ip": "192.168.1.80",
                "ntype": "nas",
                "icon": "fa-database",
                "color": "#b794f4",
            },
        },
        # ── VLAN 20 / WAN-A ───────────────────────────────────────────────
        {
            "id": "wan-a",
            "type": "infra",
            "position": {"x": 70, "y": 580},
            "data": {
                "label": "WAN-A",
                "ip": "uplink",
                "ntype": "wan",
                "icon": "fa-tower-broadcast",
                "color": "#68d391",
            },
        },
        # ── VLAN 30 / WAN-B ───────────────────────────────────────────────
        {
            "id": "wan-b",
            "type": "infra",
            "position": {"x": 210, "y": 580},
            "data": {
                "label": "WAN-B",
                "ip": "failover",
                "ntype": "wan",
                "icon": "fa-tower-broadcast",
                "color": "#fc8181",
            },
        },
        # ── VLAN 25 / WiFi ────────────────────────────────────────────────
        {
            "id": "wifi-ap",
            "type": "infra",
            "position": {"x": 355, "y": 580},
            "data": {
                "label": "WiFi AP",
                "ip": "192.168.2.x",
                "ntype": "wifi",
                "icon": "fa-wifi",
                "color": "#63b3ed",
            },
        },
        # ── VLAN 50 / HomeLab ─────────────────────────────────────────────
        {
            "id": "k3s-single",
            "type": "infra",
            "position": {"x": 490, "y": 580},
            "data": {
                "label": "k3s-single",
                "ip": "192.168.3.202",
                "ntype": "k8s",
                "icon": "fa-dharmachakra",
                "color": "#68d391",
                "status": "ok",
            },
        },
        {
            "id": "ingress-lb",
            "type": "infra",
            "position": {"x": 490, "y": 700},
            "data": {
                "label": "Ingress LB",
                "ip": "192.168.3.220",
                "ntype": "generic",
                "icon": "fa-shield-halved",
                "color": "#fc8181",
            },
        },
        # ── VLAN 60 / MAAS ────────────────────────────────────────────────
        {
            "id": "maas-ctrl",
            "type": "infra",
            "position": {"x": 630, "y": 580},
            "data": {
                "label": "maas-ctrl",
                "ip": "10.10.9.x",
                "ntype": "server",
                "icon": "fa-server",
                "color": "#fbd38d",
            },
        },
        {
            "id": "juju-ctrl",
            "type": "infra",
            "position": {"x": 630, "y": 700},
            "data": {
                "label": "juju-ctrl",
                "ip": "10.10.9.x",
                "ntype": "server",
                "icon": "fa-server",
                "color": "#fbd38d",
            },
        },
    ],
    "edges": [
        # WANs → OPNsense
        {"id": "e-digi-opn",    "source": "wan-digi",    "target": "opnsense",   "animated": True, "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e-keio-opn",    "source": "wan-keio",    "target": "opnsense",   "animated": True, "style": {"stroke": "#68d391", "strokeWidth": 2}},
        # OPNsense → Core Switch
        {"id": "e-opn-sw",      "source": "opnsense",    "target": "core-sw",    "animated": True, "style": {"stroke": "#fc8181", "strokeWidth": 3}},
        # Core Switch → VLAN labels
        {"id": "e-sw-v1",       "source": "core-sw",     "target": "vlan-1",     "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e-sw-v20",      "source": "core-sw",     "target": "vlan-20",    "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e-sw-v30",      "source": "core-sw",     "target": "vlan-30",    "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e-sw-v25",      "source": "core-sw",     "target": "vlan-25",    "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e-sw-v50",      "source": "core-sw",     "target": "vlan-50",    "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        {"id": "e-sw-v60",      "source": "core-sw",     "target": "vlan-60",    "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1, "strokeDasharray": "4 3"}},
        # VLAN 1 chain
        {"id": "e-v1-pve1",     "source": "vlan-1",      "target": "pve-m90g1",  "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e-pve1-pve2",   "source": "pve-m90g1",   "target": "pve-m90q",   "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e-pve2-pve3",   "source": "pve-m90q",    "target": "pve-jonesbo","animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e-pve3-nas",    "source": "pve-jonesbo", "target": "dsm-nas",    "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
        # VLAN 20 → WAN-A
        {"id": "e-v20-wana",    "source": "vlan-20",     "target": "wan-a",      "animated": False, "style": {"stroke": "#68d391", "strokeWidth": 1}},
        # VLAN 30 → WAN-B
        {"id": "e-v30-wanb",    "source": "vlan-30",     "target": "wan-b",      "animated": False, "style": {"stroke": "#fc8181", "strokeWidth": 1}},
        # VLAN 25 → WiFi
        {"id": "e-v25-wifi",    "source": "vlan-25",     "target": "wifi-ap",    "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        # VLAN 50 → k8s
        {"id": "e-v50-k3s",     "source": "vlan-50",     "target": "k3s-single", "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 1}},
        {"id": "e-k3s-lb",      "source": "k3s-single",  "target": "ingress-lb", "animated": False, "style": {"stroke": "#fc8181", "strokeWidth": 1}},
        # VLAN 60 → MAAS
        {"id": "e-v60-maas",    "source": "vlan-60",     "target": "maas-ctrl",  "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
        {"id": "e-v60-juju",    "source": "vlan-60",     "target": "juju-ctrl",  "animated": False, "style": {"stroke": "#fbd38d", "strokeWidth": 1}},
    ],
}

SMALL_OFFICE_TOPOLOGY: dict = {
    "nodes": [
        {"id": "so-isp",   "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "ISP",          "ip": "WAN",          "ntype": "wan",     "icon": "fa-tower-broadcast", "color": "#68d391"}},
        {"id": "so-fw",    "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Firewall",     "ip": "192.168.0.1",  "ntype": "router",  "icon": "fa-shield-halved",   "color": "#fc8181"}},
        {"id": "so-sw",    "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "Core Switch",  "ip": "L2",           "ntype": "switch",  "icon": "fa-sitemap",         "color": "#68d391"}},
        {"id": "so-wifi",  "type": "infra", "position": {"x": 80,  "y": 460},
         "data": {"label": "WiFi AP",      "ip": "192.168.0.50", "ntype": "wifi",    "icon": "fa-wifi",            "color": "#63b3ed"}},
        {"id": "so-srv1",  "type": "infra", "position": {"x": 240, "y": 460},
         "data": {"label": "Server 01",    "ip": "192.168.0.10", "ntype": "server",  "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "so-srv2",  "type": "infra", "position": {"x": 380, "y": 460},
         "data": {"label": "Server 02",    "ip": "192.168.0.11", "ntype": "server",  "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "so-srv3",  "type": "infra", "position": {"x": 520, "y": 460},
         "data": {"label": "Server 03",    "ip": "192.168.0.12", "ntype": "server",  "icon": "fa-server",          "color": "#63b3ed"}},
        {"id": "so-nas",   "type": "infra", "position": {"x": 300, "y": 600},
         "data": {"label": "NAS",          "ip": "192.168.0.20", "ntype": "nas",     "icon": "fa-database",        "color": "#b794f4"}},
    ],
    "edges": [
        {"id": "e1", "source": "so-isp",  "target": "so-fw",   "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e2", "source": "so-fw",   "target": "so-sw",   "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e3", "source": "so-sw",   "target": "so-wifi", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "so-sw",   "target": "so-srv1", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "so-sw",   "target": "so-srv2", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e6", "source": "so-sw",   "target": "so-srv3", "animated": False, "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e7", "source": "so-sw",   "target": "so-nas",  "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

K8S_CLUSTER_TOPOLOGY: dict = {
    "nodes": [
        {"id": "k-gw",     "type": "infra", "position": {"x": 300, "y": 40},
         "data": {"label": "Gateway",       "ip": "192.168.100.1",  "ntype": "router", "icon": "fa-shield-halved", "color": "#fc8181"}},
        {"id": "k-sw",     "type": "infra", "position": {"x": 300, "y": 180},
         "data": {"label": "Switch",        "ip": "L2",              "ntype": "switch", "icon": "fa-sitemap",      "color": "#68d391"}},
        {"id": "k-cp",     "type": "infra", "position": {"x": 300, "y": 320},
         "data": {"label": "control-plane", "ip": "192.168.100.10",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#68d391"}},
        {"id": "k-w1",     "type": "infra", "position": {"x": 80,  "y": 460},
         "data": {"label": "worker-01",     "ip": "192.168.100.11",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#63b3ed"}},
        {"id": "k-w2",     "type": "infra", "position": {"x": 300, "y": 460},
         "data": {"label": "worker-02",     "ip": "192.168.100.12",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#63b3ed"}},
        {"id": "k-w3",     "type": "infra", "position": {"x": 520, "y": 460},
         "data": {"label": "worker-03",     "ip": "192.168.100.13",  "ntype": "k8s",    "icon": "fa-dharmachakra", "color": "#63b3ed"}},
        {"id": "k-lb",     "type": "infra", "position": {"x": 80,  "y": 600},
         "data": {"label": "Ingress / LB",  "ip": "192.168.100.200", "ntype": "generic","icon": "fa-shield-halved","color": "#fc8181"}},
        {"id": "k-nfs",    "type": "infra", "position": {"x": 520, "y": 600},
         "data": {"label": "NFS Storage",   "ip": "192.168.100.80",  "ntype": "nas",    "icon": "fa-database",    "color": "#b794f4"}},
    ],
    "edges": [
        {"id": "e1", "source": "k-gw",  "target": "k-sw",  "animated": True,  "style": {"stroke": "#fc8181", "strokeWidth": 2}},
        {"id": "e2", "source": "k-sw",  "target": "k-cp",  "animated": True,  "style": {"stroke": "#68d391", "strokeWidth": 2}},
        {"id": "e3", "source": "k-cp",  "target": "k-w1",  "animated": True,  "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e4", "source": "k-cp",  "target": "k-w2",  "animated": True,  "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e5", "source": "k-cp",  "target": "k-w3",  "animated": True,  "style": {"stroke": "#63b3ed", "strokeWidth": 1}},
        {"id": "e6", "source": "k-w1",  "target": "k-lb",  "animated": False, "style": {"stroke": "#fc8181", "strokeWidth": 1}},
        {"id": "e7", "source": "k-w3",  "target": "k-nfs", "animated": False, "style": {"stroke": "#b794f4", "strokeWidth": 1}},
    ],
}

TEMPLATES = {
    "mxhome": {
        "name": "MXHOME — Topología completa",
        "description": "WANs (Digi + KEIO) → OPNsense → Core Switch → VLANs (LAB, WiFi, HomeLab, MAAS) con todos los nodos",
        "diagram": MXHOME_TOPOLOGY,
    },
    "small-office": {
        "name": "Small Office / Branch",
        "description": "ISP → Firewall → Switch → WiFi AP + 3 servidores + NAS. Template genérico para oficinas pequeñas.",
        "diagram": SMALL_OFFICE_TOPOLOGY,
    },
    "k8s-cluster": {
        "name": "Kubernetes Cluster Multi-Node",
        "description": "Gateway → Switch → Control Plane → 3 Workers + Ingress LB + NFS Storage. Template para clústeres k8s/k3s.",
        "diagram": K8S_CLUSTER_TOPOLOGY,
    },
}
