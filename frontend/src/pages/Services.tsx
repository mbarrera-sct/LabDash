import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

function fmtBytes(b: number) {
    if (!b) return '—'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let n = b
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(1)} ${u[i]}`
}

export default function Services({ onToast }: Props) {
    const [plex, setPlex] = useState<any>(null)
    const [immich, setImmich] = useState<any>(null)
    const [ha, setHa] = useState<any>(null)
    const [unraid, setUnraid] = useState<any>(null)
    const [docker, setDocker] = useState<any[]>([])
    const [k8sWork, setK8sWork] = useState<any>(null)

    const load = useCallback(async () => {
        const results = await Promise.allSettled([
            api.plexInfo(), api.immichStats(), api.haStates(),
            api.unraidSystem(), api.unraidDocker(), api.k8sWorkloads(),
        ])
        if (results[0].status === 'fulfilled') setPlex((results[0] as any).value?.data)
        if (results[1].status === 'fulfilled') setImmich((results[1] as any).value?.data)
        if (results[2].status === 'fulfilled') setHa((results[2] as any).value?.states ?? [])
        if (results[3].status === 'fulfilled') setUnraid((results[3] as any).value?.data)
        if (results[4].status === 'fulfilled') setDocker((results[4] as any).value?.containers ?? [])
        if (results[5].status === 'fulfilled') setK8sWork((results[5] as any).value?.namespaces)
    }, [])

    useEffect(() => {
        load()
        const t = setInterval(load, 60000)
        return () => clearInterval(t)
    }, [load])

    const haStates = Array.isArray(ha) ? ha : []
    const unraidInfo = unraid?.info
    const mem = unraidInfo?.memory
    const memPct = mem ? Math.round(mem.used / mem.total * 100) : 0

    return (
        <div>
            <div className="g2">
                {/* ── Plex ── */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-yellow"><i className="fa-solid fa-film" /></div>
                        <div>
                            <div className="card-title">Plex Media Server</div>
                            <div className="card-sub">{plex?.server_name ?? 'No conectado'}</div>
                        </div>
                        <span className={`pill ${plex ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${plex ? 'dot-green' : 'dot-red'}`} />
                            {plex ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {plex ? <>
                        <div className="kv-row"><span className="kv-key">Versión</span><span className="kv-val val-yellow">{plex.version}</span></div>
                        <div className="kv-row"><span className="kv-key">Plataforma</span><span className="kv-val">{plex.platform}</span></div>
                        {(plex.libraries ?? []).map((l: any) => (
                            <div key={l.title} className="kv-row">
                                <span className="kv-key">{l.title} ({l.type})</span>
                                <span className="kv-val val-blue">{l.count} items</span>
                            </div>
                        ))}
                    </> : (
                        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Configura Plex URL y token en Settings →</p>
                    )}
                </div>

                {/* ── Immich ── */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-blue"><i className="fa-solid fa-images" /></div>
                        <div>
                            <div className="card-title">Immich</div>
                            <div className="card-sub">Galería de fotos</div>
                        </div>
                        <span className={`pill ${immich ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${immich ? 'dot-green' : 'dot-red'}`} />
                            {immich ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {immich ? <>
                        <div className="kv-row"><span className="kv-key">Fotos</span><span className="kv-val val-blue">{immich.photos?.toLocaleString() ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Vídeos</span><span className="kv-val val-blue">{immich.videos?.toLocaleString() ?? '—'}</span></div>
                        <div className="kv-row"><span className="kv-key">Storage</span><span className="kv-val val-green">{fmtBytes(immich.usage)}</span></div>
                        <div className="kv-row"><span className="kv-key">Usuarios</span><span className="kv-val">{immich.usageByUser?.length ?? '—'}</span></div>
                    </> : (
                        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Configura Immich URL y API key en Settings →</p>
                    )}
                </div>

                {/* ── Unraid ── */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-yellow"><i className="fa-solid fa-server" /></div>
                        <div>
                            <div className="card-title">Unraid</div>
                            <div className="card-sub">{unraidInfo?.os?.platform ?? 'No conectado'}</div>
                        </div>
                        <span className={`pill ${unraidInfo ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${unraidInfo ? 'dot-green' : 'dot-red'}`} />
                            {unraidInfo ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {unraidInfo ? <>
                        <div className="kv-row"><span className="kv-key">Versión</span><span className="kv-val val-yellow">{unraidInfo.os?.version}</span></div>
                        <div className="kv-row"><span className="kv-key">CPU</span><span className="kv-val val-yellow">{unraidInfo.cpu?.brand}</span></div>
                        <div className="kv-row"><span className="kv-key">CPU uso</span><span className="kv-val val-yellow">{unraidInfo.cpu?.usage?.toFixed(1)}%</span></div>
                        <div className="kv-row"><span className="kv-key">RAM</span><span className="kv-val val-green">{memPct}% ({fmtBytes(mem?.used)} / {fmtBytes(mem?.total)})</span></div>
                        <div className="prog-bar"><div className={`prog-fill ${memPct > 85 ? 'prog-red' : memPct > 65 ? 'prog-yellow' : 'prog-green'}`} style={{ width: `${memPct}%` }} /></div>
                        {(unraid?.array?.status) && (
                            <div className="kv-row" style={{ marginTop: 8 }}>
                                <span className="kv-key">Array</span>
                                <span className={`pill ${unraid.array.status === 'Started' ? 'pill-green' : 'pill-yellow'}`}>
                                    {unraid.array.status}
                                </span>
                            </div>
                        )}
                        {docker.length > 0 && (
                            <div style={{ marginTop: 14 }}>
                                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Docker ({docker.length})</div>
                                {docker.slice(0, 10).map((c: any, i: number) => {
                                    const up = c.state === 'running'
                                    return (
                                        <div key={i} className="kv-row">
                                            <span className="kv-key">{(c.names?.[0] ?? c.image ?? '').replace('/', '')}</span>
                                            <span className={`pill ${up ? 'pill-green' : 'pill-yellow'}`}>
                                                <span className={`dot ${up ? 'dot-green' : 'dot-yellow'}`} style={{ width: 5, height: 5 }} />
                                                {c.state}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </> : (
                        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Configura Unraid URL y API key en Settings →</p>
                    )}
                </div>

                {/* ── Home Assistant ── */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-teal"><i className="fa-solid fa-house-signal" /></div>
                        <div>
                            <div className="card-title">Home Assistant</div>
                            <div className="card-sub">Estados de entidades</div>
                        </div>
                        <span className={`pill ${haStates.length > 0 ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                            <span className={`dot ${haStates.length > 0 ? 'dot-green' : 'dot-red'}`} />
                            {haStates.length > 0 ? 'Online' : 'Offline'}
                        </span>
                    </div>
                    {haStates.length > 0 ? (
                        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                            {haStates.map((s: any) => {
                                const domain = s.entity_id?.split('.')[0]
                                const icon =
                                    domain === 'person' ? 'fa-person' :
                                        domain === 'device_tracker' ? 'fa-mobile-screen' :
                                            domain === 'media_player' ? 'fa-music' :
                                                domain === 'binary_sensor' ? 'fa-circle-dot' :
                                                    domain === 'sensor' ? 'fa-chart-line' : 'fa-toggle-on'
                                const isOn = ['on', 'home', 'playing'].includes(s.state?.toLowerCase())
                                return (
                                    <div key={s.entity_id} className="kv-row">
                                        <span className="kv-key" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <i className={`fa-solid ${icon}`} style={{ color: 'var(--accent6)', fontSize: 11 }} />
                                            {s.attributes?.friendly_name ?? s.entity_id}
                                        </span>
                                        <span className={`kv-val ${isOn ? 'val-green' : ''}`}>{s.state}</span>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Configura HA URL y token en Settings →</p>
                    )}
                </div>

                {/* ── K8s Workloads ── */}
                {k8sWork && Object.keys(k8sWork).length > 0 && (
                    <div className="card" style={{ gridColumn: '1/-1' }}>
                        <div className="card-header">
                            <div className="card-icon icon-green"><i className="fa-solid fa-dharmachakra" /></div>
                            <div><div className="card-title">Kubernetes — Workloads</div></div>
                        </div>
                        {Object.entries(k8sWork).map(([ns, info]: [string, any]) => (
                            <div key={ns} style={{ marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent5)', marginBottom: 8 }}>
                                    <i className="fa-solid fa-layer-group" style={{ marginRight: 6 }} />ns: {ns}
                                    <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 12 }}>
                                        pods {info.running_pods}/{info.pod_count}
                                    </span>
                                </div>
                                {(info.deployments ?? []).map((d: any) => (
                                    <div key={d.name} className="kv-row">
                                        <span className="kv-key">{d.name}</span>
                                        <span className={`pill ${d.ready === d.desired ? 'pill-green' : 'pill-yellow'}`}>
                                            {d.ready}/{d.desired} ready
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
