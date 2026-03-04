import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

function fmtBytes(b: number) {
    if (!b) return '—'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0; let n = b
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(1)} ${u[i]}`
}

function fmtUptime(s: number) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
    return d > 0 ? `${d}d ${h}h` : `${h}h`
}

export default function Dashboard({ onToast }: Props) {
    const [status, setStatus] = useState<any>(null)
    const [pvNodes, setPvNodes] = useState<any>(null)
    const [pvVMs, setPvVMs] = useState<any>(null)
    const [gways, setGways] = useState<any>(null)
    const [k8sN, setK8sN] = useState<any>(null)
    const [k8sW, setK8sW] = useState<any>(null)
    const [unraid, setUnraid] = useState<any>(null)
    const [plex, setPlex] = useState<any>(null)
    const [immich, setImmich] = useState<any>(null)
    const [ha, setHa] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        try {
            const results = await Promise.allSettled([
                api.status(), api.proxmoxNodes(), api.proxmoxVMs(),
                api.opnsenseGateways(), api.k8sNodes(), api.k8sWorkloads(),
                api.unraidSystem(), api.plexInfo(), api.immichStats(), api.haStates(),
            ])
            const [s, n, v, g, k, kw, ur, pl, im, haR] = results
            if (s.status === 'fulfilled') setStatus(s.value)
            if (n.status === 'fulfilled') setPvNodes(n.value as any)
            if (v.status === 'fulfilled') setPvVMs(v.value as any)
            if (g.status === 'fulfilled') setGways(g.value as any)
            if (k.status === 'fulfilled') setK8sN(k.value as any)
            if (kw.status === 'fulfilled') setK8sW(kw.value as any)
            if (ur.status === 'fulfilled') setUnraid(ur.value as any)
            if (pl.status === 'fulfilled') setPlex(pl.value as any)
            if (im.status === 'fulfilled') setImmich(im.value as any)
            if (haR.status === 'fulfilled') setHa(haR.value as any)
        } finally { setLoading(false) }
    }, [])

    useEffect(() => {
        load()
        const t = setInterval(load, 30000)
        return () => clearInterval(t)
    }, [load])

    const s = status as any
    const nodes = pvNodes?.nodes ?? []
    const byNode = pvVMs?.by_node ?? {}
    const gateways = gways?.data?.items ?? []
    const k8sNodes = k8sN?.nodes ?? []
    const k8sNS = k8sW?.namespaces ?? {}
    const haStates = ha?.states ?? []

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--muted)', gap: 12 }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24 }} />
            Cargando datos…
        </div>
    )

    return (
        <div>
            {/* ── Stats bar ── */}
            <div className="g5" style={{ marginBottom: 32 }}>
                {[
                    { label: 'Nodos Proxmox', val: s?.proxmox?.nodes ?? nodes.length, color: 'var(--accent)' },
                    { label: 'Running', val: s?.proxmox?.running ?? '—', color: 'var(--accent2)' },
                    { label: 'VMs/LXC Total', val: s?.proxmox?.vms_total ?? '—', color: 'var(--accent4)' },
                    { label: 'Templates', val: s?.proxmox?.templates ?? '—', color: 'var(--accent5)' },
                    { label: 'K8s Nodes', val: k8sNodes.length || s?.k8s?.nodes || '—', color: 'var(--accent6)' },
                    { label: 'WAN Links', val: s?.opnsense?.gateways ?? '—', color: 'var(--accent3)' },
                ].map(c => (
                    <div key={c.label} className="stat-card">
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
                        return (
                            <div key={i} className="card">
                                <div className="card-header">
                                    <div className={`card-icon ${up ? 'icon-green' : 'icon-red'}`}>
                                        <i className="fa-solid fa-tower-broadcast" />
                                    </div>
                                    <div>
                                        <div className="card-title">{gw.name}</div>
                                        <div className="card-sub">{gw.gwaddr ?? ''}</div>
                                    </div>
                                    <span className={`pill ${up ? 'pill-green' : 'pill-red'}`} style={{ marginLeft: 'auto' }}>
                                        <span className={`dot ${up ? 'dot-green' : 'dot-red'}`} /> {up ? 'Online' : 'Offline'}
                                    </span>
                                </div>
                                <div className="kv-row"><span className="kv-key">RTT</span><span className="kv-val val-blue">{gw.delay ?? '—'}</span></div>
                                <div className="kv-row"><span className="kv-key">Packet loss</span><span className="kv-val val-yellow">{gw.loss ?? '—'}</span></div>
                            </div>
                        )
                    })}
                </div>
            </>}

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

                {/* K8s workloads summary */}
                {Object.keys(k8sNS).length > 0 && (
                    <div className="card" style={{ marginBottom: 32, padding: '14px 0' }}>
                        <table className="data-table">
                            <thead>
                                <tr><th>Namespace</th><th>Deployments</th><th>Pods</th><th>Running</th></tr>
                            </thead>
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
                    <i className="fa-solid fa-triangle-exclamation" />
                    Proxmox: {pvVMs.error}
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
                    {!plex?.data && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Configura Plex en Settings para ver los datos de las librerías</div>}
                </div>

                {/* Immich */}
                <div className="card">
                    <div className="card-header">
                        <div className="card-icon icon-purple"><i className="fa-solid fa-images" /></div>
                        <div>
                            <div className="card-title">Immich</div>
                            <div className="card-sub">Galería fotográfica</div>
                        </div>
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
                        <div>
                            <div className="card-title">Unraid / NAS</div>
                            <div className="card-sub">{unraid?.data?.version ?? 'Sin datos'}</div>
                        </div>
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
                        <div>
                            <div className="card-title">Home Assistant</div>
                            <div className="card-sub">{haStates.length} entidades</div>
                        </div>
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
