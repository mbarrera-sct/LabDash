import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtUptime } from '../utils/fmt'
import { Sparkline } from '../components/Sparkline'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

// ── Helpers ────────────────────────────────────────────────────────────────────

const flagsUp = (flags: any): boolean => {
    if (typeof flags === 'number') return (flags & 0x1) !== 0
    if (typeof flags === 'string') {
        if (/^0x/i.test(flags)) return (parseInt(flags, 16) & 0x1) !== 0
        if (/^[0-9a-f]+$/i.test(flags) && flags.length >= 4) return (parseInt(flags, 16) & 0x1) !== 0
        return flags.toLowerCase().includes('up')
    }
    return true
}

const HIDDEN_IFACES = new Set(['enc0', 'pflog0', 'pfsync0', 'lo0'])

// ── Component ──────────────────────────────────────────────────────────────────

export default function OPNsense({ onToast: _onToast }: Props) {
    const [sysinfo,    setSysinfo]    = useState<any>(null)
    const [gateways,   setGateways]   = useState<any[]>([])
    const [metrics,    setMetrics]    = useState<Record<string, number[]>>({})
    const [opnIfaces,  setOpnIfaces]  = useState<any>(null)
    const [dhcpLeases, setDhcpLeases] = useState<any[]>([])
    const [fwLog,      setFwLog]      = useState<any[]>([])
    const [fwRules,    setFwRules]    = useState<any[]>([])
    const [wireguard,  setWireguard]  = useState<any>(null)
    const [loading,    setLoading]    = useState(true)

    const [dhcpSearch,  setDhcpSearch]  = useState('')
    const [fwLogFilter, setFwLogFilter] = useState<'all' | 'block' | 'pass'>('all')

    const [showIfaces,  setShowIfaces]  = useState(true)
    const [showDhcp,    setShowDhcp]    = useState(false)
    const [showFwLog,   setShowFwLog]   = useState(false)
    const [showFwRules, setShowFwRules] = useState(false)

    // ── Loaders ───────────────────────────────────────────────

    const load = useCallback(async () => {
        try {
            const [sysinfoRes, gwRes, ifacesRes, dhcpRes, wgRes] = await Promise.allSettled([
                api.opnsenseSysinfo(),
                api.opnsenseGateways(),
                api.opnsenseIfaces(),
                api.opnsenseDhcp(),
                api.opnsenseWireguard(),
            ])
            if (sysinfoRes.status === 'fulfilled') setSysinfo(sysinfoRes.value)
            if (gwRes.status === 'fulfilled') {
                const raw = gwRes.value as any
                setGateways(raw?.items ?? raw?.data?.items ?? [])
            }
            if (ifacesRes.status === 'fulfilled') setOpnIfaces(ifacesRes.value)
            if (dhcpRes.status === 'fulfilled')   setDhcpLeases((dhcpRes.value as any).leases ?? [])
            if (wgRes.status === 'fulfilled')      setWireguard(wgRes.value)
        } finally {
            setLoading(false)
        }
    }, [])

    const loadFwLog = useCallback(async () => {
        try { setFwLog((await api.opnsenseFwlog()).entries ?? []) } catch { }
    }, [])

    const loadFwRules = useCallback(async () => {
        try { setFwRules((await api.opnsenseFwRules()).rules ?? []) } catch { }
    }, [])

    const loadMetrics = useCallback(async () => {
        try {
            const keys = await api.metricsKeys()
            const gwKeys = keys.keys.filter((k: string) => k.startsWith('gw.rtt.') || k.startsWith('gw.loss.'))
            const results = await Promise.allSettled(gwKeys.map((k: string) => api.getMetrics(k, 2)))
            const m: Record<string, number[]> = {}
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') m[gwKeys[i]] = r.value.points.map((p: any) => p.value)
            })
            setMetrics(m)
        } catch { }
    }, [])

    useEffect(() => {
        load()
        loadFwLog()
        loadFwRules()
        loadMetrics()
        const t1 = setInterval(load,        30000)
        const t2 = setInterval(loadFwLog,   30000)
        const t3 = setInterval(loadMetrics, 60000)
        return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3) }
    }, [load, loadFwLog, loadMetrics])

    // ── Derived: interfaces ───────────────────────────────────

    const ifaceList = (() => {
        const raw = opnIfaces?.data ?? opnIfaces ?? {}
        const statsMap: Record<string, any> = raw?.statistics ?? (typeof raw === 'object' ? raw : {})
        const byIface: Record<string, { label: string; ip: string; in_bytes: number; out_bytes: number; flags: any }> = {}
        for (const [key, f] of Object.entries(statsMap) as [string, any][]) {
            if (typeof f !== 'object' || !f) continue
            const ifname = f.name ?? key
            const addrPart = key.split(' / ').pop() ?? ''
            const isMAC = addrPart.includes(':') && addrPart.split(':').length === 6
            const label = key.match(/^\[(.+?)\]/)?.[1] ?? ifname
            if (!byIface[ifname]) byIface[ifname] = { label, ip: '', in_bytes: 0, out_bytes: 0, flags: f.flags }
            if (isMAC) {
                byIface[ifname].in_bytes  = parseInt(f['received-bytes'] ?? f.in_bytes  ?? '0') || byIface[ifname].in_bytes
                byIface[ifname].out_bytes = parseInt(f['sent-bytes']     ?? f.out_bytes ?? '0') || byIface[ifname].out_bytes
                byIface[ifname].flags     = f.flags ?? byIface[ifname].flags
                byIface[ifname].label     = label
            } else {
                if (!byIface[ifname].ip)        byIface[ifname].ip        = addrPart
                if (!byIface[ifname].flags)     byIface[ifname].flags     = f.flags
                if (!byIface[ifname].in_bytes)  byIface[ifname].in_bytes  = parseInt(f['received-bytes'] ?? '0') || 0
                if (!byIface[ifname].out_bytes) byIface[ifname].out_bytes = parseInt(f['sent-bytes']     ?? '0') || 0
            }
        }
        return Object.entries(byIface)
            .filter(([ifname]) => !HIDDEN_IFACES.has(ifname))
            .map(([, f]) => ({ name: f.label, ip: f.ip, in_bytes: f.in_bytes, out_bytes: f.out_bytes, up: flagsUp(f.flags) }))
    })()

    // ── Derived: sysinfo ──────────────────────────────────────

    const sys = sysinfo?.data ?? {}
    const gwOnlineCount = gateways.filter(g => g.status_translated === 'Online' || g.status === 'none').length

    // ── Derived: DHCP filtered ────────────────────────────────

    const filteredDhcp = dhcpLeases.filter(l => {
        if (!dhcpSearch) return true
        const q = dhcpSearch.toLowerCase()
        return (l.ip ?? '').toLowerCase().includes(q)
            || (l.mac ?? '').toLowerCase().includes(q)
            || (l.hostname ?? '').toLowerCase().includes(q)
    })

    // ── Derived: FW log filtered ──────────────────────────────

    const filteredFwLog = fwLog.filter(e => {
        if (fwLogFilter === 'all') return true
        const action = (e.action ?? '').toLowerCase()
        const isBlock = action.includes('block') || action === 'b'
        if (fwLogFilter === 'block') return isBlock
        return !isBlock
    }).slice(0, 50)

    // ── WireGuard data ────────────────────────────────────────

    const wgData = wireguard?.data ?? {}
    const wgServers: any[] = Array.isArray(wgData?.servers?.rows) ? wgData.servers.rows : []
    const wgClients: any[] = Array.isArray(wgData?.clients?.rows) ? wgData.clients.rows : []
    const hasWg = wgServers.length > 0 || wgClients.length > 0

    // ── Loading / no-data states ──────────────────────────────

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24 }} />
            Cargando…
        </div>
    )

    if (!sysinfo && !gateways.length) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', flexDirection: 'column', gap: 12 }}>
            <i className="fa-solid fa-shield-halved" style={{ fontSize: 36, opacity: 0.3 }} />
            <div>Configura OPNsense en Settings</div>
        </div>
    )

    // ── Render ────────────────────────────────────────────────

    return (
        <div>

            {/* ── System info bar ── */}
            <div className="g5" style={{ marginBottom: 32 }}>
                {[
                    {
                        label: 'Versión',
                        val: sys.product_version ?? '—',
                        color: 'var(--accent3)',
                        icon: 'fa-shield-halved',
                    },
                    {
                        label: 'Uptime',
                        val: sys.uptime ? fmtUptime(sys.uptime) : '—',
                        color: 'var(--accent)',
                        icon: 'fa-clock',
                    },
                    {
                        label: 'CPU',
                        val: sys.cpu_usage_percent != null ? `${Number(sys.cpu_usage_percent).toFixed(1)}%` : '—',
                        color: '#fbd38d',
                        icon: 'fa-microchip',
                    },
                    {
                        label: 'Memoria',
                        val: sys.memory_used != null && sys.memory_total != null
                            ? `${fmtBytes(sys.memory_used)} / ${fmtBytes(sys.memory_total)}`
                            : '—',
                        color: '#63b3ed',
                        icon: 'fa-memory',
                    },
                    {
                        label: 'Gateways WAN',
                        val: `${gwOnlineCount} / ${gateways.length}`,
                        color: gwOnlineCount === gateways.length && gateways.length > 0 ? '#68d391' : '#fc8181',
                        icon: 'fa-tower-broadcast',
                    },
                ].map(c => (
                    <div key={c.label} className="stat-card" style={{ borderLeft: `3px solid ${c.color}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <i className={`fa-solid ${c.icon}`} style={{ fontSize: 14, color: c.color, opacity: 0.7 }} />
                        </div>
                        <div className="stat-value" style={{ color: c.color, fontSize: typeof c.val === 'string' && c.val.length > 10 ? 16 : undefined }}>
                            {c.val}
                        </div>
                        <div className="stat-label">{c.label}</div>
                    </div>
                ))}
            </div>

            {/* ── Gateways ── */}
            {gateways.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                    <div className="sec-title" style={{ marginBottom: 16 }}>
                        <i className="fa-solid fa-tower-broadcast" /> Gateways
                    </div>
                    <div className="g3">
                        {gateways.map((gw: any, i: number) => {
                            const up = gw.status_translated === 'Online' || gw.status === 'none'
                            const isDefault = gw.defaultgw === true
                            const rttKey  = `gw.rtt.${gw.name}`
                            const lossKey = `gw.loss.${gw.name}`
                            const rttData  = metrics[rttKey]  ?? []
                            const lossData = metrics[lossKey] ?? []
                            return (
                                <div key={i} className="card" style={isDefault ? { borderColor: 'rgba(99,179,237,0.4)' } : undefined}>
                                    <div className="card-header">
                                        <div className={`card-icon ${up ? 'icon-green' : 'icon-red'}`}>
                                            <i className="fa-solid fa-network-wired" />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                {gw.name}
                                                {isDefault && (
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
                                                        background: 'rgba(99,179,237,0.15)', color: '#63b3ed',
                                                        border: '1px solid rgba(99,179,237,0.35)',
                                                    }}>
                                                        WAN PRINCIPAL
                                                    </span>
                                                )}
                                            </div>
                                            <div className="card-sub">
                                                {gw.gwaddr ?? ''}
                                                {gw.monitor ? ` · monitor: ${gw.monitor}` : ''}
                                            </div>
                                        </div>
                                        <span className={`pill ${up ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto', flexShrink: 0 }}>
                                            <span className={`dot ${up ? 'dot-green' : 'dot-red'}`} />
                                            {up ? 'Online' : 'Offline'}
                                        </span>
                                    </div>

                                    <div className="kv-row">
                                        <span className="kv-key">RTT</span>
                                        <span className="kv-val val-blue">{gw.delay ?? '—'}</span>
                                    </div>
                                    <div className="kv-row">
                                        <span className="kv-key">Pérdida de paquetes</span>
                                        <span className="kv-val val-yellow">{gw.loss ?? '—'}</span>
                                    </div>
                                    {gw.stddev && (
                                        <div className="kv-row">
                                            <span className="kv-key">Jitter</span>
                                            <span className="kv-val val-blue">{gw.stddev}</span>
                                        </div>
                                    )}

                                    {rttData.length > 1 && (
                                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>RTT (2h)</div>
                                            <Sparkline data={rttData} color="#b794f4" width={200} height={24} />
                                        </div>
                                    )}
                                    {lossData.length > 1 && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Pérdida % (2h)</div>
                                            <Sparkline data={lossData} color="#fc8181" width={200} height={20} />
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* ── Interfaces (collapsible, default expanded) ── */}
            {ifaceList.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div
                        className="sec-title"
                        style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowIfaces(s => !s)}
                    >
                        <i className="fa-solid fa-ethernet" /> Interfaces
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {ifaceList.filter(f => f.up).length}/{ifaceList.length} activas
                        </span>
                        <i className={`fa-solid fa-chevron-${showIfaces ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showIfaces && (
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Interfaz</th>
                                        <th>IP</th>
                                        <th>Estado</th>
                                        <th>↓ RX total</th>
                                        <th>↑ TX total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ifaceList.map((f, i) => (
                                        <tr key={i}>
                                            <td style={{ color: 'var(--accent4)', fontFamily: 'JetBrains Mono, monospace' }}>
                                                {f.name}
                                            </td>
                                            <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                {f.ip || '—'}
                                            </td>
                                            <td>
                                                <span style={{
                                                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                                                    background: f.up ? 'rgba(104,211,145,.15)' : 'rgba(252,129,129,.1)',
                                                    color: f.up ? '#68d391' : '#fc8181',
                                                }}>
                                                    {f.up ? 'Activa' : 'Inactiva'}
                                                </span>
                                            </td>
                                            <td style={{ color: '#63b3ed', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                {fmtBytes(f.in_bytes ?? 0)}
                                            </td>
                                            <td style={{ color: '#68d391', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                {fmtBytes(f.out_bytes ?? 0)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ── DHCP Leases (collapsible, default closed) ── */}
            <div style={{ marginBottom: 28 }}>
                <div
                    className="sec-title"
                    style={{ marginBottom: 12, cursor: 'pointer' }}
                    onClick={() => setShowDhcp(s => !s)}
                >
                    <i className="fa-solid fa-list-ul" /> DHCP Leases
                    <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8, marginLeft: 8,
                        background: 'rgba(104,211,145,0.12)', color: '#68d391',
                        border: '1px solid rgba(104,211,145,0.25)',
                    }}>
                        {dhcpLeases.length}
                    </span>
                    <i className={`fa-solid fa-chevron-${showDhcp ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                </div>
                {showDhcp && (
                    <>
                        <div style={{ marginBottom: 10 }}>
                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                <i className="fa-solid fa-magnifying-glass" style={{
                                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                                    fontSize: 11, color: 'var(--muted)',
                                }} />
                                <input
                                    type="text"
                                    placeholder="Filtrar IP, MAC, hostname…"
                                    value={dhcpSearch}
                                    onChange={e => setDhcpSearch(e.target.value)}
                                    style={{
                                        background: 'var(--surface)', border: '1px solid var(--border)',
                                        borderRadius: 8, color: 'var(--text)', fontSize: 12,
                                        padding: '5px 10px 5px 26px', outline: 'none', width: 220,
                                    }}
                                />
                            </div>
                        </div>
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>IP</th>
                                        <th>MAC</th>
                                        <th>Hostname</th>
                                        <th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDhcp.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px 0' }}>
                                                Sin resultados
                                            </td>
                                        </tr>
                                    ) : filteredDhcp.map((l: any, i: number) => {
                                        const isActive = l.state === 0 || l.state === 'active'
                                        return (
                                            <tr key={i}>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>{l.ip || '—'}</td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>{l.mac || '—'}</td>
                                                <td style={{ color: 'var(--text)' }}>{l.hostname || '—'}</td>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, padding: '2px 7px', borderRadius: 8, fontWeight: 700,
                                                        background: isActive ? 'rgba(104,211,145,.15)' : 'rgba(150,150,150,.1)',
                                                        color: isActive ? '#68d391' : 'var(--muted)',
                                                    }}>
                                                        {isActive ? 'Activo' : String(l.state ?? '—')}
                                                    </span>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* ── Firewall Log (collapsible, default closed) ── */}
            <div style={{ marginBottom: 28 }}>
                <div
                    className="sec-title"
                    style={{ marginBottom: 12, cursor: 'pointer' }}
                    onClick={() => setShowFwLog(s => !s)}
                >
                    <i className="fa-solid fa-fire-flame-curved" /> Log de Firewall
                    <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                        últimas {Math.min(fwLog.length, 50)} entradas · actualiza cada 30s
                    </span>
                    <i className={`fa-solid fa-chevron-${showFwLog ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                </div>
                {showFwLog && (
                    <>
                        {/* Filter buttons */}
                        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                            {(['all', 'block', 'pass'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFwLogFilter(f)}
                                    style={{
                                        padding: '4px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                                        border: `1px solid ${fwLogFilter === f ? 'var(--accent)' : 'var(--border)'}`,
                                        background: fwLogFilter === f ? 'rgba(99,179,237,0.15)' : 'var(--surface)',
                                        color: fwLogFilter === f ? 'var(--accent)' : 'var(--muted)',
                                        fontWeight: fwLogFilter === f ? 700 : 400,
                                    }}
                                >
                                    {f === 'all' ? 'Todos' : f === 'block' ? 'Block' : 'Pass'}
                                </button>
                            ))}
                        </div>
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Acción</th>
                                        <th>IP Origen</th>
                                        <th>IP Destino</th>
                                        <th>Puerto</th>
                                        <th>Proto</th>
                                        <th>Interfaz</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredFwLog.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px 0' }}>
                                                Sin entradas
                                            </td>
                                        </tr>
                                    ) : filteredFwLog.map((e: any, i: number) => {
                                        const action = (e.action ?? '').toLowerCase()
                                        const isBlock = action.includes('block') || action === 'b'
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
                                                    {e.src ?? '—'}
                                                </td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                    {e.dst ?? '—'}
                                                </td>
                                                <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                                                    {e.dstport ?? e.srcport ?? '—'}
                                                </td>
                                                <td style={{ color: 'var(--muted)', fontSize: 11 }}>{e.proto || '—'}</td>
                                                <td style={{ color: 'var(--muted)', fontSize: 11 }}>{e.interface ?? e.iface ?? '—'}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* ── WireGuard (only if data exists) ── */}
            {hasWg && (
                <div style={{ marginBottom: 28 }}>
                    <div className="sec-title" style={{ marginBottom: 16 }}>
                        <i className="fa-solid fa-lock" /> WireGuard
                    </div>
                    <div className="g3">
                        {wgServers.length > 0 && (
                            <div className="card">
                                <div className="card-header">
                                    <div className="card-icon icon-blue">
                                        <i className="fa-solid fa-server" />
                                    </div>
                                    <div>
                                        <div className="card-title">Servidores</div>
                                        <div className="card-sub">{wgServers.length} configurados</div>
                                    </div>
                                </div>
                                {wgServers.map((s: any, i: number) => (
                                    <div key={i}>
                                        {s.name && <div className="kv-row"><span className="kv-key">Nombre</span><span className="kv-val val-blue">{s.name}</span></div>}
                                        {s.pubkey && <div className="kv-row"><span className="kv-key">Clave pública</span><span className="kv-val" style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>{s.pubkey.slice(0, 16)}…</span></div>}
                                        {s.interface && <div className="kv-row"><span className="kv-key">Interfaz</span><span className="kv-val" style={{ color: 'var(--muted)' }}>{s.interface}</span></div>}
                                        {i < wgServers.length - 1 && <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '8px 0' }} />}
                                    </div>
                                ))}
                            </div>
                        )}
                        {wgClients.length > 0 && (
                            <div className="card">
                                <div className="card-header">
                                    <div className="card-icon icon-green">
                                        <i className="fa-solid fa-laptop" />
                                    </div>
                                    <div>
                                        <div className="card-title">Clientes</div>
                                        <div className="card-sub">{wgClients.length} configurados</div>
                                    </div>
                                </div>
                                {wgClients.map((c: any, i: number) => (
                                    <div key={i}>
                                        {c.name && <div className="kv-row"><span className="kv-key">Nombre</span><span className="kv-val val-green">{c.name}</span></div>}
                                        {c.pubkey && <div className="kv-row"><span className="kv-key">Clave pública</span><span className="kv-val" style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>{c.pubkey.slice(0, 16)}…</span></div>}
                                        {c.tunnel_address && <div className="kv-row"><span className="kv-key">Túnel</span><span className="kv-val" style={{ color: 'var(--muted)' }}>{c.tunnel_address}</span></div>}
                                        {i < wgClients.length - 1 && <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '8px 0' }} />}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Firewall Rules (collapsible, default closed) ── */}
            {fwRules.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                    <div
                        className="sec-title"
                        style={{ marginBottom: 12, cursor: 'pointer' }}
                        onClick={() => setShowFwRules(s => !s)}
                    >
                        <i className="fa-solid fa-shield-halved" /> Reglas de Firewall
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>
                            {fwRules.length} reglas
                        </span>
                        <i className={`fa-solid fa-chevron-${showFwRules ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 4 }} />
                    </div>
                    {showFwRules && (
                        <div className="card" style={{ padding: 0 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Activa</th>
                                        <th>Acción</th>
                                        <th>Descripción</th>
                                        <th>Protocolo</th>
                                        <th>Origen</th>
                                        <th>Destino</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fwRules.slice(0, 50).map((r: any, i: number) => {
                                        const action = (r.action ?? r.type ?? '').toLowerCase()
                                        const isBlock = action.includes('block') || action === 'reject'
                                        const isPass  = action.includes('pass')  || action.includes('allow')
                                        const enabled = r.enabled === true || r.enabled === '1' || r.enabled === 1
                                        return (
                                            <tr key={i} style={!enabled ? { opacity: 0.45 } : undefined}>
                                                <td>
                                                    <span style={{
                                                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                                                        background: enabled ? 'rgba(104,211,145,.15)' : 'rgba(150,150,150,.1)',
                                                        color: enabled ? '#68d391' : 'var(--muted)',
                                                    }}>
                                                        {enabled ? 'Sí' : 'No'}
                                                    </span>
                                                </td>
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
                                                    {r.description || r.descr || '—'}
                                                </td>
                                                <td style={{ color: 'var(--muted)', fontSize: 11 }}>
                                                    {r.protocol || r.proto || 'any'}
                                                </td>
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
        </div>
    )
}
