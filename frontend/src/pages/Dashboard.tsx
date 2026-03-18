import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../api'
import { fmtBytes, fmtUptime, fmtKbps } from '../utils/fmt'
import { getNodeMeta } from '../constants/nodeTypes'
import { Sparkline } from '../components/Sparkline'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNodeStatus(node: any, statusData: any, ping: Record<string, boolean>): 'online' | 'offline' | 'unknown' {
    const ntype = node.data?.ntype
    const ip    = node.data?.ip ?? ''
    const pingResult = ip && ip in ping ? (ping[ip] ? 'online' : 'offline') : null

    if (ntype === 'wan' || ntype === 'router') {
        const gws: any[] = statusData.gateways?.data?.items ?? []
        if (ip) {
            const gw = gws.find((g: any) => g.gwaddr === ip || g.name?.toLowerCase().includes(ip.toLowerCase()))
            if (gw) return gw.status_translated === 'Online' ? 'online' : 'offline'
        }
        if (gws.some((g: any) => g.status_translated === 'Online')) return 'online'
        return pingResult ?? 'unknown'
    }
    if (ntype === 'server') {
        const pvNodes: any[] = statusData.proxmoxNodes?.nodes ?? []
        const match = pvNodes.find((n: any) =>
            n.name?.toLowerCase() === ip.toLowerCase() || ip.includes(n.name?.toLowerCase())
        )
        if (match) return match.status === 'online' ? 'online' : 'offline'
        if (pvNodes.some((n: any) => n.status === 'online')) return 'online'
        return pingResult ?? 'unknown'
    }
    if (ntype === 'k8s') {
        const k8sNodes: any[] = statusData.k8sNodes?.nodes ?? []
        if (k8sNodes.length > 0) return k8sNodes.some((n: any) => n.ready) ? 'online' : 'offline'
        return pingResult ?? 'unknown'
    }
    if (ntype === 'switch') {
        const ports: any[] = statusData.snmp?.ports ?? []
        if (ports.length > 0) return ports.some((p: any) => p.up) ? 'online' : 'offline'
        return pingResult ?? 'unknown'
    }
    return pingResult ?? 'unknown'
}

const LEVEL_COLOR: Record<string, string> = {
    info:  '#63b3ed',
    warn:  '#fbd38d',
    error: '#fc8181',
}
const LEVEL_ICON: Record<string, string> = {
    info:  'fa-circle-info',
    warn:  'fa-triangle-exclamation',
    error: 'fa-circle-exclamation',
}

