import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

export default function PortainerPage({ onToast: _onToast }: Props) {
    const [data, setData]     = useState<any>(null)
    const [err,  setErr]      = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch]   = useState('')
    const [epFilter, setEpFilter] = useState('all')

    const load = useCallback(async () => {
        try {
            const r = await api.portainerData()
            if (r.error && !r.data?.endpoints?.length) { setErr(r.error); setData(null) }
            else { setData(r.data); setErr(r.error || null) }
        } catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

    if (loading) return <div style={{ color: 'var(--muted)', padding: 32 }}>Cargando...</div>
    if (err && !data) return (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <i className="fa-brands fa-docker" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            <div>{err}</div>
        </div>
    )

    const endpoints: any[] = data?.endpoints ?? []
    const stacks: any[]    = data?.stacks    ?? []
    const containers: any[] = data?.containers ?? []

    const filtered = containers.filter((c: any) => {
        if (epFilter !== 'all' && c.endpoint !== epFilter) return false
        if (search) {
            const q = search.toLowerCase()
            return c.name?.toLowerCase().includes(q) || c.image?.toLowerCase().includes(q) || c.endpoint?.toLowerCase().includes(q)
        }
        return true
    })

    const runningCount = filtered.filter((c: any) => c.state === 'running').length

    return (
        <div>
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                    <div className="card-icon" style={{ background: 'rgba(99,179,237,0.15)', color: '#63b3ed' }}>
                        <i className="fa-brands fa-docker" />
                    </div>
                    <div>
                        <div className="card-title">Portainer</div>
                        <div className="card-sub">{endpoints.length} entornos · {stacks.length} stacks</div>
                    </div>
                    <span className="pill pill-green" style={{ marginLeft: 'auto' }}>
                        <span className="dot dot-green" /> Online
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 32, marginTop: 12, flexWrap: 'wrap' }}>
                    {[
                        { val: containers.length, label: 'Contenedores', color: 'var(--accent)' },
                        { val: containers.filter((c: any) => c.state === 'running').length, label: 'Running', color: '#68d391' },
                        { val: containers.filter((c: any) => c.state !== 'running').length, label: 'Stopped', color: 'var(--muted)' },
                        { val: stacks.length, label: 'Stacks', color: 'var(--accent2)' },
                    ].map(({ val, label, color }) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 26, fontWeight: 700, color }}>{val}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Endpoints + Stacks row */}
            <div className="g2" style={{ marginBottom: 20 }}>
                <div className="card">
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Entornos</div>
                    {endpoints.map((ep: any) => (
                        <div key={ep.id} className="kv-row">
                            <span className="kv-key"><i className="fa-solid fa-server" style={{ marginRight: 8, color: 'var(--muted)', width: 14 }} />{ep.name}</span>
                            <span className={`pill ${ep.status === 1 ? 'pill-green' : 'pill-red'}`} style={{ fontSize: 11 }}>
                                <span className={`dot ${ep.status === 1 ? 'dot-green' : 'dot-red'}`} />
                                {ep.status === 1 ? 'Online' : 'Offline'}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="card">
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Stacks</div>
                    {stacks.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sin stacks</div>}
                    {stacks.map((s: any) => (
                        <div key={s.id} className="kv-row">
                            <span className="kv-key"><i className="fa-solid fa-layer-group" style={{ marginRight: 8, color: 'var(--muted)', width: 14 }} />{s.name}</span>
                            <span className={`pill ${s.status === 1 ? 'pill-green' : 'pill-red'}`} style={{ fontSize: 11 }}>
                                <span className={`dot ${s.status === 1 ? 'dot-green' : 'dot-red'}`} />
                                {s.status === 1 ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Container list */}
            <div className="card">
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <input
                        type="text"
                        placeholder="Buscar contenedor o imagen..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{
                            flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                            color: 'var(--text)', fontSize: 13,
                        }}
                    />
                    <select
                        value={epFilter}
                        onChange={e => setEpFilter(e.target.value)}
                        style={{
                            padding: '7px 12px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                            color: 'var(--text)', fontSize: 13,
                        }}
                    >
                        <option value="all">Todos los entornos</option>
                        {endpoints.map((ep: any) => <option key={ep.id} value={ep.name}>{ep.name}</option>)}
                    </select>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{runningCount}/{filtered.length} running</div>
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                    {filtered.map((c: any) => (
                        <div key={c.id} className="kv-row">
                            <span className="kv-key" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className={`dot ${c.state === 'running' ? 'dot-green' : 'dot-red'}`} />
                                <span style={{ fontWeight: 500 }}>{c.name}</span>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.image}</span>
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                                <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 4, marginRight: 6 }}>{c.endpoint}</span>
                                {c.status}
                            </span>
                        </div>
                    ))}
                    {filtered.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Sin resultados</div>}
                </div>
            </div>
        </div>
    )
}
