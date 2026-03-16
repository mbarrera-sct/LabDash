/** Shared node type definitions for network diagram nodes */

export const NODE_TEMPLATES = [
    { type: 'router',  icon: 'fa-shield-halved',   label: 'Router/Firewall', color: '#fc8181' },
    { type: 'switch',  icon: 'fa-sitemap',         label: 'Switch',          color: '#68d391' },
    { type: 'server',  icon: 'fa-cubes',           label: 'Servidor/PVE',    color: '#63b3ed' },
    { type: 'vm',      icon: 'fa-display',         label: 'VM / LXC',        color: '#63b3ed' },
    { type: 'nas',     icon: 'fa-database',        label: 'NAS / Storage',   color: '#b794f4' },
    { type: 'wan',     icon: 'fa-tower-broadcast', label: 'WAN / ISP',       color: '#68d391' },
    { type: 'k8s',     icon: 'fa-dharmachakra',    label: 'Kubernetes',      color: '#81e6d9' },
    { type: 'wifi',    icon: 'fa-wifi',            label: 'WiFi AP',         color: '#63b3ed' },
    { type: 'generic', icon: 'fa-circle-nodes',    label: 'Genérico',        color: '#718096' },
] as const

export type NodeType = typeof NODE_TEMPLATES[number]['type']

/** Lookup a node template by type, falling back to 'generic'. */
export function getNodeMeta(type: string) {
    return NODE_TEMPLATES.find(t => t.type === type) ?? NODE_TEMPLATES[NODE_TEMPLATES.length - 1]
}
