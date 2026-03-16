import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../api'
import { fmtBytes, fmtUptime, fmtKbps } from '../utils/fmt'
import { getNodeMeta } from '../constants/nodeTypes'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

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
            n.name?.toLowerCase() === ip.toLowerCase() ||
            ip.includes(n.name?.toLowerCase())
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

    // All other types (wifi, nas, vm, generic): use ping if available
    return pingResult ?? 'unknown'
}

export default function Dashboard({ onToast }: Props) {
    const [status, setStatus]     = useState<any>(null)
    const [pvNodes, setPvNodes]   = useState<any>(null)
    const [pvVMs, setPvVMs]       = useState<any>(null)
    const [gways, setGways]       = useState<any>(null)
    const [k8sN, setK8sN]         = useState<any>(null)
    const [k8sW, setK8sW]         = useState<any>(null)
    const [unraid, setUnraid]     = useState<any>(null)
    const [plex, setPlex]         = useState<any>(null)
    const [immich, setImmich]     = useState<any>(null)
    const [ha, setHa]             = useState<any>(null)
    const [snmpData, setSnmpData] = useState<any>(null)
    const [diagram, setDiagram]   = useState<{ nodes: any[] }>({ nodes: [] })
    const [pingResults, setPingResults] = useState<Record<string, boolean>>({})
    const [opnIfaces, setOpnIfaces] = useState<any>(null)
    const [showSnmpPorts, setShowSnmpPorts] = useState(false)
    const [showOpnIfaces, setShowOpnIfaces] = useState(false)
    const [loading, setLoading]   = useState(true)
    const diagramRef = useRef<{ nodes: any[] }>({ nodes: [] })

    const load = useCallback(async () => {
        try {
            const results = await Promise.allSettled([
                api.status(), api.proxmoxNodes(), api.proxmoxVMs(),
                api.opnsenseGateways(), api.k8sNodes(), api.k8sWorkloads(),
                api.unraidSystem(), api.plexInfo(), api.immichStats(), api.haStates(),
                api.getDiagram(),
            ])
            const [s, n, v, g, k, kw, ur, pl, im, haR, diag] = results
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
            if (diag.status === 'fulfilled') {
                const d = diag.value as any
                setDiagram(d)
                diagramRef.current = d
            }
        } finally { setLoading(false) }
    }, [])

    const loadSnmp = useCallback(async () => {
        try {
            const d = await api.snmpInterfaces()
            setSnmpData(d)
        } catch { }
    }, [])

    const loadPing = useCallback(async () => {
        const ips = (diagramRef.current?.nodes ?? [])
            .map((n: any) => n.data?.ip)
            .filter(Boolean) as string[]
        if (!ips.length) return
        try {
            const d = await api.pingIPs(ips)
            setPingResults(d.results ?? {})
        } catch { }
    }, [])

    const loadOpnIfaces = useCallback(async () => {
        try {
            const d = await api.opnsenseIfaces()
            setOpnIfaces(d)
        } catch { }
    }, [])

    useEffect(() => {
        load()
        loadSnmp()
        loadOpnIfaces()
        const t1 = setInterval(load, 30000)
        const t2 = setInterval(loadSnmp, 10000)
        const t3 = setInterval(loadPing, 10000)
        const t4 = setInterval(loadOpnIfaces, 30000)
        return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4) }
    }, [load, loadSnmp, loadPing, loadOpnIfaces])

    // Trigger ping once diagram is loaded
    useEffect(() => {
        if (diagram.nodes.length > 0) loadPing()
    }, [diagram, loadPing])

    const s        = status as any
    const nodes    = pvNodes?.nodes ?? []
    const byNode   = pvVMs?.by_node ?? {}
    const gateways = gways?.data?.items ?? []
    const k8sNodes = k8sN?.nodes ?? []
    const k8sNS    = k8sW?.namespaces ?? {}
    const haStates = ha?.states ?? []
    const snmpPorts: any[] = snmpData?.ports ?? []
    const snmpUpPorts = snmpPorts.filter((p: any) => p.up)
    const totalInKbps  = snmpPorts.reduce((s: number, p: any) => s + (p.in_kbps  ?? 0), 0)
    const totalOutKbps = snmpPorts.reduce((s: number, p: any) => s + (p.out_kbps ?? 0), 0)

    // Build status context for diagram nodes
    const statusCtx = {
        gateways: gways,
        proxmoxNodes: pvNodes,
        k8sNodes: k8sN,
        snmp: snmpData,
    }

    const diagramNodes = diagram.nodes ?? []

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24 }} />
            Cargando datos…
        </div>
    )

    return (
        <div>
            {/* ── Live topology panel ── */}
            {diagramNodes.length > 0 && (
                <>
                    <div className="sec-title" style={{ marginBottom: 16 }}>
                        <i className="fa-solid fa-network-wired" /> Red en vivo
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            actualiza cada 10s
                        </span>
                    </div>
                    <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 28,
                        padding: '16px', background: 'rgba(10,14,26,0.6)',
                        border: '1px solid var(--border)', borderRadius: 16,
                    }}>
                        {diagramNodes.map((node: any) => {
                            const st = getNodeStatus(node, statusCtx, pingResults)
                            const ntype = node.data?.ntype ?? 'generic'
                            const meta = getNodeMeta(ntype)
                            const statusColor = st === 'online' ? '#68d391' : st === 'offline' ? '#fc8181' : '#4a5568'
                            const isSwitch = ntype === 'switch'
                            return (
                                <div key={node.id} style={{
                                    background: 'rgba(15,22,40,0.9)',
                                    border: `1px solid ${statusColor}33`,
                                    borderRadius: 12, padding: '10px 14px',
                                    minWidth: 110, textAlign: 'center',
                                    transition: 'all .2s',
                                    position: 'relative',
                                }}>
                                    {/* Status dot */}
                                    <span style={{
                                        position: 'absolute', top: 7, right: 8,
                                        width: 7, height: 7, borderRadius: '50%',
                                        background: statusColor,
                                        boxShadow: `0 0 6px ${statusColor}`,
                                        display: 'inline-block',
                                        animation: st === 'online' ? 'pulse 2s infinite' : 'none',
                                    }} />
                                    <i className={`fa-solid ${meta.icon}`} style={{
                                        fontSize: 20, color: meta.color,
                                        marginBottom: 5, display: 'block',
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
                                    {/* Switch: show total traffic */}
                                    {isSwitch && snmpData && snmpPorts.length > 0 && (
                                        <div style={{
                                            marginTop: 5, paddingTop: 5,
                                            borderTop: '1px solid rgba(255,255,255,0.06)',
                                            fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                                        }}>
                                            <div style={{ color: '#68d391' }}>↑ {fmtKbps(totalOutKbps)}</div>
                                            <div style={{ color: '#63b3ed' }}>↓ {fmtKbps(totalInKbps)}</div>
                                            <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                                                {snmpUpPorts.length}/{snmpPorts.length} ports up
                                            </div>
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
                    </div>
                </>
            )}

            {/* ── SNMP ports (collapsible) ── */}
            {snmpPorts.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowSnmpPorts(s => !s)}>
                        <i className="fa-solid fa-sitemap" /> Switch SNMP
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {snmpUpPorts.length}/{snmpPorts.length} ports up · ↑{fmtKbps(totalOutKbps)} ↓{fmtKbps(totalInKbps)}
                        </span>
                        <i className={`fa-solid fa-chevron-${showSnmpPorts ? 'up' : 'down'}`}
                            style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showSnmpPorts && (
                        <div className="card" style={{ padding: 0, marginBottom: 8 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Puerto</th>
                                        <th>Alias</th>
                                        <th>Estado</th>
                                        <th>↑ TX</th>
                                        <th>↓ RX</th>
                                        <th>Tráfico</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snmpPorts.map((p: any) => {
                                        const maxKbps = Math.max(totalInKbps, totalOutKbps, 1)
                                        const barWidth = Math.min(((p.in_kbps + p.out_kbps) / maxKbps) * 100, 100)
                                        return (
                                            <tr key={p.idx}>
                                                <td style={{ color: 'var(--muted)' }}>{p.idx}</td>
                                                <td style={{ color: 'var(--text)' }}>{p.name}</td>
                                                <td style={{ color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {p.alias || '—'}
                                                </td>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                                                        background: p.up ? 'rgba(104,211,145,.15)' : 'rgba(252,129,129,.1)',
                                                        color: p.up ? '#68d391' : '#fc8181',
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    }}>
                                                        <span style={{
                                                            width: 5, height: 5, borderRadius: '50%',
                                                            background: p.up ? '#68d391' : '#fc8181',
                                                            animation: p.up ? 'pulse 2s infinite' : 'none',
                                                        }} />
                                                        {p.up ? 'Up' : 'Down'}
                                                    </span>
                                                </td>
                                                <td style={{ color: '#68d391' }}>{p.up ? fmtKbps(p.out_kbps) : '—'}</td>
                                                <td style={{ color: '#63b3ed' }}>{p.up ? fmtKbps(p.in_kbps)  : '—'}</td>
                                                <td style={{ width: 80 }}>
                                                    {p.up && (p.in_kbps > 0 || p.out_kbps > 0) ? (
                                                        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                                                            <div style={{
                                                                width: `${barWidth}%`, height: '100%', borderRadius: 3,
                                                                background: 'linear-gradient(90deg, #2b6cb0, #68d391)',
                                                                transition: 'width .3s',
                                                            }} />
                                                        </div>
                                                    ) : null}
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

            {/* ── Stats bar ── */}
            <div className="g5" style={{ marginBottom: 32 }}>
                {[
                    { label: 'Nodos Proxmox', val: s?.proxmox?.nodes ?? nodes.length, color: 'var(--accent)',  icon: 'fa-cubes' },
                    { label: 'VMs Running',   val: s?.proxmox?.running ?? '—',         color: 'var(--accent2)', icon: 'fa-play' },
                    { label: 'VMs Total',     val: s?.proxmox?.vms_total ?? '—',        color: 'var(--accent4)', icon: 'fa-layer-group' },
                    { label: 'K8s Nodes',     val: k8sNodes.length || s?.k8s?.nodes || '—', color: 'var(--accent6)', icon: 'fa-dharmachakra' },
                    { label: 'Gateways Online', val: s?.opnsense?.wan_up ?? '—',        color: 'var(--accent3)', icon: 'fa-tower-broadcast' },
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

            {/* ── OPNsense gateways ── */}
            {gateways.length > 0 && <>
                <div className="sec-title" style={{ marginBottom: 16 }}>
                    <i className="fa-solid fa-shield-halved" /> OPNsense — Gateways
                </div>
                <div className="g3" style={{ marginBottom: 32 }}>
                    {gateways.map((gw: any, i: number) => {
                        const up = gw.status_translated === 'Online' || gw.status === 'none'
                        const isDefault = gw.defaultgw === true
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
                                                    border: '1px solid rgba(99,179,237,0.35)', letterSpacing: 0.3,
                                                }}>
                                                    WAN ACTIVO
                                                </span>
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
                            </div>
                        )
                    })}
                </div>
            </>}

            {/* ── OPNsense interfaces ── */}
            {(() => {
                // Normalize OPNsense 26.x interface stats
                // Format: { statistics: { "[LABEL] (ifname) / addr": { name, flags:"0x8843", received-bytes, sent-bytes, ... } } }
                const raw = opnIfaces?.data ?? {}
                const statsMap: Record<string, any> = raw?.statistics ?? (typeof raw === 'object' ? raw : {})

                const flagsUp = (flags: any): boolean => {
                    if (typeof flags === 'number') return (flags & 0x1) !== 0
                    if (typeof flags === 'string') {
                        // hex string: "0x8843" or "8843"
                        if (/^0x/i.test(flags)) return (parseInt(flags, 16) & 0x1) !== 0
                        if (/^[0-9a-f]+$/i.test(flags) && flags.length >= 4) return (parseInt(flags, 16) & 0x1) !== 0
                        return flags.toLowerCase().includes('up')
                    }
                    return true
                }

                // Group entries by BSD interface name (vtnet0, vtnet1, …)
                const byIface: Record<string, { label: string; ip: string; in_bytes: number; out_bytes: number; flags: any }> = {}
                for (const [key, f] of Object.entries(statsMap) as [string, any][]) {
                    if (typeof f !== 'object' || !f) continue
                    const ifname = f.name ?? key
                    const addrPart = key.split(' / ').pop() ?? ''
                    const isMAC = addrPart.includes(':') && addrPart.split(':').length === 6
                    const label = key.match(/^\[(.+?)\]/)?.[1] ?? ifname

                    if (!byIface[ifname]) byIface[ifname] = { label, ip: '', in_bytes: 0, out_bytes: 0, flags: f.flags }

                    if (isMAC) {
                        // Link-layer row: has full cumulative byte counters
                        byIface[ifname].in_bytes  = parseInt(f['received-bytes'] ?? f.in_bytes ?? f.inbytes ?? '0') || byIface[ifname].in_bytes
                        byIface[ifname].out_bytes = parseInt(f['sent-bytes']     ?? f.out_bytes ?? f.outbytes ?? '0') || byIface[ifname].out_bytes
                        byIface[ifname].flags     = f.flags ?? byIface[ifname].flags
                        byIface[ifname].label     = label
                    } else {
                        // IP-level row: grab first IP only (primary/gateway address)
                        if (!byIface[ifname].ip) byIface[ifname].ip = addrPart
                        if (!byIface[ifname].flags) byIface[ifname].flags = f.flags
                        if (!byIface[ifname].in_bytes)  byIface[ifname].in_bytes  = parseInt(f['received-bytes'] ?? f.in_bytes ?? '0') || 0
                        if (!byIface[ifname].out_bytes) byIface[ifname].out_bytes = parseInt(f['sent-bytes']     ?? f.out_bytes ?? '0') || 0
                    }
                }
                const ifaceList = Object.values(byIface).map(f => ({
                    name:      f.label,
                    ip:        f.ip,
                    in_bytes:  f.in_bytes,
                    out_bytes: f.out_bytes,
                    up:        flagsUp(f.flags),
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
                            <i className={`fa-solid fa-chevron-${showOpnIfaces ? 'up' : 'down'}`}
                                style={{ fontSize: 10, marginLeft: 4 }} />
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
                                                    }}>
                                                        {f.up !== false ? 'Up' : 'Down'}
                                                    </span>
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

            {/* ── K8s nodes ── */}
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
            <div className="sec-title"><i className="fa-solid fa-cubes" /> Proxmox — Inventario</div>
            {pvVMs?.error && (
                <div className="error-banner">
                    <i className="fa-solid fa-triangle-exclamation" /> Proxmox: {pvVMs.error}
                </div>
            )}
            {nodes.map((node: any) => {
                const vms = (byNode[node.name] ?? []).filter((v: any) => !v.template)
                const memPct = node.mem_max ? Math.round(node.mem_used / node.mem_max * 100) : 0
                const running = vms.filter((v: any) => v.status === 'running').length
                return (
                    <div key={node.name} style={{ marginBottom: 24 }}>
                        <div className="node-header">
                            <i className="fa-solid fa-cubes" />
                            <div>
                                <div className="node-title">{node.name}</div>
                                <div className="node-sub">{vms.length} VMs/LXC · {running} running · uptime {fmtUptime(node.uptime)}</div>
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>CPU <span style={{ color: 'var(--accent4)' }}>{node.cpu}%</span></span>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>RAM <span style={{ color: 'var(--accent2)' }}>{memPct}%</span></span>
                                <span className={`pill ${node.status === 'online' ? 'pill-green' : 'pill-red'}`}>
                                    <span className={`dot ${node.status === 'online' ? 'dot-green' : 'dot-red'}`} />
                                    {node.status}
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
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead><tr><th>ID</th><th>Tipo</th><th>Nombre</th><th>RAM</th><th>Disco</th><th>Estado</th></tr></thead>
                                <tbody>
                                    {vms.map((v: any) => {
                                        const mem = v.maxmem / 1048576
                                        const disk = v.maxdisk / 1073741824
                                        const run = v.status === 'running'
                                        return (
                                            <tr key={v.vmid}>
                                                <td style={{ color: 'var(--accent4)' }}>{v.vmid}</td>
                                                <td><span className={v.type === 'qemu' ? 'type-badge type-vm' : 'type-badge type-lxc'}>{v.type === 'qemu' ? 'VM' : 'LXC'}</span></td>
                                                <td style={{ color: 'var(--text)' }}>{v.name}</td>
                                                <td>{mem < 1024 ? `${mem.toFixed(0)} MB` : `${(mem / 1024).toFixed(1)} GB`}</td>
                                                <td>{disk > 0 ? `${disk.toFixed(1)} GB` : '—'}</td>
                                                <td>
                                                    <span className={`pill ${run ? 'pill-green' : 'pill-yellow'}`}>
                                                        {run && <span className="dot dot-green" style={{ width: 5, height: 5 }} />}
                                                        {run ? 'Running' : 'Stopped'}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })}

            {nodes.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)', marginBottom: 32 }}>
                    <i className="fa-solid fa-plug-circle-xmark" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
                    Sin datos de Proxmox. Configura las credenciales en Settings.
                </div>
            )}

            {/* ── Services section ── */}
            <div className="sec-title" style={{ marginTop: 8 }}><i className="fa-solid fa-server" /> Servicios</div>
            <div className="g3" style={{ marginBottom: 32 }}>
                {/* Plex */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-yellow"><i className="fa-solid fa-film" /></div>
                        <div>
                            <div className="card-title">Plex Media Server</div>
                            <div className="card-sub">{plex?.data?.version ?? 'Sin datos'}</div>
                        </div>
                        <span className={`pill ${plex?.data ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${plex?.data ? 'dot-green' : 'dot-red'}`} />
                            {plex?.data ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {plex?.data?.libraries?.map((lib: any) => (
                        <div key={lib.key} className="kv-row">
                            <span className="kv-key">{lib.title}</span>
                            <span className="kv-val val-yellow">{lib.count} items</span>
                        </div>
                    ))}
                    {!plex?.data && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Plex en Settings</div>}
                </div>
                {/* Immich */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-purple"><i className="fa-solid fa-images" /></div>
                        <div><div className="card-title">Immich</div><div className="card-sub">Galería fotográfica</div></div>
                        <span className={`pill ${immich?.data ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${immich?.data ? 'dot-green' : 'dot-red'}`} />
                            {immich?.data ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {immich?.data && <>
                        <div className="kv-row"><span className="kv-key">Fotos</span><span className="kv-val val-purple">{immich.data.photos?.toLocaleString() ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Vídeos</span><span className="kv-val val-purple">{immich.data.videos?.toLocaleString() ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Almacenamiento</span><span className="kv-val val-blue">{fmtBytes(immich.data.usageByUser?.reduce((a: number, u: any) => a + (u.diskUsageRaw ?? 0), 0) ?? 0)}</span></div>
                    </>}
                    {!immich?.data && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Immich en Settings</div>}
                </div>
                {/* Unraid */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-teal"><i className="fa-solid fa-database" /></div>
                        <div><div className="card-title">Unraid / NAS</div><div className="card-sub">{unraid?.data?.version ?? 'Sin datos'}</div></div>
                        <span className={`pill ${unraid?.data ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${unraid?.data ? 'dot-green' : 'dot-red'}`} />
                            {unraid?.data ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {unraid?.data && <>
                        <div className="kv-row"><span className="kv-key">Array</span><span className="kv-val val-green">{unraid.data.arrayStatus ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">CPU</span><span className="kv-val val-yellow">{unraid.data.cpu ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">RAM</span><span className="kv-val val-blue">{fmtBytes(unraid.data.memUsed ?? 0)} / {fmtBytes(unraid.data.memTotal ?? 0)}</span></div>
                    </>}
                    {!unraid?.data && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Unraid en Settings</div>}
                </div>
                {/* Home Assistant */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-blue"><i className="fa-solid fa-house-signal" /></div>
                        <div><div className="card-title">Home Assistant</div><div className="card-sub">{haStates.length} entidades</div></div>
                        <span className={`pill ${haStates.length > 0 ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${haStates.length > 0 ? 'dot-green' : 'dot-red'}`} />
                            {haStates.length > 0 ? 'Online' : 'Offline'}
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
                </div>
            </div>
        </div>
    )
}
