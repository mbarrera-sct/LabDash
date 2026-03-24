import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'

interface Port {
    idx: number
    name: string
    descr: string
    alias: string
    up: boolean
    in_kbps: number
    out_kbps: number
    speed_mbps: number
    in_errors: number
    out_errors: number
    in_discards: number
    out_discards: number
    target: string
}

interface SystemInfo {
    name?: string
    descr?: string
    location?: string
    uptime?: string
}

interface SwitchData {
    ports: Port[]
    targets: string[]
    systems: Record<string, SystemInfo>
    error: string | null
}

function fmtKbps(kbps: number): string {
    if (kbps === 0) return '—'
    if (kbps < 1024) return `${kbps.toFixed(1)} KB/s`
    return `${(kbps / 1024).toFixed(2)} MB/s`
}

function fmtUptime(centiseconds: string | undefined): string {
    if (!centiseconds) return '—'
    const cs = parseInt(centiseconds, 10)
    if (isNaN(cs)) return centiseconds
    const totalSecs = Math.floor(cs / 100)
    const days  = Math.floor(totalSecs / 86400)
    const hours = Math.floor((totalSecs % 86400) / 3600)
    const mins  = Math.floor((totalSecs % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
}

function BwBar({ value, max, color }: { value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
            <div style={{
                flex: 1, height: 6, background: 'rgba(255,255,255,0.06)',
                borderRadius: 3, overflow: 'hidden',
            }}>
                <div style={{
                    width: `${pct}%`, height: '100%',
                    background: color, borderRadius: 3, transition: 'width .4s ease',
                }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 70, textAlign: 'right' }}>
                {fmtKbps(value)}
            </span>
        </div>
    )
}

function SystemInfoCard({ target, info }: { target: string; info: SystemInfo }) {
    return (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <i className="fa-solid fa-server" style={{ color: 'var(--accent2)', fontSize: 16 }} />
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                    {info.name || target}
                </span>
                {info.name && info.name !== target && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>({target})</span>
                )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 28px', fontSize: 12, color: 'var(--muted)' }}>
                {info.descr && (
                    <span>
                        <i className="fa-solid fa-info-circle" style={{ marginRight: 5 }} />
                        {info.descr}
                    </span>
                )}
                {info.location && (
                    <span>
                        <i className="fa-solid fa-location-dot" style={{ marginRight: 5 }} />
                        {info.location}
                    </span>
                )}
                {info.uptime && (
                    <span>
                        <i className="fa-solid fa-clock" style={{ marginRight: 5 }} />
                        Uptime: {fmtUptime(info.uptime)}
                    </span>
                )}
            </div>
        </div>
    )
}

export default function SwitchPage() {
    const [data, setData] = useState<SwitchData | null>(null)
    const [loading, setLoading] = useState(true)
    const [filterTarget, setFilterTarget] = useState<string>('all')
    const [hideDown, setHideDown] = useState(false)
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

    const load = useCallback(async () => {
        try {
            const r = await api.snmpInterfaces()
            setData(r as SwitchData)
            setLastUpdate(new Date())
        } catch {
            setData({ ports: [], targets: [], systems: {}, error: 'Error al obtener datos SNMP' })
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
        const t = setInterval(load, 10_000) // SNMP cache is 10s
        return () => clearInterval(t)
    }, [load])

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--muted)' }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 10 }} />
                Cargando datos SNMP…
            </div>
        )
    }

    if (!data || (data.error && data.ports.length === 0)) {
        return (
            <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                <i className="fa-solid fa-network-wired" style={{ fontSize: 32, color: 'var(--muted)', marginBottom: 12 }} />
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                    {data?.error ?? 'SNMP no configurado'}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
                    Configura el host SNMP en Settings → SNMP
                </div>
            </div>
        )
    }

    const targets = data.targets.length > 1 ? ['all', ...data.targets] : data.targets
    const ports = data.ports
        .filter(p => filterTarget === 'all' || p.target === filterTarget)
        .filter(p => !hideDown || p.up)

    const upCount   = ports.filter(p => p.up).length
    const downCount = ports.filter(p => !p.up).length
    const totalIn   = ports.reduce((s, p) => s + p.in_kbps,  0)
    const totalOut  = ports.reduce((s, p) => s + p.out_kbps, 0)
    const maxBw     = Math.max(...ports.map(p => Math.max(p.in_kbps, p.out_kbps)), 1)

    // Determine which targets to show system info cards for
    const visibleTargets = filterTarget === 'all' ? data.targets : [filterTarget]

    // Table headers: add Speed, In Errors, Out Errors columns
    const baseHeaders = ['Estado', 'Puerto', 'Nombre / Alias', 'Velocidad', 'Entrada', 'Salida', 'Errores']
    const headers = baseHeaders.concat(data.targets.length > 1 ? ['Switch'] : [])

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <i className="fa-solid fa-network-wired" style={{ color: 'var(--accent)' }} />
                        Switch / SNMP
                    </h2>
                    {lastUpdate && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            Actualizado: {lastUpdate.toLocaleTimeString()} · auto-refresh 10s
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {targets.length > 1 && targets.map(t => (
                        <button
                            key={t}
                            onClick={() => setFilterTarget(t)}
                            style={{
                                padding: '4px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                                background: filterTarget === t ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${filterTarget === t ? 'var(--accent)' : 'var(--border)'}`,
                                color: filterTarget === t ? '#000' : 'var(--text)',
                            }}
                        >
                            {t === 'all' ? 'Todos' : t}
                        </button>
                    ))}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={hideDown}
                            onChange={e => setHideDown(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        Ocultar puertos caídos
                    </label>
                </div>
            </div>

            {/* System info cards */}
            {visibleTargets.map(t => data.systems?.[t] ? (
                <SystemInfoCard key={t} target={t} info={data.systems[t]} />
            ) : null)}

            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                {[
                    { label: 'Puertos activos', value: upCount,   icon: 'fa-circle-check',     color: '#68d391' },
                    { label: 'Puertos caídos',  value: downCount, icon: 'fa-circle-xmark',     color: '#fc8181' },
                    { label: 'Total entrada',   value: fmtKbps(totalIn),  icon: 'fa-arrow-down', color: 'var(--accent3)' },
                    { label: 'Total salida',    value: fmtKbps(totalOut), icon: 'fa-arrow-up',   color: 'var(--accent)'  },
                ].map(s => (
                    <div key={s.label} className="card" style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className={`fa-solid ${s.icon}`} style={{ color: s.color }} />
                            {s.label}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>
                            {s.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Port table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {data.error && (
                    <div style={{ padding: '10px 16px', background: 'rgba(252,129,129,0.08)', color: '#fc8181', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
                        {data.error}
                    </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {headers.map(h => (
                                    <th key={h} style={{
                                        padding: '10px 16px', textAlign: 'left',
                                        fontSize: 11, color: 'var(--muted)', fontWeight: 600,
                                        textTransform: 'uppercase', letterSpacing: '0.05em',
                                        background: 'rgba(255,255,255,0.02)',
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ports.length === 0 && (
                                <tr>
                                    <td colSpan={headers.length} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                                        No hay puertos que mostrar
                                    </td>
                                </tr>
                            )}
                            {ports.map((p, i) => {
                                const totalErrors = (p.in_errors || 0) + (p.out_errors || 0)
                                const hasErrors = totalErrors > 0
                                return (
                                    <tr
                                        key={`${p.target}-${p.idx}`}
                                        style={{
                                            borderBottom: i < ports.length - 1 ? '1px solid var(--border)' : 'none',
                                            background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                                            opacity: p.up ? 1 : 0.55,
                                        }}
                                    >
                                        {/* Status */}
                                        <td style={{ padding: '10px 16px' }}>
                                            <span className={`pill ${p.up ? 'pill-green' : 'pill-red'}`} style={{ fontSize: 11 }}>
                                                <span className={`dot ${p.up ? 'dot-green' : 'dot-red'}`} />
                                                {p.up ? 'UP' : 'DOWN'}
                                            </span>
                                        </td>
                                        {/* Index / Port name */}
                                        <td style={{ padding: '10px 16px', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>
                                            {p.name || `if${p.idx}`}
                                        </td>
                                        {/* Name / Alias */}
                                        <td style={{ padding: '10px 16px' }}>
                                            <div style={{ fontWeight: 500 }}>{p.alias || p.descr || p.name}</div>
                                            {p.alias && p.descr && p.alias !== p.descr && (
                                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.descr}</div>
                                            )}
                                        </td>
                                        {/* Speed */}
                                        <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                            {p.speed_mbps > 0 ? `${p.speed_mbps} Mbps` : '—'}
                                        </td>
                                        {/* In */}
                                        <td style={{ padding: '10px 16px', minWidth: 160 }}>
                                            {p.up ? (
                                                <BwBar value={p.in_kbps} max={maxBw} color="var(--accent3)" />
                                            ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                                        </td>
                                        {/* Out */}
                                        <td style={{ padding: '10px 16px', minWidth: 160 }}>
                                            {p.up ? (
                                                <BwBar value={p.out_kbps} max={maxBw} color="var(--accent)" />
                                            ) : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}
                                        </td>
                                        {/* Errors */}
                                        <td style={{ padding: '10px 16px', fontSize: 12, whiteSpace: 'nowrap' }}>
                                            {hasErrors ? (
                                                <span style={{ color: '#fbd38d', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: 11 }} />
                                                    {totalErrors}
                                                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                                                        ({p.in_errors}↓ {p.out_errors}↑)
                                                    </span>
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--muted)' }}>—</span>
                                            )}
                                        </td>
                                        {/* Target (multi-switch only) */}
                                        {data.targets.length > 1 && (
                                            <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted)' }}>
                                                {p.target}
                                            </td>
                                        )}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
