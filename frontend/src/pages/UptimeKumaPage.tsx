import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

export default function UptimeKumaPage({ onToast: _onToast }: Props) {
    const [data, setData]     = useState<any>(null)
    const [err,  setErr]      = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch]   = useState('')

    const load = useCallback(async () => {
        try {
            const r = await api.uptimeKumaMonitors()
            if (r.error && !r.data?.monitors?.length) { setErr(r.error); setData(null) }
            else { setData(r.data); setErr(r.error || null) }
        } catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

    if (loading) return <div style={{ color: 'var(--muted)', padding: 32 }}>Cargando...</div>
    if (err && !data) return (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <i className="fa-solid fa-heart-pulse" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            <div>{err}</div>
        </div>
    )

    const monitors: any[] = data?.monitors ?? []
    const filtered = search
        ? monitors.filter((m: any) => m.name?.toLowerCase().includes(search.toLowerCase()))
        : monitors
    const up   = monitors.filter((m: any) => m.status === 1).length
    const down = monitors.length - up

    return (
        <div>
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                    <div className="card-icon" style={{ background: 'rgba(104,211,145,0.15)', color: '#68d391' }}>
                        <i className="fa-solid fa-heart-pulse" />
                    </div>
                    <div>
                        <div className="card-title">Uptime Kuma</div>
                        <div className="card-sub">{monitors.length} monitores</div>
                    </div>
                    <span className="pill pill-green" style={{ marginLeft: 'auto' }}>
                        <span className="dot dot-green" /> Online
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 32, marginTop: 12 }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: '#68d391' }}>{up}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Online</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: down ? '#fc8181' : 'var(--muted)' }}>{down}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Offline</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>
                            {monitors.length ? Math.round(up / monitors.length * 100) : 0}%
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Disponibilidad</div>
                    </div>
                </div>
            </div>

            {/* Down monitors first */}
            {down > 0 && (
                <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(252,129,129,0.3)', background: 'rgba(252,129,129,0.04)' }}>
                    <div style={{ fontSize: 10, color: '#fc8181', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
                        Caídos ({down})
                    </div>
                    {monitors.filter((m: any) => m.status !== 1).map((m: any) => (
                        <div key={m.id} className="kv-row">
                            <span className="kv-key"><span className="dot dot-red" style={{ marginRight: 8 }} />{m.name}</span>
                            <span style={{ color: '#fc8181', fontSize: 12 }}>{m.msg || 'Offline'}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* All monitors */}
            <div className="card">
                <input
                    type="text"
                    placeholder="Buscar monitor..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                        width: '100%', padding: '7px 12px', borderRadius: 8, marginBottom: 14,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                        color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
                    }}
                />
                {filtered.map((m: any) => {
                    const up24 = m.uptime_24h ?? 0
                    const isUp = m.status === 1
                    return (
                        <div key={m.id} className="kv-row">
                            <span className="kv-key" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className={`dot ${isUp ? 'dot-green' : 'dot-red'}`} />
                                {m.name}
                                {m.ping != null && (
                                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{m.ping}ms</span>
                                )}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{
                                    fontSize: 12, fontWeight: 600,
                                    color: up24 >= 99 ? '#68d391' : up24 >= 95 ? '#fbd38d' : '#fc8181',
                                }}>
                                    {up24}% 24h
                                </span>
                                <span style={{ fontSize: 12, color: isUp ? '#68d391' : '#fc8181', fontWeight: 500 }}>
                                    {isUp ? 'Online' : 'Offline'}
                                </span>
                            </span>
                        </div>
                    )
                })}
                {filtered.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Sin resultados</div>}
            </div>
        </div>
    )
}
