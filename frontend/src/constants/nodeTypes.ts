/** Shared node type definitions for network diagram nodes */

export interface NodeTemplate {
    type: string
    icon: string
    label: string
    color: string
    group: string
}

export const NODE_TEMPLATES: NodeTemplate[] = [
    // ── Red ──────────────────────────────────────────────────────────────────
    { type: 'router',  icon: 'fa-shield-halved',   label: 'Router/Firewall',  color: '#fc8181',  group: 'Red' },
    { type: 'switch',  icon: 'fa-sitemap',          label: 'Switch',           color: '#68d391',  group: 'Red' },
    { type: 'wifi',    icon: 'fa-wifi',             label: 'WiFi AP',          color: '#63b3ed',  group: 'Red' },
    { type: 'wan',     icon: 'fa-tower-broadcast',  label: 'WAN / ISP',        color: '#f6ad55',  group: 'Red' },
    { type: 'vpn',     icon: 'fa-lock',             label: 'VPN',              color: '#fc8181',  group: 'Red' },
    { type: 'vlan',    icon: 'fa-network-wired',    label: 'VLAN / Segmento',  color: '#b794f4',  group: 'Red' },
    // ── Compute ──────────────────────────────────────────────────────────────
    { type: 'server',  icon: 'fa-server',           label: 'Servidor / PVE',   color: '#63b3ed',  group: 'Compute' },
    { type: 'vm',      icon: 'fa-display',          label: 'VM / LXC',         color: '#81e6d9',  group: 'Compute' },
    { type: 'k8s',     icon: 'fa-dharmachakra',     label: 'Kubernetes',       color: '#81e6d9',  group: 'Compute' },
    { type: 'rpi',     icon: 'fa-microchip',        label: 'Raspberry Pi',     color: '#fc4444',  group: 'Compute' },
    { type: 'laptop',  icon: 'fa-laptop',           label: 'Laptop',           color: '#a0aec0',  group: 'Compute' },
    { type: 'desktop', icon: 'fa-desktop',          label: 'PC / Desktop',     color: '#a0aec0',  group: 'Compute' },
    // ── Storage ──────────────────────────────────────────────────────────────
    { type: 'nas',     icon: 'fa-hard-drive',       label: 'NAS / Storage',    color: '#b794f4',  group: 'Storage' },
    { type: 'tape',    icon: 'fa-tape',             label: 'Backup / Tape',    color: '#718096',  group: 'Storage' },
    // ── Servicios ────────────────────────────────────────────────────────────
    { type: 'plex',    icon: 'fa-film',             label: 'Plex / Media',     color: '#e2b96f',  group: 'Servicios' },
    { type: 'ha',      icon: 'fa-house-signal',     label: 'Home Assistant',   color: '#4299e1',  group: 'Servicios' },
    { type: 'cloud',   icon: 'fa-cloud',            label: 'Cloud / CDN',      color: '#81e6d9',  group: 'Servicios' },
    { type: 'dns',     icon: 'fa-globe',            label: 'DNS / Pi-hole',    color: '#68d391',  group: 'Servicios' },
    { type: 'ups',     icon: 'fa-battery-full',     label: 'UPS / SAI',        color: '#68d391',  group: 'Servicios' },
    // ── IoT ──────────────────────────────────────────────────────────────────
    { type: 'camera',  icon: 'fa-video',            label: 'Cámara IP',        color: '#f6ad55',  group: 'IoT' },
    { type: 'phone',   icon: 'fa-mobile-screen',    label: 'Teléfono / VoIP',  color: '#68d391',  group: 'IoT' },
    { type: 'printer', icon: 'fa-print',            label: 'Impresora',        color: '#a0aec0',  group: 'IoT' },
    { type: 'tv',      icon: 'fa-tv',               label: 'Smart TV',         color: '#b794f4',  group: 'IoT' },
    { type: 'iot',     icon: 'fa-bolt',             label: 'IoT / Sensor',     color: '#f6ad55',  group: 'IoT' },
    // ── Otros ────────────────────────────────────────────────────────────────
    { type: 'generic', icon: 'fa-circle-nodes',     label: 'Genérico',         color: '#718096',  group: 'Otros' },
]

export type NodeType = string

/** Lookup a node template by type, falling back to 'generic'. */
export function getNodeMeta(type: string): NodeTemplate {
    return NODE_TEMPLATES.find(t => t.type === type) ?? NODE_TEMPLATES[NODE_TEMPLATES.length - 1]
}

/** All groups in insertion order */
export const NODE_GROUPS = [...new Set(NODE_TEMPLATES.map(t => t.group))]
