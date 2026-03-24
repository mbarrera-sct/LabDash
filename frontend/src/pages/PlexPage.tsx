import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

const TYPE_ICON: Record<string, string> = {
    movie: 'fa-film', show: 'fa-tv', music: 'fa-music', photo: 'fa-image',
}
const TYPE_LABEL: Record<string, string> = {
    movie: 'Películas', show: 'Series', music: 'Música', photo: 'Fotos',
}

export default function PlexPage({ onToast: _onToast }: Props) {
    const [data, setData] = useState<any>(null)
    const [err,  setErr]  = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        try {
            const r = await api.plexInfo()
            if (r.error) { setErr(r.error); setData(r.data || null) }
            else { setData(r.data); setErr(null) }
        } catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

    if (loading) return <div style={{ color: 'var(--muted)', padding: 32 }}>Cargando...</div>
    if (err && !data) return (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <i className="fa-solid fa-film" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            <div>{err}</div>
        </div>
    )

    const sessions: any[] = data?.session_details ?? []
    const libraries: any[] = data?.libraries ?? []
    const totalItems = libraries.reduce((a: number, l: any) => a + (l.count || 0), 0)

    return (
        <div>
            {/* Header card */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                    <div className="card-icon icon-yellow"><i className="fa-solid fa-film" /></div>
                    <div>
                        <div className="card-title">{data?.server_name ?? 'Plex Media Server'}</div>
                        <div className="card-sub">{data?.platform} · v{data?.version}</div>
                    </div>
                    <span className="pill pill-green" style={{ marginLeft: 'auto' }}>
                        <span className="dot dot-green" /> Online
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 32, marginTop: 12, flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent4)' }}>{totalItems.toLocaleString()}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Total items</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: (data?.sessions ?? 0) ? '#68d391' : 'var(--muted)' }}>{data?.sessions ?? 0}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Sesiones activas</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{libraries.length}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Bibliotecas</div>
                    </div>
                </div>
            </div>

            <div className="g2">
                {/* Libraries */}
                <div className="card">
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Bibliotecas</div>
                    {libraries.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sin bibliotecas</div>}
                    {libraries.map((lib: any) => (
                        <div key={lib.key} className="kv-row">
                            <span className="kv-key">
                                <i className={`fa-solid ${TYPE_ICON[lib.type] ?? 'fa-folder'}`} style={{ marginRight: 8, color: 'var(--accent4)', width: 14 }} />
                                {lib.title}
                                <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>({TYPE_LABEL[lib.type] ?? lib.type})</span>
                            </span>
                            <span className="kv-val val-yellow">{(lib.count || 0).toLocaleString()}</span>
                        </div>
                    ))}
                </div>

                {/* Active sessions */}
                <div className="card">
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                        Sesiones activas ({sessions.length})
                    </div>
                    {sessions.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                            <i className="fa-solid fa-moon" style={{ display: 'block', marginBottom: 8 }} />
                            Sin reproducción activa
                        </div>
                    )}
                    {sessions.map((s: any, i: number) => (
                        <div key={i} style={{
                            background: 'rgba(255,255,255,0.03)', borderRadius: 8,
                            padding: '10px 12px', marginBottom: 8,
                            border: '1px solid var(--border)',
                        }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{s.title ?? s.grandparentTitle ?? '—'}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {s.user && <span>{s.user} · </span>}
                                {s.player && <span>{s.player}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
