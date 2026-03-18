import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { fmtBytes, fmtUptime } from '../utils/fmt'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

export default function UnraidPage({ onToast: _onToast }: Props) {
    const [system,   setSystem]   = useState<any>(null)
    const [disks,    setDisks]    = useState<any>(null)
    const [docker,   setDocker]   = useState<any[]>([])
    const [loading,  setLoading]  = useState(true)
    const [diskSearch, setDiskSearch] = useState('')

    const load = useCallback(async () => {
        try {
            const [sysRes, diskRes, dockerRes] = await Promise.allSettled([
                api.unraidSystem(),
                api.unraidDisks(),
                api.unraidDocker(),
            ])
            if (sysRes.status    === 'fulfilled') setSystem((sysRes.value as any).data ?? null)
            if (diskRes.status   === 'fulfilled') setDisks(diskRes.value as any)
            if (dockerRes.status === 'fulfilled') setDocker((dockerRes.value as any).containers ?? [])
        } finally { setLoading(false) }
    }, [])

    useEffect(() => {
        load()
        const t = setInterval(load, 30000)
        return () => clearInterval(t)
    }, [load])

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24 }} />
            Cargando datos de Unraid…
        </div>
    )

    if (!system && !disks?.status) return (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <i className="fa-solid fa-hard-drive" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            Sin datos de Unraid. Configura las credenciales en Settings.
        </div>
    )

    const arrayStatus   = disks?.status ?? '—'
    const capacity      = disks?.capacity ?? {}
    const allDisks: any[]  = disks?.disks ?? []
    const parities: any[]  = disks?.parities ?? []
    const usedBytes     = capacity.used ?? 0
    const totalBytes    = capacity.total ?? 0
    const freePct       = totalBytes ? Math.round((1 - usedBytes / totalBytes) * 100) : 0
    const usedPct       = 100 - freePct

    const statusColor = arrayStatus === 'Started' ? '#68d391'
        : arrayStatus === 'Stopped' ? '#fc8181'
        : '#fbd38d'

    const filteredDisks = allDisks.filter(d =>
        !diskSearch || d.name?.toLowerCase().includes(diskSearch.toLowerCase()) ||
        d.device?.toLowerCase().includes(diskSearch.toLowerCase())
    )

    const smartColor = (s: string | null) =>
        !s ? 'var(--muted)' : s === 'PASSED' || s === 'OK' ? '#68d391' : '#fc8181'

    const tempColor = (t: number | null) =>
        t == null ? 'var(--muted)' : t > 50 ? '#fc8181' : t > 40 ? '#fbd38d' : '#68d391'

    return (
        <div>
            {/* ── Summary bar ── */}
            <div className="g5" style={{ marginBottom: 24 }}>
                {[
                    { label: 'Estado array', val: arrayStatus,                color: statusColor,      icon: 'fa-database' },
                    { label: 'Discos',       val: allDisks.length,            color: 'var(--accent)',  icon: 'fa-hard-drive' },
                    { label: 'Paridades',    val: parities.length,            color: 'var(--accent2)', icon: 'fa-shield-halved' },
                    { label: 'Usado',        val: fmtBytes(usedBytes),        color: 'var(--accent4)', icon: 'fa-chart-pie' },
                    { label: 'Libre',        val: fmtBytes(totalBytes - usedBytes), color: 'var(--accent2)', icon: 'fa-circle-check' },
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

            {/* ── Array capacity bar ── */}
            {totalBytes > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                        <span style={{ color: 'var(--muted)' }}>Capacidad del array</span>
                        <span style={{ color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>
                            {fmtBytes(usedBytes)} / {fmtBytes(totalBytes)} · {usedPct}% usado
                        </span>
                    </div>
                    <div className="prog-bar" style={{ height: 10, borderRadius: 5 }}>
                        <div
                            className={`prog-fill ${usedPct > 85 ? 'prog-red' : usedPct > 70 ? 'prog-yellow' : 'prog-green'}`}
                            style={{ width: `${usedPct}%`, borderRadius: 5 }}
                        />
                    </div>
                </div>
            )}

            {/* ── System info ── */}
            {system && (
                <div className="card" style={{ marginBottom: 24 }}>
                    <div className="card-header" style={{ marginBottom: 12 }}>
                        <div className="card-icon icon-blue"><i className="fa-solid fa-circle-info" /></div>
                        <div><div className="card-title">Sistema</div></div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 12 }}>
                        {system.version   && <div><span style={{ color: 'var(--muted)' }}>Versión: </span><span style={{ color: 'var(--accent)', fontWeight: 600 }}>{system.version}</span></div>}
                        {system.uptime    && <div><span style={{ color: 'var(--muted)' }}>Uptime: </span><span style={{ color: 'var(--text)' }}>{fmtUptime(system.uptime)}</span></div>}
                        {system.cpu_model && <div><span style={{ color: 'var(--muted)' }}>CPU: </span><span style={{ color: 'var(--text)' }}>{system.cpu_model}</span></div>}
                        {system.cpu_cores && <div><span style={{ color: 'var(--muted)' }}>Cores: </span><span style={{ color: 'var(--text)' }}>{system.cpu_cores}</span></div>}
                        {system.mem_total && <div><span style={{ color: 'var(--muted)' }}>RAM total: </span><span style={{ color: 'var(--text)' }}>{fmtBytes(system.mem_total)}</span></div>}
                    </div>
                </div>
            )}

            {/* ── Parity disks ── */}
            {parities.length > 0 && (
                <>
                    <div className="sec-title" style={{ marginBottom: 12 }}>
                        <i className="fa-solid fa-shield-halved" /> Discos de paridad
                    </div>
                    <div className="card" style={{ padding: 0, marginBottom: 24 }}>
                        <table className="data-table">
                            <thead>
                                <tr><th>Nombre</th><th>Dispositivo</th><th>Tamaño</th><th>Temp</th><th>SMART</th><th>Errores</th><th>Estado</th></tr>
                            </thead>
                            <tbody>
                                {parities.map((d: any, i: number) => (
                                    <tr key={i}>
                                        <td style={{ color: 'var(--accent4)', fontFamily: 'JetBrains Mono, monospace' }}>{d.name ?? `Paridad ${i + 1}`}</td>
                                        <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{d.device ?? '—'}</td>
                                        <td>{d.size ? fmtBytes(d.size) : '—'}</td>
                                        <td style={{ color: tempColor(d.temp), fontFamily: 'JetBrains Mono, monospace' }}>
                                            {d.temp != null ? `${d.temp}°C` : '—'}
                                        </td>
                                        <td style={{ color: smartColor(d.smart) }}>{d.smart ?? '—'}</td>
                                        <td style={{ color: (d.errors ?? 0) > 0 ? '#fc8181' : 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                                            {d.errors ?? 0}
                                        </td>
                                        <td>
                                            <span style={{
                                                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                                background: d.status === 'DISK_OK' ? 'rgba(104,211,145,.15)' : 'rgba(252,129,129,.15)',
                                                color: d.status === 'DISK_OK' ? '#68d391' : '#fc8181',
                                            }}>{d.status ?? '—'}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* ── Array disks ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div className="sec-title" style={{ margin: 0 }}>
                    <i className="fa-solid fa-hard-drive" /> Discos del array
                </div>
                <input
                    value={diskSearch} onChange={e => setDiskSearch(e.target.value)}
                    placeholder="Buscar disco…"
                    style={{ flex: 1, minWidth: 140, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', color: 'var(--text)', fontSize: 12 }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filteredDisks.length} discos</span>
            </div>
            <div className="card" style={{ padding: 0, marginBottom: 24 }}>
                <table className="data-table">
                    <thead>
                        <tr><th>Slot</th><th>Dispositivo</th><th>Tamaño</th><th>Usado</th><th>Libre</th><th>Temp</th><th>SMART</th><th>Errores</th><th>Estado</th></tr>
                    </thead>
                    <tbody>
                        {filteredDisks.length === 0 ? (
                            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Sin discos</td></tr>
                        ) : filteredDisks.map((d: any, i: number) => {
                            const usedD  = d.used ?? 0
                            const sizeD  = d.size ?? 0
                            const freeD  = sizeD - usedD
                            const pct    = sizeD > 0 ? Math.round(usedD / sizeD * 100) : 0
                            return (
                                <tr key={i}>
                                    <td style={{ color: 'var(--accent4)', fontFamily: 'JetBrains Mono, monospace' }}>{d.name ?? `disk${i + 1}`}</td>
                                    <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{d.device ?? '—'}</td>
                                    <td>{sizeD ? fmtBytes(sizeD) : '—'}</td>
                                    <td>
                                        {usedD > 0 ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                                    <div style={{ width: `${pct}%`, height: '100%', background: pct > 85 ? '#fc8181' : pct > 70 ? '#fbd38d' : '#63b3ed', borderRadius: 2 }} />
                                                </div>
                                                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>{fmtBytes(usedD)}</span>
                                            </div>
                                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                                    </td>
                                    <td style={{ color: 'var(--muted)' }}>{freeD > 0 ? fmtBytes(freeD) : '—'}</td>
                                    <td style={{ color: tempColor(d.temp), fontFamily: 'JetBrains Mono, monospace' }}>
                                        {d.temp != null ? `${d.temp}°C` : '—'}
                                    </td>
                                    <td style={{ color: smartColor(d.smart) }}>{d.smart ?? '—'}</td>
                                    <td style={{ color: (d.errors ?? 0) > 0 ? '#fc8181' : 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                                        {d.errors ?? 0}
                                    </td>
                                    <td>
                                        <span style={{
                                            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                            background: d.status === 'DISK_OK' ? 'rgba(104,211,145,.15)' : d.status === 'DISK_NP' ? 'rgba(150,150,150,.1)' : 'rgba(252,129,129,.15)',
                                            color: d.status === 'DISK_OK' ? '#68d391' : d.status === 'DISK_NP' ? 'var(--muted)' : '#fc8181',
                                        }}>{d.status ?? '—'}</span>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Docker containers ── */}
            {docker.length > 0 && (
                <>
                    <div className="sec-title" style={{ marginBottom: 12 }}>
                        <i className="fa-brands fa-docker" /> Docker ({docker.length} contenedores)
                    </div>
                    <div className="card" style={{ padding: 0, marginBottom: 24 }}>
                        <table className="data-table">
                            <thead>
                                <tr><th>Nombre</th><th>Imagen</th><th>Estado</th><th>Autostart</th></tr>
                            </thead>
                            <tbody>
                                {docker.map((c: any, i: number) => {
                                    const running = c.status === 'running' || c.state === 'started'
                                    return (
                                        <tr key={i}>
                                            <td style={{ color: 'var(--text)', fontWeight: 500 }}>{c.name ?? '—'}</td>
                                            <td style={{ color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{c.image?.split(':')[0] ?? '—'}</td>
                                            <td>
                                                <span style={{
                                                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                                                    background: running ? 'rgba(104,211,145,.15)' : 'rgba(252,129,129,.15)',
                                                    color: running ? '#68d391' : '#fc8181',
                                                }}>
                                                    {running ? '● Running' : '○ Stopped'}
                                                </span>
                                            </td>
                                            <td style={{ color: c.autostart ? '#68d391' : 'var(--muted)', fontSize: 12 }}>
                                                {c.autostart ? '✓' : '—'}
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
    )
}
