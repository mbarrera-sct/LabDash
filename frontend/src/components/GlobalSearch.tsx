import { useEffect, useRef, useState } from 'react'

interface SearchItem {
    id: string
    label: string
    sub?: string
    icon: string
    color: string
    tab: string
    badge?: string
}

interface Props {
    open: boolean
    onClose: () => void
    onNavigate: (tab: string) => void
    // Data sources
    pvNodes: any[]
    pvVMs: Record<string, any[]>
    opnGateways: any[]
    k8sNodes: any[]
    unraidDisks: any[]
    services: { label: string; ok: boolean }[]
}

export function GlobalSearch({ open, onClose, onNavigate, pvNodes, pvVMs, opnGateways, k8sNodes, unraidDisks, services }: Props) {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) {
            setQuery('')
            setSelected(0)
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [open])

    const allItems: SearchItem[] = [
        // Proxmox nodes
        ...pvNodes.map(n => ({
            id: `node-${n.name}`,
            label: n.name,
            sub: `Nodo Proxmox · ${n.status}`,
            icon: 'fa-cubes',
            color: '#63b3ed',
            tab: 'proxmox',
            badge: n.status === 'online' ? 'Online' : 'Offline',
        })),
        // VMs
        ...Object.entries(pvVMs).flatMap(([nodeName, vms]) =>
            (vms as any[]).filter(v => !v.template).map(v => ({
                id: `vm-${v.vmid}`,
                label: v.name ?? `VM ${v.vmid}`,
                sub: `${v.type === 'qemu' ? 'VM' : 'LXC'} · ${nodeName} · ID ${v.vmid}`,
                icon: v.type === 'qemu' ? 'fa-desktop' : 'fa-box',
                color: v.status === 'running' ? '#68d391' : '#fc8181',
                tab: 'proxmox',
                badge: v.status === 'running' ? 'Running' : 'Stopped',
            }))
        ),
        // OPNsense gateways
        ...opnGateways.map(g => ({
            id: `gw-${g.name}`,
            label: g.name,
            sub: `Gateway · ${g.gwaddr ?? ''}`,
            icon: 'fa-tower-broadcast',
            color: g.status_translated === 'Online' ? '#68d391' : '#fc8181',
            tab: 'opnsense',
            badge: g.status_translated ?? 'Unknown',
        })),
        // K8s nodes
        ...k8sNodes.map(n => ({
            id: `k8s-${n.name}`,
            label: n.name,
            sub: `Nodo Kubernetes · ${n.version ?? ''}`,
            icon: 'fa-dharmachakra',
            color: n.ready ? '#68d391' : '#fc8181',
            tab: 'dashboard',
            badge: n.ready ? 'Ready' : 'NotReady',
        })),
        // Unraid disks
        ...unraidDisks.map(d => ({
            id: `disk-${d.name}`,
            label: d.name ?? d.device,
            sub: `Disco Unraid · ${d.device ?? ''}`,
            icon: 'fa-hard-drive',
            color: d.status === 'DISK_OK' ? '#68d391' : '#fc8181',
            tab: 'unraid',
            badge: d.status,
        })),
        // Services (tabs)
        ...services.map(s => ({
            id: `svc-${s.label}`,
            label: s.label,
            sub: 'Servicio',
            icon: 'fa-server',
            color: s.ok ? '#68d391' : '#fc8181',
            tab: 'services',
            badge: s.ok ? 'Online' : 'Offline',
        })),
    ]

    const q = query.toLowerCase().trim()
    const filtered = q
        ? allItems.filter(item =>
            item.label.toLowerCase().includes(q) ||
            item.sub?.toLowerCase().includes(q) ||
            item.badge?.toLowerCase().includes(q)
        )
        : allItems.slice(0, 12)

    useEffect(() => setSelected(0), [query])

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { onClose(); return }
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
        if (e.key === 'Enter' && filtered[selected]) {
            onNavigate(filtered[selected].tab)
            onClose()
        }
    }

    if (!open) return null

    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose() }}
        >
            <div style={{ width: '100%', maxWidth: 560, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                {/* Search input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <i className="fa-solid fa-magnifying-glass" style={{ color: 'var(--muted)', fontSize: 14 }} />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Buscar VMs, nodos, gateways, discos…"
                        style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14 }}
                    />
                    <kbd style={{ fontSize: 10, color: 'var(--muted)', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>ESC</kbd>
                </div>

                {/* Results */}
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                            Sin resultados para "{query}"
                        </div>
                    ) : filtered.map((item, i) => (
                        <div
                            key={item.id}
                            onClick={() => { onNavigate(item.tab); onClose() }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 16px', cursor: 'pointer',
                                background: i === selected ? 'rgba(99,179,237,0.1)' : 'transparent',
                                borderLeft: i === selected ? '2px solid var(--accent)' : '2px solid transparent',
                                transition: 'background .1s',
                            }}
                            onMouseEnter={() => setSelected(i)}
                        >
                            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${item.color}18`, flexShrink: 0 }}>
                                <i className={`fa-solid ${item.icon}`} style={{ color: item.color, fontSize: 13 }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.sub}</div>
                            </div>
                            {item.badge && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0, background: `${item.color}18`, color: item.color, border: `1px solid ${item.color}33` }}>
                                    {item.badge}
                                </span>
                            )}
                            <i className="fa-solid fa-arrow-right" style={{ color: 'var(--muted)', fontSize: 11, opacity: i === selected ? 1 : 0, transition: 'opacity .1s' }} />
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 16, fontSize: 10, color: 'var(--muted)' }}>
                    <span><kbd style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>↑↓</kbd> navegar</span>
                    <span><kbd style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>Enter</kbd> abrir</span>
                    <span><kbd style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>Esc</kbd> cerrar</span>
                    <span style={{ marginLeft: 'auto' }}>{filtered.length} resultados</span>
                </div>
            </div>
        </div>
    )
}