function fmtTs(ts: number) {
    const d = new Date(ts * 1000)
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── VM sort helper ────────────────────────────────────────────────────────────
const OPN_HIDDEN_IFACES = new Set(['enc0', 'pflog0', 'pfsync0', 'lo0'])

function sortVms(vms: any[], col: string, dir: 'asc' | 'desc') {
    return [...vms].sort((a, b) => {
        let av: any, bv: any
        switch (col) {
            case 'vmid':   av = a.vmid ?? 0;                          bv = b.vmid ?? 0;                          break
            case 'type':   av = a.type ?? '';                          bv = b.type ?? '';                          break
            case 'name':   av = (a.name ?? '').toLowerCase();          bv = (b.name ?? '').toLowerCase();          break
            case 'mem':    av = a.maxmem ?? 0;                         bv = b.maxmem ?? 0;                         break
            case 'status': av = a.status === 'running' ? 1 : 0;        bv = b.status === 'running' ? 1 : 0;        break
            default: return 0
        }
        if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        return dir === 'asc' ? av - bv : bv - av
    })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard({ onToast }: Props) {
    const [status, setStatus]         = useState<any>(null)
    const [pvNodes, setPvNodes]       = useState<any>(null)
    const [pvVMs, setPvVMs]           = useState<any>(null)
    const [gways, setGways]           = useState<any>(null)
    const [k8sN, setK8sN]             = useState<any>(null)
    const [k8sW, setK8sW]             = useState<any>(null)
    const [unraid, setUnraid]         = useState<any>(null)
    const [unraidDisks, setUnraidDisks] = useState<any>(null)
    const [plex, setPlex]             = useState<any>(null)
    const [immich, setImmich]         = useState<any>(null)
    const [ha, setHa]                 = useState<any>(null)
    const [snmpData, setSnmpData]     = useState<any>(null)
    const [portainer, setPortainer]   = useState<any>(null)
    const [uptimeKuma, setUptimeKuma] = useState<any>(null)
    const [diagram, setDiagram]       = useState<{ nodes: any[] }>({ nodes: [] })
    const [pingResults, setPingResults] = useState<Record<string, boolean>>({})
    const [opnIfaces, setOpnIfaces]   = useState<any>(null)
    const [dhcpLeases, setDhcpLeases] = useState<any[]>([])
    const [fwLog, setFwLog]           = useState<any[]>([])
    const [events, setEvents]         = useState<any[]>([])
    const [metrics, setMetrics]       = useState<Record<string, number[]>>({})
    const [vmActions, setVmActions]   = useState<Record<number, boolean>>({}) // vmid -> loading

    const [showSnmpPorts,  setShowSnmpPorts]  = useState(false)
    const [showOpnIfaces,  setShowOpnIfaces]  = useState(false)
    const [showDhcp,       setShowDhcp]       = useState(false)
    const [showFwLog,      setShowFwLog]      = useState(false)
    const [showFwRules,    setShowFwRules]    = useState(false)
    const [showEvents,     setShowEvents]     = useState(true)
    const [showPv,         setShowPv]         = useState(() => localStorage.getItem('labdash_show_pv') !== 'false')
    const [loading, setLoading] = useState(true)

    // Feature state
    const [fwRules,        setFwRules]        = useState<any[]>([])
    const [pveUrl,         setPveUrl]         = useState<string>('')
    const [nodeDetails,    setNodeDetails]    = useState<Record<string, any>>({})
    const [tailscale,      setTailscale]      = useState<any>(null)
    const [wireguard,      setWireguard]      = useState<any>(null)
    const [snmpHistory,    setSnmpHistory]    = useState<{ in: number[]; out: number[] }>({ in: [], out: [] })
    const [vmSort, setVmSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'status', dir: 'desc' })
    const toggleVmSort = (col: string) => setVmSort((prev: { col: string; dir: 'asc' | 'desc' }) =>
        prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'status' ? 'desc' : 'asc' }
    )

    // Dashboard personalizable
    const DEFAULT_CARD_KEYS = ['plex', 'immich', 'unraid', 'ha', 'portainer', 'uptime_kuma', 'tailscale', 'wireguard']
    const [cardOrder, setCardOrder] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('labdash_card_order')
            if (saved) {
                const parsed = JSON.parse(saved) as string[]
                // Merge: keep saved order, append any new keys
                const ordered = parsed.filter((k: string) => DEFAULT_CARD_KEYS.includes(k))
                const missing = DEFAULT_CARD_KEYS.filter(k => !ordered.includes(k))
                return [...ordered, ...missing]
            }
        } catch { }
        return DEFAULT_CARD_KEYS
    })
    const CARD_KEYS = cardOrder
    const [visibleCards, setVisibleCards] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem('labdash_visible_cards')
            if (saved) return JSON.parse(saved)
        } catch { }
        return Object.fromEntries(DEFAULT_CARD_KEYS.map(k => [k, true]))
    })
    const [showCustomize, setShowCustomize] = useState(false)

    // Live network map node visibility
    const [hiddenNetNodes, setHiddenNetNodes] = useState<Set<string>>(() => {
        try {
            const saved = localStorage.getItem('labdash_hidden_net_nodes')
            if (saved) return new Set(JSON.parse(saved) as string[])
        } catch { }
        return new Set()
    })

    // Proxmox filters
    const [pvxNodeFilter,   setPvxNodeFilter]   = useState<string>('all')
    const [pvxStatusFilter, setPvxStatusFilter] = useState<'all' | 'running' | 'stopped'>('all')

    const toggleNetNode = (id: string) => {
        setHiddenNetNodes((prev: Set<string>) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            localStorage.setItem('labdash_hidden_net_nodes', JSON.stringify([...next]))
            return next
        })
    }

    // Compose viewer modal state
    const [composeModal, setComposeModal] = useState<{ stackId: number; name: string; content: string } | null>(null)
    const [composeLoading, setComposeLoading] = useState<number | null>(null)

    const toggleCard = (key: string) => {
        setVisibleCards(prev => {
            const next = { ...prev, [key]: !prev[key] }
            localStorage.setItem('labdash_visible_cards', JSON.stringify(next))
            return next
        })
    }

    const moveCard = (key: string, direction: 'up' | 'down') => {
        setCardOrder(prev => {
            const idx = prev.indexOf(key)
            if (idx < 0) return prev
            const next = [...prev]
            const target = direction === 'up' ? idx - 1 : idx + 1
            if (target < 0 || target >= next.length) return prev
            ;[next[idx], next[target]] = [next[target], next[idx]]
            localStorage.setItem('labdash_card_order', JSON.stringify(next))
            return next
        })
    }

    const handleViewCompose = async (stackId: number, stackName: string) => {
        setComposeLoading(stackId)
        try {
            const r = await api.portainerCompose(stackId)
            setComposeModal({ stackId, name: stackName, content: r.compose })
        } catch (err: any) {
            onToast('error', err.message || 'No se pudo cargar el compose')
        } finally { setComposeLoading(null) }
    }

    const diagramRef = useRef<{ nodes: any[] }>({ nodes: [] })

    // ── Data loaders ──────────────────────────────────────────
    const load = useCallback(async () => {
        try {
            const results = await Promise.allSettled([
                api.status(), api.proxmoxNodes(), api.proxmoxVMs(),
                api.opnsenseGateways(), api.k8sNodes(), api.k8sWorkloads(),
                api.unraidSystem(), api.plexInfo(), api.immichStats(), api.haStates(),
                api.getDiagram(), api.unraidDisks(),
            ])
            const [s, n, v, g, k, kw, ur, pl, im, haR, diag, ud] = results
            if (s.status    === 'fulfilled') setStatus(s.value)
            if (n.status    === 'fulfilled') setPvNodes(n.value as any)
            if (v.status    === 'fulfilled') setPvVMs(v.value as any)
            if (g.status    === 'fulfilled') setGways(g.value as any)
            if (k.status    === 'fulfilled') setK8sN(k.value as any)
            if (kw.status   === 'fulfilled') setK8sW(kw.value as any)
            if (ur.status   === 'fulfilled') setUnraid(ur.value as any)
            if (pl.status   === 'fulfilled') setPlex(pl.value as any)
            if (im.status   === 'fulfilled') setImmich(im.value as any)
            if (haR.status  === 'fulfilled') setHa(haR.value as any)
            if (ud.status   === 'fulfilled') setUnraidDisks(ud.value as any)
            if (diag.status === 'fulfilled') {
                const d = diag.value as any
                setDiagram(d)
                diagramRef.current = d
            }
        } finally { setLoading(false) }
    }, [])

    const loadSnmp = useCallback(async () => {
        try { setSnmpData(await api.snmpInterfaces()) } catch { }
    }, [])

    const loadPing = useCallback(async () => {
        const ips = (diagramRef.current?.nodes ?? [])
            .map((n: any) => n.data?.ip).filter(Boolean) as string[]
        if (!ips.length) return
        try { setPingResults((await api.pingIPs(ips)).results ?? {}) } catch { }
    }, [])

    const loadOpnIfaces = useCallback(async () => {
        try { setOpnIfaces(await api.opnsenseIfaces()) } catch { }
    }, [])

    const loadDhcp = useCallback(async () => {
        try { setDhcpLeases((await api.opnsenseDhcp()).leases ?? []) } catch { }
    }, [])

    const loadFwLog = useCallback(async () => {
        try { setFwLog((await api.opnsenseFwlog()).entries ?? []) } catch { }
    }, [])

    const loadEvents = useCallback(async () => {
        try { setEvents((await api.getEvents(30)).events ?? []) } catch { }
    }, [])

    const loadMetrics = useCallback(async () => {
        try {
            const keys = await api.metricsKeys()
            const results = await Promise.allSettled(
                keys.keys.slice(0, 20).map(k => api.getMetrics(k, 2))
            )
            const m: Record<string, number[]> = {}
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') {
                    m[keys.keys[i]] = r.value.points.map(p => p.value)
                }
            })
            setMetrics(m)
        } catch { }
    }, [])

    useEffect(() => {
        api.portainerData().then(r => setPortainer(r)).catch(() => {})
        api.uptimeKumaMonitors().then(r => setUptimeKuma(r)).catch(() => {})
        api.opnsenseFwRules().then(r => setFwRules(r.rules ?? [])).catch(() => {})
        api.proxmoxConfig().then(r => setPveUrl(r.pve_url ?? '')).catch(() => {})
        api.tailscaleDevices().then(r => setTailscale(r)).catch(() => {})
        api.opnsenseWireguard().then(r => setWireguard(r)).catch(() => {})
        load(); loadSnmp(); loadOpnIfaces(); loadDhcp(); loadFwLog(); loadEvents(); loadMetrics()
        const t1 = setInterval(load,       30000)
        const t2 = setInterval(loadSnmp,   10000)
        const t3 = setInterval(loadPing,   10000)
        const t4 = setInterval(loadOpnIfaces, 30000)
        const t5 = setInterval(loadDhcp,   60000)
        const t6 = setInterval(loadFwLog,  30000)
        const t7 = setInterval(loadEvents, 15000)
        const t8 = setInterval(loadMetrics, 60000)
        return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4); clearInterval(t5); clearInterval(t6); clearInterval(t7); clearInterval(t8) }
    }, [load, loadSnmp, loadPing, loadOpnIfaces, loadDhcp, loadFwLog, loadEvents, loadMetrics])

    // Load node detail for each Proxmox node
    useEffect(() => {
        const nodes = pvNodes?.nodes ?? []
        nodes.forEach((node: any) => {
            if (!nodeDetails[node.name]) {
                api.proxmoxNodeDetail(node.name).then(d => {
                    setNodeDetails(prev => ({ ...prev, [node.name]: d }))
                }).catch(() => {})
            }
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pvNodes])

    // Track SNMP history for sparkline chart
    useEffect(() => {
        if (!snmpData) return
        const totalIn  = (snmpData.ports ?? []).reduce((s: number, p: any) => s + (p.in_kbps  ?? 0), 0)
        const totalOut = (snmpData.ports ?? []).reduce((s: number, p: any) => s + (p.out_kbps ?? 0), 0)
        setSnmpHistory(prev => ({
            in:  [...prev.in.slice(-119),  totalIn],
            out: [...prev.out.slice(-119), totalOut],
        }))
    }, [snmpData])

    useEffect(() => {
        if (diagram.nodes.length > 0) loadPing()
    }, [diagram, loadPing])

    // ── VM action handler ─────────────────────────────────────
    const handleVmAction = async (vm: any, action: string) => {
        setVmActions(p => ({ ...p, [vm.vmid]: true }))
        try {
            await api.proxmoxVmAction(vm.node, vm.type, vm.vmid, action)
            onToast('success', `✓ ${action} enviado a ${vm.name}`)
            setTimeout(load, 3000)
        } catch (err: any) {
            onToast('error', err.message || `Error al ejecutar ${action}`)
        } finally {
            setVmActions(p => ({ ...p, [vm.vmid]: false }))
        }
    }

    // ── Derived values ────────────────────────────────────────
    const s         = status as any
    const nodes     = pvNodes?.nodes ?? []
    const byNode    = pvVMs?.by_node ?? {}
    const gateways  = gways?.data?.items ?? []
    const k8sNodes  = k8sN?.nodes ?? []
    const k8sNS     = k8sW?.namespaces ?? {}
    const haStates  = ha?.states ?? []
    const snmpPorts: any[] = snmpData?.ports ?? []
    const snmpUpPorts = snmpPorts.filter((p: any) => p.up)
    const totalInKbps  = snmpPorts.reduce((s: number, p: any) => s + (p.in_kbps  ?? 0), 0)
    const totalOutKbps = snmpPorts.reduce((s: number, p: any) => s + (p.out_kbps ?? 0), 0)
    const statusCtx = { gateways: gways, proxmoxNodes: pvNodes, k8sNodes: k8sN, snmp: snmpData }
    const diagramNodes = diagram.nodes ?? []

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24 }} />
            Cargando datos…
        </div>
    )

    return (
        <div>
            {/* ── Top toolbar ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 16, gap: 8 }}>
                <button
                    onClick={() => setShowCustomize((s: boolean) => !s)}
                    style={{
                        background: showCustomize ? 'rgba(99,179,237,.15)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${showCustomize ? 'rgba(99,179,237,.4)' : 'var(--border)'}`,
                        borderRadius: 8, color: showCustomize ? 'var(--accent)' : 'var(--muted)',
                        cursor: 'pointer', padding: '5px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                    }}
                    title="Personalizar dashboard"
                >
                    <i className="fa-solid fa-sliders" /> Personalizar
                    {(hiddenNetNodes.size > 0) && (
                        <span style={{ fontSize: 9, background: 'rgba(99,179,237,.2)', color: 'var(--accent)', borderRadius: 10, padding: '1px 6px' }}>
                            {hiddenNetNodes.size} oculto{hiddenNetNodes.size > 1 ? 's' : ''}
                        </span>
                    )}
                </button>
            </div>

            {/* ── Unified customize panel ── */}
            {showCustomize && (
                <div style={{
                    marginBottom: 20, padding: '14px 18px',
                    background: 'rgba(15,22,40,0.85)', border: '1px solid rgba(99,179,237,0.25)',
                    borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 16,
                }}>
                    {/* Network nodes sub-section */}
                    {diagramNodes.length > 0 && (
                        <div>
                            <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>
                                <i className="fa-solid fa-network-wired" style={{ marginRight: 6 }} />Red en vivo — nodos visibles
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {diagramNodes.map((node: any) => {
                                    const ntype = node.data?.ntype ?? 'generic'
                                    const meta = getNodeMeta(ntype)
                                    const hidden = hiddenNetNodes.has(node.id)
                                    return (
                                        <label key={node.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                            padding: '4px 10px', borderRadius: 8, fontSize: 12,
                                            background: hidden ? 'rgba(255,255,255,0.02)' : `${meta.color}10`,
                                            border: `1px solid ${hidden ? 'var(--border)' : `${meta.color}30`}`,
                                            color: hidden ? 'var(--muted)' : 'var(--text)',
                                            transition: 'all .15s',
                                        }}>
                                            <input type="checkbox" checked={!hidden} onChange={() => toggleNetNode(node.id)} style={{ cursor: 'pointer' }} />
                                            <i className={`fa-solid ${meta.icon}`} style={{ color: hidden ? 'var(--muted)' : meta.color, fontSize: 11 }} />
                                            {node.data?.label ?? node.id}
                                            {node.data?.ip && (
                                                <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                                                    {node.data.ip}
                                                </span>
                                            )}
                                        </label>
                                    )
                                })}
                                {hiddenNetNodes.size > 0 && (
                                    <button
                                        onClick={() => { setHiddenNetNodes(new Set()); localStorage.removeItem('labdash_hidden_net_nodes') }}
                                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)', cursor: 'pointer', padding: '4px 10px', fontSize: 11 }}
                                    >
                                        <i className="fa-solid fa-eye" /> Mostrar todos
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Services sub-section */}
                    <div>
                        <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: 8 }}>
                            <i className="fa-solid fa-server" style={{ marginRight: 6 }} />Servicios — orden y visibilidad
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {CARD_KEYS.map((k: string, idx: number) => (
                                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <button
                                            onClick={() => moveCard(k, 'up')} disabled={idx === 0}
                                            style={{ background: 'none', border: 'none', color: idx === 0 ? 'rgba(255,255,255,0.1)' : 'var(--muted)', cursor: idx === 0 ? 'default' : 'pointer', padding: '1px 4px', fontSize: 9, lineHeight: 1 }}
                                            title="Subir"
                                        >▲</button>
                                        <button
                                            onClick={() => moveCard(k, 'down')} disabled={idx === CARD_KEYS.length - 1}
                                            style={{ background: 'none', border: 'none', color: idx === CARD_KEYS.length - 1 ? 'rgba(255,255,255,0.1)' : 'var(--muted)', cursor: idx === CARD_KEYS.length - 1 ? 'default' : 'pointer', padding: '1px 4px', fontSize: 9, lineHeight: 1 }}
                                            title="Bajar"
                                        >▼</button>
                                    </div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: visibleCards[k] ? 'var(--text)' : 'var(--muted)', flex: 1 }}>
                                        <input type="checkbox" checked={visibleCards[k] ?? true} onChange={() => toggleCard(k)} style={{ cursor: 'pointer' }} />
                                        {k.charAt(0).toUpperCase() + k.slice(1).replace('_', ' ')}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Event feed ── */}
            {events.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                    <div className="sec-title" style={{ marginBottom: 10, cursor: 'pointer' }}
                        onClick={() => setShowEvents(s => !s)}>
                        <i className="fa-solid fa-bell" /> Eventos recientes
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {events.length} eventos · actualiza cada 15s
                        </span>
                        <i className={`fa-solid fa-chevron-${showEvents ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showEvents && (
                        <div style={{
                            background: 'rgba(10,14,26,0.7)', border: '1px solid var(--border)',
                            borderRadius: 12, overflow: 'hidden', maxHeight: 200, overflowY: 'auto',
                        }}>
                            {events.map(ev => (
                                <div key={ev.id} style={{
                                    display: 'flex', alignItems: 'baseline', gap: 10,
                                    padding: '7px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    fontSize: 12,
                                }}>
                                    <i className={`fa-solid ${LEVEL_ICON[ev.level] ?? 'fa-circle'}`}
                                        style={{ color: LEVEL_COLOR[ev.level] ?? 'var(--muted)', fontSize: 11, flexShrink: 0 }} />
                                    <span style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, flexShrink: 0 }}>
                                        {fmtTs(ev.ts)}
                                    </span>
                                    <span style={{ color: LEVEL_COLOR[ev.level] ?? 'var(--muted)', opacity: 0.7, flexShrink: 0, fontSize: 10 }}>
                                        [{ev.source}]
                                    </span>
                                    <span style={{ color: 'var(--text)' }}>{ev.message}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Live topology panel ── */}
            {diagramNodes.length > 0 && (
                <>
                    <div className="sec-title" style={{ marginBottom: 16 }}>
                        <i className="fa-solid fa-network-wired" /> Red en vivo
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>actualiza cada 10s</span>
                        {hiddenNetNodes.size > 0 && (
                            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
                                · {hiddenNetNodes.size} oculto{hiddenNetNodes.size > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>

                    <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 28,
                        padding: '16px', background: 'rgba(10,14,26,0.6)',
                        border: '1px solid var(--border)', borderRadius: 16,
                    }}>
                        {diagramNodes.filter((node: any) => !hiddenNetNodes.has(node.id)).map((node: any) => {
                            const st = getNodeStatus(node, statusCtx, pingResults)
                            const ntype = node.data?.ntype ?? 'generic'
                            const meta = getNodeMeta(ntype)
                            const statusColor = st === 'online' ? '#68d391' : st === 'offline' ? '#fc8181' : '#4a5568'
                            const isSwitch = ntype === 'switch'
                            return (
                                <div key={node.id} style={{
                                    background: 'rgba(15,22,40,0.9)', border: `1px solid ${statusColor}33`,
                                    borderRadius: 12, padding: '10px 14px', minWidth: 110,
                                    textAlign: 'center', position: 'relative',
                                }}>
                                    <span style={{
                                        position: 'absolute', top: 7, right: 8,
                                        width: 7, height: 7, borderRadius: '50%',
                                        background: statusColor, boxShadow: `0 0 6px ${statusColor}`,
                                        display: 'inline-block',
                                        animation: st === 'online' ? 'pulse 2s infinite' : 'none',
                                    }} />
                                    <i className={`fa-solid ${meta.icon}`} style={{
                                        fontSize: 20, color: meta.color, marginBottom: 5, display: 'block',
                                        filter: `drop-shadow(0 0 4px ${meta.color}55)`,
                                    }} />
                                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                                        {node.data?.label ?? 'Nodo'}
                                    </div>
                                    {node.data?.ip && (
                                        <div style={{ fontSize: 9.5, color: '#4a5568', fontFamily: 'JetBrains Mono, monospace' }}>
                                            {node.data.ip}
                                        </div>
                                    )}
                                    {isSwitch && snmpPorts.length > 0 && (
                                        <div style={{
                                            marginTop: 5, paddingTop: 5,
                                            borderTop: '1px solid rgba(255,255,255,0.06)',
                                            fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                                        }}>
                                            <div style={{ color: '#68d391' }}>↑ {fmtKbps(totalOutKbps)}</div>
                                            <div style={{ color: '#63b3ed' }}>↓ {fmtKbps(totalInKbps)}</div>
                                        </div>
                                    )}
                                    <div style={{ marginTop: 4 }}>
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
                                            background: `${statusColor}18`, color: statusColor,
                                        }}>
                                            {st === 'online' ? '● Online' : st === 'offline' ? '● Offline' : '○ —'}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                        {diagramNodes.every((n: any) => hiddenNetNodes.has(n.id)) && (
                            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>
                                Todos los nodos están ocultos. Usa <strong>Personalizar</strong> para mostrarlos.
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── Stats bar ── */}
            <div className="g5" style={{ marginBottom: 32 }}>
                {[
                    { label: 'Nodos Proxmox', val: s?.proxmox?.nodes ?? nodes.length, color: 'var(--accent)',  icon: 'fa-cubes',          metricKey: null },
                    { label: 'VMs Running',   val: s?.proxmox?.running ?? '—',         color: 'var(--accent2)', icon: 'fa-play',           metricKey: null },
                    { label: 'VMs Total',     val: s?.proxmox?.vms_total ?? '—',        color: 'var(--accent4)', icon: 'fa-layer-group',    metricKey: null },
                    { label: 'K8s Nodes',     val: k8sNodes.length || s?.k8s?.nodes || '—', color: 'var(--accent6)', icon: 'fa-dharmachakra', metricKey: null },
                    { label: 'Gateways Online', val: s?.opnsense?.wan_up ?? '—',        color: 'var(--accent3)', icon: 'fa-tower-broadcast', metricKey: null },
                ].map(c => (
                    <div key={c.label} className="stat-card" style={{ borderLeft: `3px solid ${c.color}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <i className={`fa-solid ${c.icon}`} style={{ fontSize: 14, color: c.color, opacity: 0.7 }} />
                        </div>
                        <div className="stat-value" style={{ color: c.color }}>{c.val}</div>
                        <div className="stat-label">{c.label}</div>
                    </div>
                ))}
            </div>

            {/* ── Metrics sparklines row ── */}
            {Object.keys(metrics).length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 12 }}>
                        <i className="fa-solid fa-chart-line" /> Métricas (2h)
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {Object.entries(metrics).map(([key, vals]) => {
                            if (!vals.length) return null
                            const last = vals[vals.length - 1]
                            const isPct = key.includes('cpu') || key.includes('mem')
                            const isKbps = key.includes('kbps')
                            const isRtt  = key.includes('rtt')
                            const label = key.split('.').slice(1).join(' › ')
                            const color = key.includes('cpu') ? '#fbd38d'
                                : key.includes('mem') ? '#63b3ed'
                                : key.includes('out') ? '#68d391'
                                : key.includes('in')  ? '#63b3ed'
                                : key.includes('rtt') ? '#b794f4'
                                : '#63b3ed'
                            const fmtVal = isPct ? `${last.toFixed(1)}%`
                                : isKbps ? fmtKbps(last)
                                : isRtt  ? `${last.toFixed(1)} ms`
                                : last.toFixed(1)
                            return (
                                <div key={key} style={{
                                    background: 'rgba(15,22,40,0.8)', border: '1px solid var(--border)',
                                    borderRadius: 12, padding: '10px 14px', minWidth: 130,
                                    display: 'flex', flexDirection: 'column', gap: 4,
                                }}>
                                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        {label}
                                    </div>
                                    <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>
                                        {fmtVal}
                                    </div>
                                    <Sparkline data={vals} color={color} width={110} height={28} />
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* ── OPNsense gateways ── */}
            {gateways.length > 0 && <>
                <div className="sec-title" style={{ marginBottom: 16 }}>
                    <i className="fa-solid fa-shield-halved" /> OPNsense — Gateways
                </div>
                <div className="g3" style={{ marginBottom: 32 }}>
                    {gateways.map((gw: any, i: number) => {
                        const up = gw.status_translated === 'Online' || gw.status === 'none'
                        const isDefault = gw.defaultgw === true
                        const rttKey = `gw.rtt.${gw.name?.replace(/ /g, '_')}`
                        const rttData = metrics[rttKey] ?? []
                        return (
                            <div key={i} className="card" style={isDefault ? { borderColor: 'rgba(99,179,237,0.4)' } : undefined}>
                                <div className="card-header">
                                    <div className={`card-icon ${up ? 'icon-green' : 'icon-red'}`}>
                                        <i className="fa-solid fa-tower-broadcast" />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            {gw.name}
                                            {isDefault && (
                                                <span style={{
                                                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
                                                    background: 'rgba(99,179,237,0.15)', color: '#63b3ed',
                                                    border: '1px solid rgba(99,179,237,0.35)',
                                                }}>WAN ACTIVO</span>
                                            )}
                                        </div>
                                        <div className="card-sub">{gw.gwaddr ?? ''}{gw.monitor ? ` · monitor: ${gw.monitor}` : ''}</div>
                                    </div>
                                    <span className={`pill ${up ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto', flexShrink: 0 }}>
                                        <span className={`dot ${up ? 'dot-green' : 'dot-red'}`} /> {up ? 'Online' : 'Offline'}
                                    </span>
                                </div>
                                <div className="kv-row"><span className="kv-key">RTT</span><span className="kv-val val-blue">{gw.delay ?? '—'}</span></div>
                                <div className="kv-row"><span className="kv-key">Packet loss</span><span className="kv-val val-yellow">{gw.loss ?? '—'}</span></div>
                                {gw.stddev && <div className="kv-row"><span className="kv-key">Jitter</span><span className="kv-val val-blue">{gw.stddev}</span></div>}
                                {rttData.length > 1 && (
                                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                        <Sparkline data={rttData} color="#b794f4" width={200} height={24} />
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </>}

            {/* ── OPNsense interfaces ── */}
            {(() => {
                const raw = opnIfaces?.data ?? {}
                const statsMap: Record<string, any> = raw?.statistics ?? (typeof raw === 'object' ? raw : {})
                const flagsUp = (flags: any): boolean => {
                    if (typeof flags === 'number') return (flags & 0x1) !== 0
                    if (typeof flags === 'string') {
                        if (/^0x/i.test(flags)) return (parseInt(flags, 16) & 0x1) !== 0
                        if (/^[0-9a-f]+$/i.test(flags) && flags.length >= 4) return (parseInt(flags, 16) & 0x1) !== 0
                        return flags.toLowerCase().includes('up')
                    }
                    return true
                }
                const byIface: Record<string, { label: string; ip: string; in_bytes: number; out_bytes: number; flags: any }> = {}
                for (const [key, f] of Object.entries(statsMap) as [string, any][]) {
                    if (typeof f !== 'object' || !f) continue
                    const ifname = f.name ?? key
                    const addrPart = key.split(' / ').pop() ?? ''
                    const isMAC = addrPart.includes(':') && addrPart.split(':').length === 6
                    const label = key.match(/^\[(.+?)\]/)?.[1] ?? ifname
                    if (!byIface[ifname]) byIface[ifname] = { label, ip: '', in_bytes: 0, out_bytes: 0, flags: f.flags }
                    if (isMAC) {
                        byIface[ifname].in_bytes  = parseInt(f['received-bytes'] ?? f.in_bytes ?? '0') || byIface[ifname].in_bytes
                        byIface[ifname].out_bytes = parseInt(f['sent-bytes']     ?? f.out_bytes ?? '0') || byIface[ifname].out_bytes
                        byIface[ifname].flags     = f.flags ?? byIface[ifname].flags
                        byIface[ifname].label     = label
                    } else {
                        if (!byIface[ifname].ip) byIface[ifname].ip = addrPart
                        if (!byIface[ifname].flags) byIface[ifname].flags = f.flags
                        if (!byIface[ifname].in_bytes)  byIface[ifname].in_bytes  = parseInt(f['received-bytes'] ?? '0') || 0
                        if (!byIface[ifname].out_bytes) byIface[ifname].out_bytes = parseInt(f['sent-bytes']     ?? '0') || 0
                    }
                }
                const ifaceList = Object.entries(byIface)
                    .filter(([ifname]) => !OPN_HIDDEN_IFACES.has(ifname))
                    .map(([, f]) => ({
                        name: f.label, ip: f.ip,
                        in_bytes: f.in_bytes, out_bytes: f.out_bytes,
                        up: flagsUp(f.flags),
                    }))
                if (!ifaceList.length) return null
                return (
                    <div style={{ marginBottom: 28 }}>
                        <div className="sec-title" style={{ marginBottom: 12, cursor: 'pointer' }}
                            onClick={() => setShowOpnIfaces(s => !s)}>
                            <i className="fa-solid fa-ethernet" /> OPNsense — Interfaces
                            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                                {ifaceList.filter(f => f.up !== false).length}/{ifaceList.length} up
                            </span>
                            <i className={`fa-solid fa-chevron-${showOpnIfaces ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                        </div>
                        {showOpnIfaces && (
                            <div className="card" style={{ padding: 0 }}>
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Interfaz</th><th>IP</th><th>Estado</th><th>↓ RX total</th><th>↑ TX total</th></tr>
                                    </thead>
                                    <tbody>
                                        {ifaceList.map((f, i) => (
                                            <tr key={i}>
                                                <td style={{ color: 'var(--accent4)', fontFamily: 'JetBrains Mono, monospace' }}>{f.name}</td>
                                                <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{f.ip || '—'}</td>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                                                        background: f.up !== false ? 'rgba(104,211,145,.15)' : 'rgba(252,129,129,.1)',
                                                        color: f.up !== false ? '#68d391' : '#fc8181',
                                                    }}>{f.up !== false ? 'Up' : 'Down'}</span>
                                                </td>
                                                <td style={{ color: '#63b3ed' }}>{fmtBytes(f.in_bytes ?? 0)}</td>
                                                <td style={{ color: '#68d391' }}>{fmtBytes(f.out_bytes ?? 0)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )
            })()}

            {/* ── DHCP leases ── */}
            {dhcpLeases.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowDhcp(s => !s)}>
                        <i className="fa-solid fa-list-ul" /> DHCP Leases
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {dhcpLeases.length} activos
                        </span>
                        <i className={`fa-solid fa-chevron-${showDhcp ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showDhcp && (
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr><th>IP</th><th>MAC</th><th>Hostname</th><th>Estado</th></tr>
                                </thead>
                                <tbody>
                                    {dhcpLeases.map((l: any, i: number) => (
                                        <tr key={i}>
                                            <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{l.ip || '—'}</td>
                                            <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>{l.mac || '—'}</td>
                                            <td style={{ color: 'var(--text)' }}>{l.hostname || '—'}</td>
                                            <td>
                                                <span style={{
                                                    fontSize: 9, padding: '2px 7px', borderRadius: 8, fontWeight: 700,
                                                    background: l.state === 0 || l.state === 'active' ? 'rgba(104,211,145,.15)' : 'rgba(150,150,150,.1)',
                                                    color: l.state === 0 || l.state === 'active' ? '#68d391' : 'var(--muted)',
                                                }}>
                                                    {l.state === 0 || l.state === 'active' ? 'Activo' : String(l.state)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Firewall log ── */}
            {fwLog.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowFwLog(s => !s)}>
                        <i className="fa-solid fa-fire-flame-curved" /> Firewall Log
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            últimas {fwLog.length} entradas
                        </span>
                        <i className={`fa-solid fa-chevron-${showFwLog ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showFwLog && (
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr><th>Acción</th><th>Orig</th><th>Dest</th><th>Proto</th><th>Iface</th></tr>
                                </thead>
                                <tbody>
                                    {fwLog.slice(0, 50).map((e: any, i: number) => {
                                        const isBlock = e.action?.toLowerCase().includes('block') || e.action?.toLowerCase() === 'b'
                                        return (
                                            <tr key={i}>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                                                        background: isBlock ? 'rgba(252,129,129,.15)' : 'rgba(104,211,145,.12)',
                                                        color: isBlock ? '#fc8181' : '#68d391',
                                                    }}>
                                                        {isBlock ? '✗ Block' : '✓ Pass'}
                                                    </span>
                                                </td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                    {e.src}{e.srcport ? `:${e.srcport}` : ''}
                                                </td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                    {e.dst}{e.dstport ? `:${e.dstport}` : ''}
                                                </td>
                                                <td style={{ color: 'var(--muted)', fontSize: 11 }}>{e.proto || '—'}</td>
                                                <td style={{ color: 'var(--muted)', fontSize: 11 }}>{e.iface || '—'}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── Firewall Rules ── */}
            {fwRules.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowFwRules(s => !s)}>
                        <i className="fa-solid fa-shield-halved" /> Firewall Rules
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {fwRules.length} reglas
                        </span>
                        <i className={`fa-solid fa-chevron-${showFwRules ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showFwRules && (
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr><th>Acción</th><th>Descripción</th><th>Interfaz</th><th>Proto</th><th>Origen</th><th>Destino</th></tr>
                                </thead>
                                <tbody>
                                    {fwRules.slice(0, 100).map((r: any, i: number) => {
                                        const action = (r.action ?? r.type ?? '').toLowerCase()
                                        const isBlock = action.includes('block') || action === 'reject'
                                        const isPass  = action.includes('pass') || action.includes('allow')
                                        return (
                                            <tr key={i}>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                                                        background: isBlock ? 'rgba(252,129,129,.15)' : isPass ? 'rgba(104,211,145,.12)' : 'rgba(251,211,141,.1)',
                                                        color: isBlock ? '#fc8181' : isPass ? '#68d391' : '#fbd38d',
                                                    }}>
                                                        {isBlock ? '✗ Block' : isPass ? '✓ Pass' : action || '—'}
                                                    </span>
                                                </td>
                                                <td style={{ color: 'var(--text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {r.description || r.descr || r.label || '—'}
                                                </td>
                                                <td style={{ color: 'var(--accent4)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                    {r.interface || r.intf || '—'}
                                                </td>
                                                <td style={{ color: 'var(--muted)', fontSize: 11 }}>{r.protocol || r.proto || 'any'}</td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                    {r.source?.network || r.source?.address || (typeof r.source === 'string' ? r.source : 'any')}
                                                </td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                    {r.destination?.network || r.destination?.address || (typeof r.destination === 'string' ? r.destination : 'any')}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── SNMP ports ── */}
            {snmpPorts.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowSnmpPorts(s => !s)}>
                        <i className="fa-solid fa-sitemap" /> Switch SNMP
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {snmpUpPorts.length}/{snmpPorts.length} ports up · ↑{fmtKbps(totalOutKbps)} ↓{fmtKbps(totalInKbps)}
                        </span>
                        <i className={`fa-solid fa-chevron-${showSnmpPorts ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showSnmpPorts && (
                        <div className="card" style={{ padding: 0, marginBottom: 8 }}>
                            <table className="data-table">
                                <thead>
                                    <tr><th>#</th><th>Puerto</th><th>Alias</th><th>Estado</th><th>↑ TX</th><th>↓ RX</th><th>Tráfico</th></tr>
                                </thead>
                                <tbody>
                                    {snmpPorts.map((p: any) => {
                                        const maxKbps = Math.max(totalInKbps, totalOutKbps, 1)
                                        const barWidth = Math.min(((p.in_kbps + p.out_kbps) / maxKbps) * 100, 100)
                                        return (
                                            <tr key={p.idx}>
                                                <td style={{ color: 'var(--muted)' }}>{p.idx}</td>
                                                <td style={{ color: 'var(--text)' }}>{p.name}</td>
                                                <td style={{ color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.alias || '—'}</td>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                                                        background: p.up ? 'rgba(104,211,145,.15)' : 'rgba(252,129,129,.1)',
                                                        color: p.up ? '#68d391' : '#fc8181',
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    }}>
                                                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: p.up ? '#68d391' : '#fc8181', animation: p.up ? 'pulse 2s infinite' : 'none' }} />
                                                        {p.up ? 'Up' : 'Down'}
                                                    </span>
                                                </td>
                                                <td style={{ color: '#68d391' }}>{p.up ? fmtKbps(p.out_kbps) : '—'}</td>
                                                <td style={{ color: '#63b3ed' }}>{p.up ? fmtKbps(p.in_kbps) : '—'}</td>
                                                <td style={{ width: 80 }}>
                                                    {p.up && (p.in_kbps > 0 || p.out_kbps > 0) && (
                                                        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                                                            <div style={{ width: `${barWidth}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #2b6cb0, #68d391)', transition: 'width .3s' }} />
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {/* ── SNMP Bandwidth history sparkline (SVG) ── */}
                    {(snmpHistory.in.length > 1 || snmpHistory.out.length > 1) && (() => {
                        const W = 300, H = 60, pad = 4
                        const allVals = [...snmpHistory.in, ...snmpHistory.out]
                        const maxVal  = Math.max(...allVals, 1)
                        const pts = (arr: number[]) =>
                            arr.map((v, i) => {
                                const x = pad + (i / Math.max(arr.length - 1, 1)) * (W - pad * 2)
                                const y = H - pad - ((v / maxVal) * (H - pad * 2))
                                return `${x.toFixed(1)},${y.toFixed(1)}`
                            }).join(' ')
                        return (
                            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(15,22,40,0.7)', border: '1px solid var(--border)', borderRadius: 10 }}>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, display: 'flex', gap: 16 }}>
                                    <span><span style={{ color: '#63b3ed' }}>—</span> IN (2h)</span>
                                    <span><span style={{ color: '#68d391' }}>—</span> OUT (2h)</span>
                                    <span style={{ marginLeft: 'auto' }}>max {fmtKbps(maxVal)}</span>
                                </div>
                                <svg width={W} height={H} style={{ display: 'block' }}>
                                    {snmpHistory.in.length > 1 && (
                                        <polyline points={pts(snmpHistory.in)} fill="none" stroke="#63b3ed" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                                    )}
                                    {snmpHistory.out.length > 1 && (
                                        <polyline points={pts(snmpHistory.out)} fill="none" stroke="#68d391" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                                    )}
                                </svg>
                            </div>
                        )
                    })()}
                </div>
            )}

            {/* ── K8s ── */}
            {k8sNodes.length > 0 && <>
                <div className="sec-title"><i className="fa-solid fa-dharmachakra" /> Kubernetes — Nodos</div>
                <div className="g3" style={{ marginBottom: 16 }}>
                    {k8sNodes.map((n: any) => (
                        <div key={n.name} className="card">
                            <div className="card-header">
                                <div className="card-icon icon-green"><i className="fa-solid fa-dharmachakra" /></div>
                                <div>
                                    <div className="card-title">{n.name}</div>
                                    <div className="card-sub">{n.version} · {n.roles?.join(', ') || 'worker'}</div>
                                </div>
                                <span className={`pill ${n.ready ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                                    <span className={`dot ${n.ready ? 'dot-green' : 'dot-red'}`} /> {n.ready ? 'Ready' : 'NotReady'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                {Object.keys(k8sNS).length > 0 && (
                    <div className="card" style={{ marginBottom: 32, padding: '14px 0' }}>
                        <table className="data-table">
                            <thead><tr><th>Namespace</th><th>Deployments</th><th>Pods</th><th>Running</th></tr></thead>
                            <tbody>
                                {Object.entries(k8sNS).map(([ns, d]: [string, any]) => (
                                    <tr key={ns}>
                                        <td style={{ color: 'var(--accent6)' }}>{ns}</td>
                                        <td>{d.deployments?.length ?? 0}</td>
                                        <td>{d.pod_count ?? 0}</td>
                                        <td><span className="pill pill-green">{d.running_pods ?? 0}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </>}

            {/* ── Proxmox nodes + VMs ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <div className="sec-title" style={{ margin: 0 }}><i className="fa-solid fa-cubes" /> Proxmox — Inventario</div>
                <button
                    onClick={() => setShowPv((v: boolean) => {
                        const next = !v
                        localStorage.setItem('labdash_show_pv', String(next))
                        return next
                    })}
                    style={{
                        background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                        color: 'var(--muted)', cursor: 'pointer', padding: '2px 8px', fontSize: 11,
                        display: 'flex', alignItems: 'center', gap: 5,
                    }}
                    title={showPv ? 'Ocultar Proxmox' : 'Mostrar Proxmox'}
                >
                    <i className={`fa-solid ${showPv ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ fontSize: 9 }} />
                    {showPv ? 'Ocultar' : 'Mostrar'}
                </button>
                {showPv && nodes.length > 0 && (
                    <>
                        <select
                            value={pvxNodeFilter}
                            onChange={(e: { target: HTMLSelectElement }) => setPvxNodeFilter(e.target.value)}
                            style={{
                                background: 'rgba(15,22,40,0.9)', border: '1px solid var(--border)',
                                borderRadius: 6, color: 'var(--text)', fontSize: 11,
                                padding: '2px 8px', cursor: 'pointer',
                            }}
                        >
                            <option value="all">Todos los nodos</option>
                            {nodes.map((n: any) => (
                                <option key={n.name} value={n.name}>{n.name}</option>
                            ))}
                        </select>
                        {(['all', 'running', 'stopped'] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setPvxStatusFilter(s)}
                                style={{
                                    background: pvxStatusFilter === s
                                        ? s === 'running' ? 'rgba(104,211,145,.2)' : s === 'stopped' ? 'rgba(251,211,141,.15)' : 'rgba(99,179,237,.15)'
                                        : 'rgba(255,255,255,.04)',
                                    border: `1px solid ${pvxStatusFilter === s
                                        ? s === 'running' ? 'rgba(104,211,145,.5)' : s === 'stopped' ? 'rgba(251,211,141,.4)' : 'rgba(99,179,237,.4)'
                                        : 'var(--border)'}`,
                                    borderRadius: 6,
                                    color: pvxStatusFilter === s
                                        ? s === 'running' ? '#68d391' : s === 'stopped' ? '#fbd38d' : 'var(--accent)'
                                        : 'var(--muted)',
                                    cursor: 'pointer', padding: '2px 10px', fontSize: 11,
                                }}
                            >
                                {s === 'all' ? 'Todos' : s === 'running' ? 'Running' : 'Stopped'}
                            </button>
                        ))}
                    </>
                )}
            </div>
            {showPv && pvVMs?.error && (
                <div className="error-banner">
                    <i className="fa-solid fa-triangle-exclamation" /> Proxmox: {pvVMs.error}
                    {pvVMs.error.includes('401') && (
                        <div style={{ marginTop: 6, fontSize: 11 }}>
                            Tip: si tienes 2FA en Proxmox usa API Token — en Settings pon Usuario=<code>root@pam!tokenid</code> y Contraseña=el token value.
                        </div>
                    )}
                </div>
            )}
            {showPv && nodes
                .filter((node: any) => pvxNodeFilter === 'all' || node.name === pvxNodeFilter)
                .map((node: any) => {
                const allVms = (byNode[node.name] ?? []).filter((v: any) => !v.template)
                const vms = pvxStatusFilter === 'all' ? allVms
                    : allVms.filter((v: any) => pvxStatusFilter === 'running' ? v.status === 'running' : v.status !== 'running')
                const memPct = node.mem_max ? Math.round(node.mem_used / node.mem_max * 100) : 0
                const running = allVms.filter((v: any) => v.status === 'running').length
                const cpuKey = `pve.cpu.${node.name}`
                const memKey = `pve.mem.${node.name}`
                return (
                    <div key={node.name} style={{ marginBottom: 24 }}>
                        <div className="node-header">
                            <i className="fa-solid fa-cubes" />
                            <div>
                                <div className="node-title">{node.name}</div>
                                <div className="node-sub">{allVms.length} VMs/LXC · {running} running · uptime {fmtUptime(node.uptime)}</div>
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                                {metrics[cpuKey]?.length > 1 && <Sparkline data={metrics[cpuKey]} color="#fbd38d" width={60} height={20} />}
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>CPU <span style={{ color: 'var(--accent4)' }}>{node.cpu}%</span></span>
                                {metrics[memKey]?.length > 1 && <Sparkline data={metrics[memKey]} color="#63b3ed" width={60} height={20} />}
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>RAM <span style={{ color: 'var(--accent2)' }}>{memPct}%</span></span>
                                <span className={`pill ${node.status === 'online' ? 'pill-green' : 'pill-red'}`}>
                                    <span className={`dot ${node.status === 'online' ? 'dot-green' : 'dot-red'}`} /> {node.status}
                                </span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>CPU {node.cpu}%</div>
                                <div className="prog-bar"><div className="prog-fill prog-yellow" style={{ width: `${Math.min(node.cpu, 100)}%` }} /></div>
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>RAM {memPct}%</div>
                                <div className="prog-bar">
                                    <div className={`prog-fill ${memPct > 85 ? 'prog-red' : memPct > 65 ? 'prog-yellow' : 'prog-green'}`} style={{ width: `${memPct}%` }} />
                                </div>
                            </div>
                        </div>
                        {/* Node detail: CPU temp + disks */}
                        {nodeDetails[node.name] && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, padding: '8px 12px', background: 'rgba(15,22,40,0.6)', border: '1px solid var(--border)', borderRadius: 10 }}>
                                {nodeDetails[node.name].cpu_temp != null && (
                                    <div style={{ fontSize: 11 }}>
                                        <i className="fa-solid fa-temperature-half" style={{ color: '#fbd38d', marginRight: 5 }} />
                                        CPU Temp: <span style={{ color: '#fbd38d', fontFamily: 'JetBrains Mono, monospace' }}>{nodeDetails[node.name].cpu_temp}°C</span>
                                    </div>
                                )}
                                {(nodeDetails[node.name].disks ?? []).map((d: any, di: number) => (
                                    <div key={di} style={{ fontSize: 10.5, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <i className="fa-solid fa-hard-drive" style={{ color: '#63b3ed' }} />
                                        <span style={{ color: 'var(--text)' }}>{d.model || d.dev}</span>
                                        {d.size > 0 && <span>{fmtBytes(d.size)}</span>}
                                        {d.temp != null && <span style={{ color: '#fbd38d' }}>{d.temp}°C</span>}
                                        {d.health && (
                                            <span style={{ color: d.health === 'PASSED' || d.health === 'OK' ? '#68d391' : '#fc8181' }}>{d.health}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        {([['vmid','ID'],['type','Tipo'],['name','Nombre'],['mem','RAM'],['status','Estado']] as [string,string][]).map(([col, label]) => (
                                            <th key={col} onClick={() => toggleVmSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                                                {label}
                                                {vmSort.col === col && <i className={`fa-solid fa-sort-${vmSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 5, fontSize: 9, opacity: 0.6 }} />}
                                                {vmSort.col !== col && <i className="fa-solid fa-sort" style={{ marginLeft: 5, fontSize: 9, opacity: 0.2 }} />}
                                            </th>
                                        ))}
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortVms(vms, vmSort.col, vmSort.dir).map((v: any) => {
                                        const mem = v.maxmem / 1048576
                                        const run = v.status === 'running'
                                        const loading = vmActions[v.vmid]
                                        const consoleUrl = pveUrl ? `${pveUrl}/#v1:0:=${v.vmid}:4::::::` : ''
                                        return (
                                            <tr key={v.vmid}>
                                                <td style={{ color: 'var(--accent4)' }}>{v.vmid}</td>
                                                <td><span className={v.type === 'qemu' ? 'type-badge type-vm' : 'type-badge type-lxc'}>{v.type === 'qemu' ? 'VM' : 'LXC'}</span></td>
                                                <td style={{ color: 'var(--text)' }}>{v.name}</td>
                                                <td>{mem < 1024 ? `${mem.toFixed(0)} MB` : `${(mem / 1024).toFixed(1)} GB`}</td>
                                                <td>
                                                    <span className={`pill ${run ? 'pill-green' : 'pill-yellow'}`}>
                                                        {run && <span className="dot dot-green" style={{ width: 5, height: 5 }} />}
                                                        {run ? 'Running' : 'Stopped'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: 4 }}>
                                                        {consoleUrl && (
                                                            <a
                                                                href={consoleUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                title="Abrir consola en Proxmox"
                                                                style={{ background: 'rgba(99,179,237,.1)', border: '1px solid rgba(99,179,237,.3)', color: '#63b3ed', borderRadius: 6, padding: '3px 8px', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                                                            >
                                                                <i className="fa-solid fa-desktop" />
                                                            </a>
                                                        )}
                                                        {!run && (
                                                            <button
                                                                disabled={loading}
                                                                onClick={() => handleVmAction(v, 'start')}
                                                                title="Iniciar"
                                                                style={{ background: 'rgba(104,211,145,.12)', border: '1px solid rgba(104,211,145,.3)', color: '#68d391', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}
                                                            >
                                                                <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-play'}`} />
                                                            </button>
                                                        )}
                                                        {run && (
                                                            <>
                                                                <button
                                                                    disabled={loading}
                                                                    onClick={() => handleVmAction(v, 'shutdown')}
                                                                    title="Apagar"
                                                                    style={{ background: 'rgba(251,211,141,.1)', border: '1px solid rgba(251,211,141,.3)', color: '#fbd38d', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}
                                                                >
                                                                    <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-power-off'}`} />
                                                                </button>
                                                                <button
                                                                    disabled={loading}
                                                                    onClick={() => handleVmAction(v, 'stop')}
                                                                    title="Forzar parada"
                                                                    style={{ background: 'rgba(252,129,129,.1)', border: '1px solid rgba(252,129,129,.3)', color: '#fc8181', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11 }}
                                                                >
                                                                    <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-stop'}`} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {/* Templates colapsables */}
                        {(() => {
                            const tmpls = (byNode[node.name] ?? []).filter((v: any) => v.template)
                            if (!tmpls.length) return null
                            return (
                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', padding: '4px 8px', userSelect: 'none' }}>
                                        <i className="fa-solid fa-copy" style={{ marginRight: 6 }} />
                                        {tmpls.length} template{tmpls.length !== 1 ? 's' : ''}
                                    </summary>
                                    <div className="card" style={{ padding: 0, marginTop: 6 }}>
                                        <table className="data-table">
                                            <thead><tr><th>ID</th><th>Tipo</th><th>Nombre</th><th>RAM</th><th>Discos (nodo)</th></tr></thead>
                                            <tbody>
                                                {tmpls.map((v: any) => {
                                                    const mem = (v.maxmem ?? 0) / 1048576
                                                    const disk = v.maxdisk ? fmtBytes(v.maxdisk) : '—'
                                                    return (
                                                        <tr key={v.vmid} style={{ opacity: 0.75 }}>
                                                            <td style={{ color: 'var(--accent4)' }}>{v.vmid}</td>
                                                            <td><span className={v.type === 'qemu' ? 'type-badge type-vm' : 'type-badge type-lxc'}>{v.type === 'qemu' ? 'VM' : 'LXC'}</span></td>
                                                            <td style={{ color: 'var(--muted)' }}>{v.name}</td>
                                                            <td>{mem < 1024 ? `${mem.toFixed(0)} MB` : `${(mem / 1024).toFixed(1)} GB`}</td>
                                                            <td style={{ color: 'var(--muted)' }}>{disk}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            )
                        })()}
                    </div>
                )
            })}

            {showPv && nodes.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)', marginBottom: 32 }}>
                    <i className="fa-solid fa-plug-circle-xmark" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
                    Sin datos de Proxmox. Configura las credenciales en Settings.
                </div>
            )}

            {/* ── Services section ── */}
            <div className="sec-title" style={{ marginTop: 8, marginBottom: 16 }}>
                <i className="fa-solid fa-server" /> Servicios
            </div>
            <div className="g3" style={{ marginBottom: 32 }}>
                {/* Plex */}
                {(visibleCards['plex'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-yellow"><i className="fa-solid fa-film" /></div>
                        <div>
                            <div className="card-title">Plex Media Server</div>
                            <div className="card-sub">{plex?.data?.server_name ?? 'Plex'} · {plex?.data?.version ?? '—'}</div>
                        </div>
                        <span className={`pill ${plex?.data?.server_name ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${plex?.data?.server_name ? 'dot-green' : 'dot-red'}`} />
                            {plex?.data?.server_name ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {plex?.data?.sessions > 0 && (
                        <div className="kv-row">
                            <span className="kv-key"><i className="fa-solid fa-play" style={{ marginRight: 5 }} />Streams activos</span>
                            <span className="kv-val" style={{ color: '#68d391' }}>{plex.data.sessions}</span>
                        </div>
                    )}
                    {plex?.data?.libraries?.map((lib: any) => {
                        const icon = lib.type === 'movie' ? 'fa-film'
                            : lib.type === 'show'  ? 'fa-tv'
                            : lib.type === 'music' ? 'fa-music'
                            : lib.type === 'photo' ? 'fa-image'
                            : 'fa-folder'
                        return (
                            <div key={lib.key || lib.title} className="kv-row">
                                <span className="kv-key">
                                    <i className={`fa-solid ${icon}`} style={{ marginRight: 6, opacity: 0.6 }} />
                                    {lib.title}
                                </span>
                                <span className="kv-val val-yellow">{lib.count?.toLocaleString() ?? 0}</span>
                            </div>
                        )
                    })}
                    {!plex?.data?.server_name && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Plex en Settings</div>
                    )}
                </div>}
                {/* Immich */}
                {(visibleCards['immich'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-purple"><i className="fa-solid fa-images" /></div>
                        <div><div className="card-title">Immich</div><div className="card-sub">Galería fotográfica</div></div>
                        <span className={`pill ${immich?.data ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${immich?.data ? 'dot-green' : 'dot-red'}`} /> {immich?.data ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {immich?.data && <>
                        <div className="kv-row"><span className="kv-key">Fotos</span><span className="kv-val val-purple">{immich.data.photos?.toLocaleString() ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Vídeos</span><span className="kv-val val-purple">{immich.data.videos?.toLocaleString() ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Almacenamiento</span><span className="kv-val val-blue">{fmtBytes(immich.data.usageByUser?.reduce((a: number, u: any) => a + (u.diskUsageRaw ?? 0), 0) ?? 0)}</span></div>
                    </>}
                    {!immich?.data && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Immich en Settings</div>}
                </div>}
                {/* Unraid */}
                {(visibleCards['unraid'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-teal"><i className="fa-solid fa-database" /></div>
                        <div><div className="card-title">Unraid / NAS</div><div className="card-sub">{unraid?.data?.version ?? 'Sin datos'}</div></div>
                        <span className={`pill ${unraid?.data ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${unraid?.data ? 'dot-green' : 'dot-red'}`} /> {unraid?.data ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {unraid?.data && <>
                        <div className="kv-row"><span className="kv-key">Array</span><span className="kv-val val-green">{unraid.data.arrayStatus ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">CPU</span><span className="kv-val val-yellow">{unraid.data.cpu ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">RAM</span><span className="kv-val val-blue">{fmtBytes(unraid.data.memUsed ?? 0)} / {fmtBytes(unraid.data.memTotal ?? 0)}</span></div>
                    </>}
                    {/* Disk health */}
                    {unraidDisks && !unraidDisks.error && (() => {
                        const allDisks = [...(unraidDisks.parities ?? []), ...(unraidDisks.disks ?? [])]
                        if (!allDisks.length) return null
                        return <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Discos</div>
                            {allDisks.map((d: any) => {
                                const smart = (d.smart || '').toLowerCase()
                                const ok    = smart === 'passed' || smart === 'ok' || smart === ''
                                const temp  = d.temp != null ? `${d.temp}°C` : '—'
                                const errs  = d.errors > 0 ? ` · ${d.errors} err` : ''
                                const color = d.errors > 0 ? 'var(--red)' : ok ? 'var(--green)' : 'var(--yellow)'
                                return <div key={d.id} className="kv-row" style={{ fontSize: 12 }}>
                                    <span className="kv-key" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <i className={`fa-solid ${d.role === 'parity' ? 'fa-shield-halved' : 'fa-hard-drive'}`} style={{ fontSize: 10, color: 'var(--muted)' }} />
                                        {d.name || d.device}
                                    </span>
                                    <span style={{ color, fontSize: 11 }}>{temp}{errs} {d.smart ? `· ${d.smart}` : ''}</span>
                                </div>
                            })}
                        </div>
                    })()}
                    {!unraid?.data && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Unraid en Settings</div>}
                </div>}
                {/* Home Assistant */}
                {(visibleCards['ha'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-blue"><i className="fa-solid fa-house-signal" /></div>
                        <div><div className="card-title">Home Assistant</div><div className="card-sub">{haStates.length} entidades</div></div>
                        <span className={`pill ${haStates.length > 0 ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${haStates.length > 0 ? 'dot-green' : 'dot-red'}`} /> {haStates.length > 0 ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {haStates.slice(0, 6).map((e: any) => (
                        <div key={e.entity_id} className="kv-row">
                            <span className="kv-key" style={{ fontSize: 11 }}>{e.attributes?.friendly_name ?? e.entity_id.split('.')[1]}</span>
                            <span className="kv-val" style={{ color: e.state === 'on' ? 'var(--accent2)' : e.state === 'off' ? 'var(--muted)' : 'var(--accent4)' }}>
                                {e.state}{e.attributes?.unit_of_measurement ? ` ${e.attributes.unit_of_measurement}` : ''}
                            </span>
                        </div>
                    ))}
                    {haStates.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Home Assistant en Settings</div>}
                </div>}
                {/* Portainer */}
                {(visibleCards['portainer'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-blue"><i className="fa-solid fa-cube" /></div>
                        <div>
                            <div className="card-title">Portainer</div>
                            <div className="card-sub">
                                {portainer?.data?.endpoints?.length
                                    ? `${portainer.data.endpoints.length} endpoint${portainer.data.endpoints.length !== 1 ? 's' : ''}`
                                    : 'Container management'}
                            </div>
                        </div>
                        <span className={`pill ${portainer?.data?.endpoints?.length > 0 ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${portainer?.data?.endpoints?.length > 0 ? 'dot-green' : 'dot-red'}`} />
                            {portainer?.data?.endpoints?.length > 0 ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {portainer?.data?.stacks?.length > 0 && (
                        <>
                            <div className="kv-row">
                                <span className="kv-key"><i className="fa-solid fa-layer-group" style={{ marginRight: 5 }} />Stacks</span>
                                <span className="kv-val val-blue">{portainer.data.stacks.length}</span>
                            </div>
                            {portainer.data.stacks.slice(0, 6).map((st: any) => (
                                <div key={st.id} className="kv-row" style={{ alignItems: 'center' }}>
                                    <span className="kv-key" style={{ fontSize: 11 }}>
                                        <span style={{
                                            width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 5,
                                            background: st.status === 1 ? '#68d391' : '#fc8181',
                                        }} />
                                        {st.name}
                                    </span>
                                    <button
                                        onClick={() => handleViewCompose(st.id, st.name)}
                                        disabled={composeLoading === st.id}
                                        title="Ver docker-compose.yml"
                                        style={{
                                            background: 'none', border: '1px solid rgba(99,179,237,0.25)',
                                            borderRadius: 5, color: '#63b3ed', cursor: 'pointer',
                                            padding: '1px 7px', fontSize: 10,
                                        }}
                                    >
                                        <i className={`fa-solid ${composeLoading === st.id ? 'fa-spinner fa-spin' : 'fa-file-code'}`} />
                                    </button>
                                </div>
                            ))}
                        </>
                    )}
                    {portainer?.data?.containers !== undefined && (
                        <div className="kv-row">
                            <span className="kv-key"><i className="fa-solid fa-box" style={{ marginRight: 5 }} />Contenedores running</span>
                            <span className="kv-val val-green">
                                {portainer.data.containers.filter((c: any) => c.state === 'running').length}
                                <span style={{ color: 'var(--muted)', fontWeight: 400 }}>/{portainer.data.containers.length}</span>
                            </span>
                        </div>
                    )}
                    {portainer?.data?.endpoints?.map((ep: any) => (
                        <div key={ep.id} className="kv-row">
                            <span className="kv-key" style={{ fontSize: 11 }}>{ep.name}</span>
                            <span className="kv-val" style={{ color: ep.status === 1 ? 'var(--accent2)' : 'var(--muted)', fontSize: 11 }}>
                                {ep.status === 1 ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    ))}
                    {!portainer?.data?.endpoints && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Portainer en Settings</div>
                    )}
                </div>}
                {/* Uptime Kuma */}
                {(visibleCards['uptime_kuma'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-green"><i className="fa-solid fa-heart-pulse" /></div>
                        <div>
                            <div className="card-title">Uptime Kuma</div>
                            <div className="card-sub">
                                {uptimeKuma?.data?.total !== undefined
                                    ? `${uptimeKuma.data.up}/${uptimeKuma.data.total} monitores activos`
                                    : 'Monitor de servicios'}
                            </div>
                        </div>
                        <span
                            className={`pill ${uptimeKuma?.data?.total > 0 ? (uptimeKuma.data.up === uptimeKuma.data.total ? 'pill-green' : 'pill-yellow') : 'pill-red'}`}
                            style={{ marginLeft: 'auto' }}
                        >
                            <span className={`dot ${uptimeKuma?.data?.total > 0 ? (uptimeKuma.data.up === uptimeKuma.data.total ? 'dot-green' : 'dot-yellow') : 'dot-red'}`} />
                            {uptimeKuma?.data?.total > 0
                                ? (uptimeKuma.data.up === uptimeKuma.data.total ? 'All Up' : `${uptimeKuma.data.total - uptimeKuma.data.up} Down`)
                                : 'Offline'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {uptimeKuma?.data?.monitors?.slice(0, 12).map((m: any) => (
                            <span
                                key={m.id}
                                title={`${m.name}: ${m.status === 1 ? 'Up' : 'Down'} · ping: ${m.ping ?? '—'}ms · uptime 24h: ${m.uptime_24h}%`}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    padding: '2px 8px', borderRadius: 20, fontSize: 10.5,
                                    background: m.status === 1 ? 'rgba(104,211,145,0.12)' : 'rgba(252,129,129,0.12)',
                                    border: `1px solid ${m.status === 1 ? 'rgba(104,211,145,0.35)' : 'rgba(252,129,129,0.35)'}`,
                                    color: m.status === 1 ? '#68d391' : '#fc8181',
                                }}
                            >
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.status === 1 ? '#68d391' : '#fc8181', display: 'inline-block' }} />
                                {m.name}
                            </span>
                        ))}
                    </div>
                    {!uptimeKuma?.data?.monitors && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Uptime Kuma en Settings</div>
                    )}
                </div>}
                {/* Tailscale */}
                {(visibleCards['tailscale'] ?? true) && <div className="card">
                    <div className="card-header">
                        <div className="card-icon" style={{ background: 'rgba(99,179,237,.15)', color: '#63b3ed' }}><i className="fa-solid fa-shield-halved" /></div>
                        <div>
                            <div className="card-title">Tailscale</div>
                            <div className="card-sub">
                                {tailscale?.data?.devices?.length != null
                                    ? `${tailscale.data.devices.length} dispositivos · ${tailscale.data.tailnet}`
                                    : 'VPN mesh'}
                            </div>
                        </div>
                        <span className={`pill ${tailscale?.data?.devices?.length > 0 ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${tailscale?.data?.devices?.length > 0 ? 'dot-green' : 'dot-red'}`} />
                            {tailscale?.data?.devices?.length > 0 ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {tailscale?.data?.devices?.slice(0, 8).map((d: any) => (
                        <div key={d.id} className="kv-row">
                            <span className="kv-key" style={{ fontSize: 11 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.online ? '#68d391' : '#4a5568', display: 'inline-block', marginRight: 5 }} />
                                {d.name || d.display_name}
                            </span>
                            <span className="kv-val" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#63b3ed' }}>
                                {d.ip || '—'}
                                {d.os && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{d.os}</span>}
                            </span>
                        </div>
                    ))}
                    {!tailscale?.data?.devices && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Tailscale en Settings</div>
                    )}
                </div>}
                {/* WireGuard */}
                {(visibleCards['wireguard'] ?? true) && (() => {
                    const _wgC = wireguard?.data?.clients
                    const _wgS = wireguard?.data?.servers
                    const wgClients: any[] = Array.isArray(_wgC?.rows) ? _wgC.rows : Array.isArray(_wgC) ? _wgC : []
                    const wgServers: any[] = Array.isArray(_wgS?.rows) ? _wgS.rows : Array.isArray(_wgS) ? _wgS : []
                    const hasWg = wgClients.length > 0 || wgServers.length > 0
                    return (
                        <div className="card">
                            <div className="card-header">
                                <div className="card-icon" style={{ background: 'rgba(183,148,244,.15)', color: '#b794f4' }}><i className="fa-solid fa-lock" /></div>
                                <div>
                                    <div className="card-title">WireGuard</div>
                                    <div className="card-sub">
                                        {hasWg ? `${wgServers.length} servidores · ${wgClients.length} peers` : 'VPN tunnel'}
                                    </div>
                                </div>
                                <span className={`pill ${hasWg ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                                    <span className={`dot ${hasWg ? 'dot-green' : 'dot-red'}`} />
                                    {hasWg ? 'Activo' : 'Offline'}
                                </span>
                            </div>
                            {wgServers.slice(0, 3).map((s: any, i: number) => (
                                <div key={i} className="kv-row">
                                    <span className="kv-key" style={{ fontSize: 11 }}>
                                        <i className="fa-solid fa-server" style={{ marginRight: 5, opacity: 0.6 }} />
                                        {s.name || s.description || `Server ${i + 1}`}
                                    </span>
                                    <span className="kv-val" style={{ color: '#b794f4', fontSize: 10.5 }}>
                                        {s.enabled === '1' || s.enabled === true ? 'Activo' : 'Inactivo'}
                                    </span>
                                </div>
                            ))}
                            {wgClients.slice(0, 5).map((c: any, i: number) => (
                                <div key={i} className="kv-row">
                                    <span className="kv-key" style={{ fontSize: 11 }}>
                                        <i className="fa-solid fa-user" style={{ marginRight: 5, opacity: 0.6 }} />
                                        {c.name || c.description || `Peer ${i + 1}`}
                                    </span>
                                    <span className="kv-val" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--muted)' }}>
                                        {c.tunnel_address || c.allowed_ips || '—'}
                                    </span>
                                </div>
                            ))}
                            {!hasWg && (
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura OPNsense WireGuard en Settings</div>
                            )}
                        </div>
                    )
                })()}
            </div>

            {/* ── Compose viewer modal ── */}
            {composeModal && (
                <div
                    onClick={() => setComposeModal(null)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 2000,
                        background: 'rgba(5,8,18,0.82)', backdropFilter: 'blur(3px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: 'var(--bg2)', border: '1px solid var(--border)',
                            borderRadius: 16, padding: 24, maxWidth: 720, width: '100%',
                            maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 14,
                            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <i className="fa-solid fa-file-code" style={{ color: '#63b3ed', fontSize: 16 }} />
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{composeModal.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>docker-compose.yml</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    onClick={() => {
                                        const blob = new Blob([composeModal.content], { type: 'text/yaml' })
                                        const url = URL.createObjectURL(blob)
                                        const a = document.createElement('a')
                                        a.href = url; a.download = `${composeModal.name}-compose.yml`; a.click()
                                        URL.revokeObjectURL(url)
                                    }}
                                    style={{ background: 'rgba(99,179,237,.12)', border: '1px solid rgba(99,179,237,.3)', borderRadius: 7, color: '#63b3ed', cursor: 'pointer', padding: '5px 12px', fontSize: 12 }}
                                    title="Descargar"
                                >
                                    <i className="fa-solid fa-download" />
                                </button>
                                <button
                                    onClick={() => setComposeModal(null)}
                                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--muted)', cursor: 'pointer', padding: '5px 12px', fontSize: 12 }}
                                >
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        </div>
                        <pre style={{
                            flex: 1, overflowY: 'auto', overflowX: 'auto',
                            background: 'rgba(5,8,18,0.6)', border: '1px solid var(--border)',
                            borderRadius: 10, padding: '14px 16px', margin: 0,
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                            color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre',
                            maxHeight: '55vh',
                        }}>
                            {composeModal.content || '(vacío)'}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    )
}
