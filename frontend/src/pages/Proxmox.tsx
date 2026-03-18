import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtUptime } from '../utils/fmt'
import { Sparkline } from '../components/Sparkline'
import { LineChart } from '../components/LineChart'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

// ── Sort helper ────────────────────────────────────────────────────────────────

function sortVms(vms: any[], col: string, dir: 'asc' | 'desc') {
    return [...vms].sort((a, b) => {
        let av: any, bv: any
        switch (col) {
            case 'vmid':   av = a.vmid ?? 0;                         bv = b.vmid ?? 0;                         break
            case 'node':   av = a.node ?? '';                         bv = b.node ?? '';                        break
            case 'type':   av = a.type ?? '';                         bv = b.type ?? '';                        break
            case 'name':   av = (a.name ?? '').toLowerCase();         bv = (b.name ?? '').toLowerCase();        break
            case 'cpu':    av = a.cpu ?? 0;                           bv = b.cpu ?? 0;                          break
            case 'mem':    av = a.maxmem ?? 0;                        bv = b.maxmem ?? 0;                       break
            case 'status': av = a.status === 'running' ? 1 : 0;       bv = b.status === 'running' ? 1 : 0;      break
            default: return 0
        }
        if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        return dir === 'asc' ? av - bv : bv - av
    })
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function Proxmox({ onToast }: Props) {
    const [nodes,       setNodes]       = useState<any[]>([])
    const [vmsByNode,   setVmsByNode]   = useState<Record<string, any[]>>({})
    const [nodeDetails, setNodeDetails] = useState<Record<string, any>>({})
    const [metrics,     setMetrics]     = useState<Record<string, number[]>>({})
    const [pveUrl,      setPveUrl]      = useState<string>('')
    const [vmActions,   setVmActions]   = useState<Record<number, boolean>>({})
    const [loading,     setLoading]     = useState(true)

    const [vmSort,       setVmSort]       = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'status', dir: 'desc' })
    const [nodeFilter,   setNodeFilter]   = useState<string>('all')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [search,       setSearch]       = useState<string>('')
    const [timeRange,    setTimeRange]    = useState<number>(() => {
        const saved = parseInt(localStorage.getItem('labdash_pve_chart_hours') ?? '2', 10)
        return isNaN(saved) ? 2 : saved
    })

    // ── Data loaders ──────────────────────────────────────────

    const load = useCallback(async () => {
        try {
            const [nodesRes, vmsRes, cfgRes] = await Promise.allSettled([
                api.proxmoxNodes(),
                api.proxmoxVMs(),
                api.proxmoxConfig(),
            ])
            if (nodesRes.status === 'fulfilled') setNodes((nodesRes.value as any).nodes ?? [])
            if (vmsRes.status   === 'fulfilled') setVmsByNode((vmsRes.value as any).by_node ?? {})
            if (cfgRes.status   === 'fulfilled') setPveUrl((cfgRes.value as any).pve_url ?? '')
        } finally {
            setLoading(false)
        }
    }, [])

    const loadNodeDetails = useCallback(async (nodeList: any[]) => {
        for (const node of nodeList) {
            try {
                const d = await api.proxmoxNodeDetail(node.name)
                setNodeDetails(prev => ({ ...prev, [node.name]: d }))
            } catch { }
        }
    }, [])

    const loadMetrics = useCallback(async (hours: number) => {
        try {
            const keys = await api.metricsKeys()
            const cpuKeys = keys.keys.filter((k: string) => k.startsWith('pve.cpu') || k.startsWith('pve.mem'))
            const results = await Promise.allSettled(cpuKeys.map((k: string) => api.getMetrics(k, hours)))
            const m: Record<string, number[]> = {}
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') m[cpuKeys[i]] = (r.value as any).points.map((p: any) => p.value)
            })
            setMetrics(m)
        } catch { }
    }, [])

    useEffect(() => {
        load()
        loadMetrics(timeRange)
        const t1 = setInterval(load, 30000)
        const t2 = setInterval(() => loadMetrics(timeRange), 60000)
        return () => { clearInterval(t1); clearInterval(t2) }
    }, [load, loadMetrics, timeRange])

    useEffect(() => {
        if (nodes.length > 0) loadNodeDetails(nodes)
    }, [nodes, loadNodeDetails])

    // ── VM action ─────────────────────────────────────────────

    const handleVmAction = async (vm: any, action: string) => {
        setVmActions(p => ({ ...p, [vm.vmid]: true }))
        try {
            await api.proxmoxVmAction(vm.node, vm.type, vm.vmid, action)
            onToast('success', `${action} enviado a ${vm.name}`)
            setTimeout(load, 3000)
        } catch (err: any) {
            onToast('error', err.message || `Error al ejecutar ${action}`)
        } finally {
            setVmActions(p => ({ ...p, [vm.vmid]: false }))
        }
    }

    // ── Derived values ────────────────────────────────────────

    const allVms: any[] = Object.entries(vmsByNode).flatMap(([node, vms]) =>
        vms.map(vm => ({ ...vm, node }))
    )
    const templates = allVms.filter(vm => vm.template)
    const nonTemplates = allVms.filter(vm => !vm.template)
    const running = nonTemplates.filter(vm => vm.status === 'running')
    const stopped = nonTemplates.filter(vm => vm.status !== 'running')

    const totalCpu = nodes.length
        ? nodes.reduce((s, n) => s + (n.cpu ?? 0), 0) / nodes.length
        : 0
    const totalMem = nodes.reduce((s, n) => s + (n.mem_used ?? 0), 0)
    const totalMemMax = nodes.reduce((s, n) => s + (n.mem_max ?? 0), 0)
    const memPct = totalMemMax > 0 ? (totalMem / totalMemMax) * 100 : 0

    const nodeNames = Object.keys(vmsByNode)

    const filteredVms = sortVms(
        nonTemplates.filter(vm => {
            if (nodeFilter !== 'all' && vm.node !== nodeFilter) return false
            if (statusFilter !== 'all' && vm.status !== statusFilter) return false
            if (search) {
                const q = search.toLowerCase()
                if (!String(vm.vmid).includes(q) && !(vm.name ?? '').toLowerCase().includes(q)) return false
            }
            return true
        }),
        vmSort.col,
        vmSort.dir
    )

    const toggleSort = (col: string) =>
        setVmSort(prev =>
            prev.col === col
                ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { col, dir: col === 'status' ? 'desc' : 'asc' }
        )

    const SortIcon = ({ col }: { col: string }) => {
        if (vmSort.col !== col) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: 4, fontSize: 9 }} />
        return <i className={`fa-solid fa-sort-${vmSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 4, fontSize: 9, color: 'var(--accent)' }} />
    }

    // ── Loading / no-data states ──────────────────────────────

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24 }} />
            Cargando…
        </div>
    )

    if (!nodes.length) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', flexDirection: 'column', gap: 12 }}>
            <i className="fa-solid fa-cubes" style={{ fontSize: 36, opacity: 0.3 }} />
            <div>Configura Proxmox VE en Settings</div>
        </div>
    )

    // ── Render ────────────────────────────────────────────────

    return (
        <div>

            {/* ── Cluster summary bar ── */}
            <div className="g5" style={{ marginBottom: 32 }}>
                {[
                    { label: 'Nodos',      val: nodes.length,        color: 'var(--accent)',  icon: 'fa-cubes' },
                    { label: 'VMs / LXC',  val: nonTemplates.length, color: 'var(--accent2)', icon: 'fa-layer-group' },
                    { label: 'Ejecutando', val: running.length,       color: '#68d391',        icon: 'fa-play' },
                    { label: 'Templates',  val: templates.length,     color: 'var(--accent4)', icon: 'fa-copy' },
                    { label: 'CPU clúster', val: `${totalCpu.toFixed(1)}%`, color: '#fbd38d', icon: 'fa-microchip' },
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

            {/* RAM % card separate to show progress */}
            <div style={{ marginBottom: 32, display: 'flex', gap: 16, alignItems: 'stretch' }}>
                <div className="stat-card" style={{ borderLeft: '3px solid #63b3ed', flex: '0 0 auto', minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <i className="fa-solid fa-memory" style={{ fontSize: 14, color: '#63b3ed', opacity: 0.7 }} />
                    </div>
                    <div className="stat-value" style={{ color: '#63b3ed' }}>{memPct.toFixed(1)}%</div>
                    <div className="stat-label">RAM clúster</div>
                    <div className="prog-bar" style={{ marginTop: 8 }}>
                        <div
                            className={`prog-fill ${memPct > 80 ? 'prog-red' : memPct > 50 ? 'prog-yellow' : 'prog-green'}`}
                            style={{ width: `${Math.min(memPct, 100)}%` }}
                        />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                        {fmtBytes(totalMem)} / {fmtBytes(totalMemMax)}
                    </div>
                </div>
            </div>

            {/* ── Node cards ── */}
            <div className="sec-title" style={{ marginBottom: 16 }}>
                <i className="fa-solid fa-server" /> Nodos
            </div>
            <div className="g3" style={{ marginBottom: 32 }}>
                {nodes.map((node: any) => {
                    const detail = nodeDetails[node.name]
                    const cpuPct = node.cpu ?? 0
                    const memPctNode = node.mem_max > 0 ? (node.mem_used / node.mem_max) * 100 : 0
                    const isOnline = node.status === 'online'
                    const nodeVms: any[] = (vmsByNode[node.name] ?? []).filter(v => !v.template)
                    const nodeRunning = nodeVms.filter(v => v.status === 'running').length
                    const nodeStopped = nodeVms.filter(v => v.status !== 'running').length
                    const cpuMetricKey = `pve.cpu.${node.name}`
                    const memMetricKey = `pve.mem.${node.name}`
                    const cpuHistory = metrics[cpuMetricKey] ?? []
                    const memHistory = metrics[memMetricKey] ?? []

                    const healthyDisks = (detail?.disks ?? []).filter((d: any) => d.health === 'PASSED' || d.health === 'OK').length
                    const totalDisks = (detail?.disks ?? []).length

                    return (
                        <div key={node.name} className="card" style={isOnline ? { borderColor: 'rgba(104,211,145,0.25)' } : { borderColor: 'rgba(252,129,129,0.25)' }}>
                            <div className="card-header">
                                <div className={`card-icon ${isOnline ? 'icon-green' : 'icon-red'}`}>
                                    <i className="fa-solid fa-server" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="card-title">{node.name}</div>
                                    <div className="card-sub">
                                        {fmtUptime(node.uptime ?? 0)} uptime
                                        {detail?.cpu_temp ? ` · ${detail.cpu_temp}°C` : ''}
                                    </div>
                                </div>
                                <span className={`pill ${isOnline ? 'pill-green' : 'pill-red'}`}>
                                    <span className={`dot ${isOnline ? 'dot-green' : 'dot-red'}`} />
                                    {isOnline ? 'Online' : 'Offline'}
                                </span>
                            </div>

                            {/* CPU */}
                            <div style={{ marginBottom: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                    <span style={{ color: 'var(--muted)' }}>CPU</span>
                                    <span style={{ color: cpuPct > 80 ? '#fc8181' : cpuPct > 50 ? '#fbd38d' : '#68d391', fontFamily: 'JetBrains Mono, monospace' }}>
                                        {cpuPct.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="prog-bar">
                                    <div
                                        className={`prog-fill ${cpuPct > 80 ? 'prog-red' : cpuPct > 50 ? 'prog-yellow' : 'prog-green'}`}
                                        style={{ width: `${Math.min(cpuPct, 100)}%` }}
                                    />
                                </div>
                                {cpuHistory.length > 1 && (
                                    <div style={{ marginTop: 4 }}>
                                        <Sparkline data={cpuHistory} color={cpuPct > 80 ? '#fc8181' : cpuPct > 50 ? '#fbd38d' : '#68d391'} width={200} height={22} />
                                    </div>
                                )}
                            </div>

                            {/* RAM */}
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                    <span style={{ color: 'var(--muted)' }}>RAM</span>
                                    <span style={{ color: '#63b3ed', fontFamily: 'JetBrains Mono, monospace' }}>
                                        {fmtBytes(node.mem_used ?? 0)} / {fmtBytes(node.mem_max ?? 0)}
                                    </span>
                                </div>
                                <div className="prog-bar">
                                    <div
                                        className={`prog-fill ${memPctNode > 80 ? 'prog-red' : memPctNode > 50 ? 'prog-yellow' : 'prog-green'}`}
                                        style={{ width: `${Math.min(memPctNode, 100)}%` }}
                                    />
                                </div>
                                {memHistory.length > 1 && (
                                    <div style={{ marginTop: 4 }}>
                                        <Sparkline data={memHistory} color="#63b3ed" width={200} height={22} />
                                    </div>
                                )}
                            </div>

                            {/* VM counts */}
                            <div className="kv-row">
                                <span className="kv-key">VMs ejecutando</span>
                                <span className="kv-val val-green">{nodeRunning}</span>
                            </div>
                            <div className="kv-row">
                                <span className="kv-key">VMs paradas</span>
                                <span className="kv-val" style={{ color: 'var(--muted)' }}>{nodeStopped}</span>
                            </div>

                            {/* Disk health */}
                            {totalDisks > 0 && (
                                <div className="kv-row">
                                    <span className="kv-key">Discos OK</span>
                                    <span className={`kv-val ${healthyDisks === totalDisks ? 'val-green' : 'val-yellow'}`}>
                                        {healthyDisks}/{totalDisks}
                                    </span>
                                </div>
                            )}

                            {/* CPU temp */}
                            {detail?.cpu_temp && (
                                <div className="kv-row">
                                    <span className="kv-key">Temp. CPU</span>
                                    <span className={`kv-val ${detail.cpu_temp > 80 ? 'val-red' : detail.cpu_temp > 65 ? 'val-yellow' : 'val-green'}`}>
                                        {detail.cpu_temp}°C
                                    </span>
                                </div>
                            )}

                            {/* Console link */}
                            {pveUrl && isOnline && (
                                <div style={{ marginTop: 12 }}>
                                    <a
                                        href={pveUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            fontSize: 11, color: 'var(--accent)', textDecoration: 'none',
                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                        }}
                                    >
                                        <i className="fa-solid fa-arrow-up-right-from-square" style={{ fontSize: 9 }} />
                                        Abrir PVE
                                    </a>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* ── Historical charts ── */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div className="sec-title" style={{ margin: 0 }}>
                        <i className="fa-solid fa-chart-line" /> Gráficos históricos
                    </div>
                    {/* Time range selector */}
                    <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                        {([
                            { h: 2,   label: '2h'  },
                            { h: 6,   label: '6h'  },
                            { h: 12,  label: '12h' },
                            { h: 24,  label: '24h' },
                            { h: 48,  label: '2d'  },
                            { h: 168, label: '7d'  },
                            { h: 720, label: '30d' },
                        ] as { h: number; label: string }[]).map(({ h, label }) => (
                            <button
                                key={h}
                                onClick={() => {
                                    setTimeRange(h)
                                    localStorage.setItem('labdash_pve_chart_hours', String(h))
                                }}
                                style={{
                                    padding: '3px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                                    border: `1px solid ${timeRange === h ? 'var(--accent)' : 'var(--border)'}`,
                                    background: timeRange === h ? 'rgba(99,179,237,0.15)' : 'transparent',
                                    color: timeRange === h ? 'var(--accent)' : 'var(--muted)',
                                    fontWeight: timeRange === h ? 700 : 400,
                                    transition: 'all .15s',
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                {nodes.some(n => (metrics[`pve.cpu.${n.name}`]?.length ?? 0) > 1 || (metrics[`pve.mem.${n.name}`]?.length ?? 0) > 1) ? (
                    <div className="g3">
                        {nodes.map((node: any) => {
                            const cpuHistory = metrics[`pve.cpu.${node.name}`] ?? []
                            const memHistory = metrics[`pve.mem.${node.name}`] ?? []
                            if (cpuHistory.length < 2 && memHistory.length < 2) return null
                            const cpuPct = node.cpu ?? 0
                            const tlabel = timeRange >= 720 ? '−30d' : timeRange >= 168 ? '−7d' : timeRange >= 48 ? '−2d' : timeRange >= 24 ? '−24h' : timeRange >= 12 ? '−12h' : timeRange >= 6 ? '−6h' : '−2h'
                            const mlabel = timeRange >= 720 ? '−15d' : timeRange >= 168 ? '−3d' : timeRange >= 48 ? '−1d' : timeRange >= 24 ? '−12h' : timeRange >= 12 ? '−6h' : timeRange >= 6 ? '−3h' : '−1h'
                            return (
                                <div key={`chart-${node.name}`} className="card">
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <i className="fa-solid fa-server" style={{ color: 'var(--accent)', fontSize: 11 }} />
                                        {node.name}
                                    </div>
                                    {cpuHistory.length > 1 && (
                                        <div style={{ marginBottom: 16 }}>
                                            <LineChart
                                                data={cpuHistory}
                                                color={cpuPct > 80 ? '#fc8181' : cpuPct > 50 ? '#fbd38d' : '#68d391'}
                                                label="CPU %"
                                                unit="%"
                                                width={400}
                                                height={90}
                                                timeLabel={tlabel}
                                                midLabel={mlabel}
                                            />
                                        </div>
                                    )}
                                    {memHistory.length > 1 && (
                                        <LineChart
                                            data={memHistory}
                                            color="#63b3ed"
                                            label="RAM %"
                                            unit="%"
                                            width={400}
                                            height={90}
                                            timeLabel={tlabel}
                                            midLabel={mlabel}
                                        />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', fontSize: 13 }}>
                        <i className="fa-solid fa-chart-line" style={{ fontSize: 24, marginBottom: 8, display: 'block', opacity: 0.3 }} />
                        Sin datos históricos aún. Se recopilarán en el próximo ciclo de métricas.
                    </div>
                )}
            </div>

            {/* ── VM / LXC table ── */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div className="sec-title" style={{ margin: 0 }}>
                        <i className="fa-solid fa-layer-group" /> VMs y Contenedores
                    </div>
                    <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                        background: 'rgba(99,179,237,0.15)', color: '#63b3ed',
                        border: '1px solid rgba(99,179,237,0.3)',
                    }}>
                        {filteredVms.length} VMs
                    </span>
                    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                        {/* Search */}
                        <div style={{ position: 'relative' }}>
                            <i className="fa-solid fa-magnifying-glass" style={{
                                position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                                fontSize: 11, color: 'var(--muted)',
                            }} />
                            <input
                                type="text"
                                placeholder="Buscar nombre o ID…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{
                                    background: 'var(--surface)', border: '1px solid var(--border)',
                                    borderRadius: 8, color: 'var(--text)', fontSize: 12,
                                    padding: '5px 10px 5px 26px', outline: 'none', width: 180,
                                }}
                            />
                        </div>
                        {/* Node filter */}
                        <select
                            value={nodeFilter}
                            onChange={e => setNodeFilter(e.target.value)}
                            style={{
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 8, color: 'var(--text)', fontSize: 12,
                                padding: '5px 10px', outline: 'none',
                            }}
                        >
                            <option value="all">Todos los nodos</option>
                            {nodeNames.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        {/* Status filter */}
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            style={{
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 8, color: 'var(--text)', fontSize: 12,
                                padding: '5px 10px', outline: 'none',
                            }}
                        >
                            <option value="all">Todos los estados</option>
                            <option value="running">Ejecutando</option>
                            <option value="stopped">Paradas</option>
                        </select>
                    </div>
                </div>

                <div className="card" style={{ padding: 0 }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                {[
                                    { col: 'vmid',   label: 'ID' },
                                    { col: 'node',   label: 'Nodo' },
                                    { col: 'type',   label: 'Tipo' },
                                    { col: 'name',   label: 'Nombre' },
                                    { col: 'cpu',    label: 'CPU%' },
                                    { col: 'mem',    label: 'RAM' },
                                    { col: 'status', label: 'Estado' },
                                ].map(({ col, label }) => (
                                    <th
                                        key={col}
                                        onClick={() => toggleSort(col)}
                                        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                                    >
                                        {label}<SortIcon col={col} />
                                    </th>
                                ))}
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredVms.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px 0' }}>
                                        Sin resultados
                                    </td>
                                </tr>
                            ) : filteredVms.map((vm: any) => {
                                const isRunning = vm.status === 'running'
                                const cpuPct = vm.cpu ?? 0
                                const isLoading = vmActions[vm.vmid]
                                const consoleUrl = pveUrl
                                    ? `${pveUrl.replace(/\/$/, '')}/#v1:0:18:4:::::::`
                                    : null
                                return (
                                    <tr key={`${vm.node}-${vm.vmid}`}>
                                        {/* ID */}
                                        <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                            {vm.vmid}
                                        </td>
                                        {/* Nodo */}
                                        <td style={{ color: 'var(--accent4)', fontSize: 11 }}>{vm.node}</td>
                                        {/* Tipo */}
                                        <td>
                                            <span className={`type-badge ${vm.type === 'lxc' ? 'type-lxc' : 'type-vm'}`}>
                                                {vm.type?.toUpperCase() ?? 'VM'}
                                            </span>
                                        </td>
                                        {/* Nombre */}
                                        <td style={{ color: 'var(--text)', fontWeight: 500 }}>{vm.name ?? '—'}</td>
                                        {/* CPU% */}
                                        <td style={{ minWidth: 90 }}>
                                            {isRunning ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <div className="prog-bar" style={{ flex: 1, height: 5 }}>
                                                        <div
                                                            className={`prog-fill ${cpuPct > 80 ? 'prog-red' : cpuPct > 50 ? 'prog-yellow' : 'prog-green'}`}
                                                            style={{ width: `${Math.min(cpuPct, 100)}%` }}
                                                        />
                                                    </div>
                                                    <span style={{
                                                        fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
                                                        color: cpuPct > 80 ? '#fc8181' : cpuPct > 50 ? '#fbd38d' : '#68d391',
                                                        flexShrink: 0, minWidth: 34, textAlign: 'right',
                                                    }}>
                                                        {cpuPct.toFixed(1)}%
                                                    </span>
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                                            )}
                                        </td>
                                        {/* RAM */}
                                        <td style={{ color: '#63b3ed', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                            {vm.maxmem ? fmtBytes(vm.maxmem) : '—'}
                                        </td>
                                        {/* Estado */}
                                        <td>
                                            <span className={`pill ${isRunning ? 'pill-green' : 'pill-red'}`}>
                                                <span className={`dot ${isRunning ? 'dot-green' : 'dot-red'}`} />
                                                {isRunning ? 'Ejecutando' : 'Parada'}
                                            </span>
                                        </td>
                                        {/* Acciones */}
                                        <td>
                                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                {isLoading ? (
                                                    <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 13, color: 'var(--muted)' }} />
                                                ) : (
                                                    <>
                                                        {/* Console */}
                                                        {consoleUrl && (
                                                            <a
                                                                href={consoleUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                title="Consola"
                                                                style={{
                                                                    background: 'rgba(99,179,237,0.12)', color: '#63b3ed',
                                                                    border: '1px solid rgba(99,179,237,0.25)',
                                                                    borderRadius: 6, padding: '3px 7px', fontSize: 11,
                                                                    cursor: 'pointer', textDecoration: 'none',
                                                                    display: 'inline-flex', alignItems: 'center',
                                                                }}
                                                            >
                                                                <i className="fa-solid fa-desktop" />
                                                            </a>
                                                        )}
                                                        {/* Start (only if stopped) */}
                                                        {!isRunning && (
                                                            <button
                                                                title="Iniciar"
                                                                onClick={() => handleVmAction(vm, 'start')}
                                                                style={{
                                                                    background: 'rgba(104,211,145,0.12)', color: '#68d391',
                                                                    border: '1px solid rgba(104,211,145,0.25)',
                                                                    borderRadius: 6, padding: '3px 7px', fontSize: 11,
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                <i className="fa-solid fa-play" />
                                                            </button>
                                                        )}
                                                        {/* Shutdown (only if running) */}
                                                        {isRunning && (
                                                            <button
                                                                title="Apagar"
                                                                onClick={() => handleVmAction(vm, 'shutdown')}
                                                                style={{
                                                                    background: 'rgba(251,211,141,0.12)', color: '#fbd38d',
                                                                    border: '1px solid rgba(251,211,141,0.25)',
                                                                    borderRadius: 6, padding: '3px 7px', fontSize: 11,
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                <i className="fa-solid fa-power-off" />
                                                            </button>
                                                        )}
                                                        {/* Force stop (only if running) */}
                                                        {isRunning && (
                                                            <button
                                                                title="Forzar parada"
                                                                onClick={() => handleVmAction(vm, 'stop')}
                                                                style={{
                                                                    background: 'rgba(252,129,129,0.12)', color: '#fc8181',
                                                                    border: '1px solid rgba(252,129,129,0.25)',
                                                                    borderRadius: 6, padding: '3px 7px', fontSize: 11,
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                <i className="fa-solid fa-stop" />
                                                            </button>
                                                        )}
                                                        {/* Reboot (only if running) */}
                                                        {isRunning && (
                                                            <button
                                                                title="Reiniciar"
                                                                onClick={() => handleVmAction(vm, 'reboot')}
                                                                style={{
                                                                    background: 'rgba(99,179,237,0.12)', color: '#63b3ed',
                                                                    border: '1px solid rgba(99,179,237,0.25)',
                                                                    borderRadius: 6, padding: '3px 7px', fontSize: 11,
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                <i className="fa-solid fa-rotate-right" />
                                                            </button>
                                                        )}
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
            </div>

            {/* ── Templates section (collapsible) ── */}
            {templates.length > 0 && (
                <details style={{ marginBottom: 32 }}>
                    <summary style={{ cursor: 'pointer', listStyle: 'none', outline: 'none' }}>
                        <div className="sec-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <i className="fa-solid fa-copy" /> Templates
                            <span style={{
                                fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 8,
                                background: 'rgba(183,148,244,0.15)', color: '#b794f4',
                                border: '1px solid rgba(183,148,244,0.3)',
                            }}>
                                {templates.length}
                            </span>
                        </div>
                    </summary>
                    <div style={{ marginTop: 12 }}>
                        <div className="card" style={{ padding: 0, opacity: 0.75 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Nodo</th>
                                        <th>Tipo</th>
                                        <th>Nombre</th>
                                        <th>RAM</th>
                                        <th>Disco</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {templates.map((vm: any) => (
                                        <tr key={`tpl-${vm.node}-${vm.vmid}`}>
                                            <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{vm.vmid}</td>
                                            <td style={{ color: 'var(--accent4)', fontSize: 11 }}>{vm.node}</td>
                                            <td>
                                                <span className={`type-badge ${vm.type === 'lxc' ? 'type-lxc' : 'type-vm'}`}>
                                                    {vm.type?.toUpperCase() ?? 'VM'}
                                                </span>
                                            </td>
                                            <td style={{ color: 'var(--text)' }}>{vm.name ?? '—'}</td>
                                            <td style={{ color: '#63b3ed', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                {vm.maxmem ? fmtBytes(vm.maxmem) : '—'}
                                            </td>
                                            <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                                                {vm.maxdisk ? fmtBytes(vm.maxdisk) : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </details>
            )}
        </div>
    )
}
