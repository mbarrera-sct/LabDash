import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

function fmtBytes(b: number) {
    if (!b) return '0 B'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0; let n = b
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

export default function ImmichPage({ onToast: _onToast }: Props) {
    const [data, setData] = useState<any>(null)
    const [err,  setErr]  = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        try {
            const r = await api.immichStats()
            if (r.error) { setErr(r.error); setData(r.data || null) }
            else { setData(r.data); setErr(null) }
        } catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])

    useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])

    if (loading) return <div style={{ color: 'var(--muted)', padding: 32 }}>Cargando...</div>
    if (err && !data) return (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <i className="fa-solid fa-images" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            <div>{err}</div>
        </div>
    )

    const users: any[] = data?.usageByUser ?? []
    // Per-user storage bytes — Immich 1.x uses "usage", older versions "diskUsageRaw"/"diskUsage"
    const userBytes = (u: any): number => {
        const candidates = [u.usage, u.diskUsageRaw, u.quotaUsageInBytes, u.diskUsage]
        for (const v of candidates) {
            if (typeof v === 'number' && v > 0) return v
            if (typeof v === 'string') { const n = parseInt(v, 10); if (n > 0) return n }
        }
        return 0
    }
    // Use the API's own `usage` field (total bytes) — more reliable than summing per-user
    const totalUsage = (data?.usage ?? 0) || users.reduce((a: number, u: any) => a + userBytes(u), 0)

    return (
        <div>
            {/* Header */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                    <div className="card-icon icon-purple"><i className="fa-solid fa-images" /></div>
                    <div>
                        <div className="card-title">Immich</div>
                        <div className="card-sub">Galería fotográfica</div>
                    </div>
                    <span className="pill pill-green" style={{ marginLeft: 'auto' }}>
                        <span className="dot dot-green" /> Online
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 32, marginTop: 12, flexWrap: 'wrap' }}>
                    {[
                        { val: (data?.photos ?? 0).toLocaleString(), label: 'Fotos',   color: 'var(--accent5)' },
                        { val: (data?.videos ?? 0).toLocaleString(), label: 'Vídeos',  color: 'var(--accent2)' },
                        { val: fmtBytes(totalUsage),                 label: 'Storage', color: 'var(--accent)'  },
                        { val: users.length,                         label: 'Usuarios', color: 'var(--muted)'  },
                    ].map(({ val, label, color }) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 26, fontWeight: 700, color }}>{val}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Per-user breakdown */}
            <div className="card">
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
                    Uso por usuario
                </div>
                {users.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sin datos de usuarios</div>}
                {users.map((u: any) => {
                    const ub  = userBytes(u)
                    const hasStorage = ub > 0
                    const pct = hasStorage && totalUsage > 0 ? Math.round(ub / totalUsage * 100) : 0
                    return (
                        <div key={u.userId} style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                                <span style={{ fontWeight: 500 }}>{u.userName || u.userEmail || u.userId}</span>
                                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                                    {(u.photos ?? 0).toLocaleString()} fotos · {(u.videos ?? 0).toLocaleString()} vídeos
                                    {hasStorage && <> · {fmtBytes(ub)}</>}
                                </span>
                            </div>
                            {hasStorage ? (
                                <>
                                    <div className="prog-bar">
                                        <div className="prog-fill prog-green" style={{ width: `${pct}%` }} />
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{pct}% del total</div>
                                </>
                            ) : (
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Almacenamiento no disponible</div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
