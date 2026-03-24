import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

const DOMAIN_ICON: Record<string, string> = {
    light: 'fa-lightbulb', switch: 'fa-toggle-on', sensor: 'fa-gauge',
    binary_sensor: 'fa-circle-dot', climate: 'fa-temperature-half',
    media_player: 'fa-play-circle', device_tracker: 'fa-map-pin',
    person: 'fa-person', automation: 'fa-robot', script: 'fa-code',
    scene: 'fa-wand-magic-sparkles', input_boolean: 'fa-toggle-on',
    camera: 'fa-camera', cover: 'fa-window-maximize',
}

const STATE_COLOR: Record<string, string> = {
    on: '#68d391', off: 'var(--muted)', home: '#68d391', not_home: '#fc8181',
    playing: '#68d391', idle: 'var(--muted)', unavailable: '#fc8181',
    open: '#68d391', closed: 'var(--muted)',
}

export default function HomeAssistantPage({ onToast }: Props) {
    const [states, setStates]       = useState<any[]>([])
    const [err, setErr]             = useState<string | null>(null)
    const [loading, setLoading]     = useState(true)
    const [search, setSearch]       = useState('')
    const [domain, setDomain]       = useState('all')

    // Selection mode
    const [selectMode, setSelectMode]   = useState(false)
    const [selected, setSelected]       = useState<Set<string>>(new Set())
    const [saving, setSaving]           = useState(false)
    const [currentFilter, setCurrentFilter] = useState<string>('') // the ha_entities setting value

    const load = useCallback(async () => {
        try {
            const r = await api.haStates()
            if (r.error && !(r.states?.length)) { setErr(r.error); setStates([]) }
            else { setStates(r.states ?? []); setErr(null) }
        } catch (e: any) { setErr(e.message) }
        finally { setLoading(false) }
    }, [])

    // Load current ha_entities filter from settings
    useEffect(() => {
        api.getSettings().then((s: any) => {
            const val: string = s.ha_entities ?? ''
            setCurrentFilter(val)
            if (val.trim()) {
                setSelected(new Set(val.split(',').map((x: string) => x.trim()).filter(Boolean)))
            }
        }).catch(() => {})
    }, [])

    useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

    const domains = useMemo(() => {
        const d = new Set(states.map((s: any) => s.entity_id?.split('.')[0] ?? ''))
        return ['all', ...Array.from(d).sort()]
    }, [states])

    const filtered = useMemo(() => states.filter((s: any) => {
        const dom = s.entity_id?.split('.')[0] ?? ''
        if (domain !== 'all' && dom !== domain) return false
        if (search) {
            const q = search.toLowerCase()
            return s.entity_id?.toLowerCase().includes(q) ||
                   s.attributes?.friendly_name?.toLowerCase().includes(q) ||
                   s.state?.toLowerCase().includes(q)
        }
        return true
    }), [states, domain, search])

    const toggleEntity = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }

    const saveSelection = async () => {
        setSaving(true)
        try {
            const val = Array.from(selected).join(',')
            await api.saveSettings({ ha_entities: val } as any)
            setCurrentFilter(val)
            setSelectMode(false)
            onToast('success', val ? `✓ Mostrando ${selected.size} entidades` : '✓ Mostrando todas las entidades')
            // Reload to apply new filter
            await load()
        } catch (e: any) {
            onToast('error', e.message || 'Error al guardar')
        } finally { setSaving(false) }
    }

    const clearSelection = async () => {
        setSelected(new Set())
        setSaving(true)
        try {
            await api.saveSettings({ ha_entities: '' } as any)
            setCurrentFilter('')
            setSelectMode(false)
            onToast('success', '✓ Mostrando todas las entidades')
            await load()
        } catch { } finally { setSaving(false) }
    }

    if (loading) return <div style={{ color: 'var(--muted)', padding: 32 }}>Cargando...</div>
    if (err && states.length === 0) return (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>
            <i className="fa-solid fa-house" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
            <div>{err}</div>
        </div>
    )

    return (
        <div>
            {/* Header */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-header">
                    <div className="card-icon" style={{ background: 'rgba(129,168,252,0.15)', color: '#81a8fc' }}>
                        <i className="fa-solid fa-house" />
                    </div>
                    <div>
                        <div className="card-title">Home Assistant</div>
                        <div className="card-sub">
                            {states.length} entidades · {domains.length - 1} dominios
                            {currentFilter && <span style={{ color: 'var(--accent)', marginLeft: 8 }}>· {selected.size} fijadas</span>}
                        </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                        {selectMode ? (
                            <>
                                <button
                                    onClick={clearSelection}
                                    disabled={saving}
                                    style={{
                                        padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                                        background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)',
                                        color: '#fc8181',
                                    }}
                                >
                                    <i className="fa-solid fa-xmark" style={{ marginRight: 5 }} />
                                    Mostrar todas
                                </button>
                                <button
                                    onClick={saveSelection}
                                    disabled={saving}
                                    style={{
                                        padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                                        background: 'rgba(104,211,145,0.15)', border: '1px solid rgba(104,211,145,0.4)',
                                        color: '#68d391', fontWeight: 600,
                                    }}
                                >
                                    {saving
                                        ? <><i className="fa-solid fa-spinner fa-spin" /> Guardando…</>
                                        : <><i className="fa-solid fa-check" style={{ marginRight: 5 }} />Guardar ({selected.size})</>
                                    }
                                </button>
                                <button
                                    onClick={() => setSelectMode(false)}
                                    style={{
                                        padding: '5px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                        color: 'var(--muted)',
                                    }}
                                >
                                    Cancelar
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="pill pill-green"><span className="dot dot-green" /> Online</span>
                                <button
                                    onClick={() => setSelectMode(true)}
                                    title="Seleccionar qué entidades mostrar en el Dashboard"
                                    style={{
                                        padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                        color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6,
                                    }}
                                >
                                    <i className="fa-solid fa-filter" />
                                    {currentFilter ? 'Editar selección' : 'Fijar entidades'}
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {selectMode && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(99,179,237,0.06)', borderRadius: 8, fontSize: 12, color: 'var(--muted)', border: '1px solid rgba(99,179,237,0.15)' }}>
                        <i className="fa-solid fa-circle-info" style={{ marginRight: 6, color: 'var(--accent)' }} />
                        Marca las entidades que quieres fijar. Solo esas se mostrarán en el Dashboard y en este panel.
                        Deja vacío para mostrar todas.
                    </div>
                )}

                {/* Domain chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    {domains.filter(d => d !== 'all').map(d => {
                        const count = states.filter((s: any) => s.entity_id?.split('.')[0] === d).length
                        return (
                            <button
                                key={d}
                                onClick={() => setDomain(prev => prev === d ? 'all' : d)}
                                style={{
                                    padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
                                    border: `1px solid ${domain === d ? 'var(--accent)' : 'var(--border)'}`,
                                    background: domain === d ? 'rgba(99,179,237,0.15)' : 'rgba(255,255,255,0.03)',
                                    color: domain === d ? 'var(--accent)' : 'var(--muted)',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                            >
                                <i className={`fa-solid ${DOMAIN_ICON[d] ?? 'fa-circle'}`} style={{ fontSize: 10 }} />
                                {d} <span style={{ opacity: 0.6 }}>({count})</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Search + list */}
            <div className="card">
                <input
                    type="text"
                    placeholder="Buscar entidad, estado..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, marginBottom: 14,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                        color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
                    }}
                />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                    {filtered.length} entidades{domain !== 'all' ? ` en ${domain}` : ''}
                    {selectMode && selected.size > 0 && <span style={{ color: 'var(--accent)', marginLeft: 8 }}> · {selected.size} seleccionadas</span>}
                </div>
                <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                    {filtered.map((s: any) => {
                        const dom = s.entity_id?.split('.')[0] ?? ''
                        const name = s.attributes?.friendly_name || s.entity_id
                        const stateColor = STATE_COLOR[s.state] ?? 'var(--text)'
                        const isSelected = selected.has(s.entity_id)
                        return (
                            <div
                                key={s.entity_id}
                                className="kv-row"
                                onClick={selectMode ? () => toggleEntity(s.entity_id) : undefined}
                                style={{
                                    cursor: selectMode ? 'pointer' : 'default',
                                    background: selectMode && isSelected ? 'rgba(99,179,237,0.08)' : undefined,
                                    borderRadius: selectMode ? 6 : undefined,
                                }}
                            >
                                {selectMode && (
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleEntity(s.entity_id)}
                                        onClick={e => e.stopPropagation()}
                                        style={{ marginRight: 10, cursor: 'pointer', flexShrink: 0 }}
                                    />
                                )}
                                <span className="kv-key" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                    <i className={`fa-solid ${DOMAIN_ICON[dom] ?? 'fa-circle'}`}
                                       style={{ width: 14, color: 'var(--muted)', fontSize: 12, flexShrink: 0 }} />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                    <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{s.entity_id}</span>
                                </span>
                                <span style={{ color: stateColor, fontWeight: 600, fontSize: 13, flexShrink: 0, marginLeft: 8 }}>
                                    {s.state}
                                    {s.attributes?.unit_of_measurement && (
                                        <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 4 }}>
                                            {s.attributes.unit_of_measurement}
                                        </span>
                                    )}
                                </span>
                            </div>
                        )
                    })}
                    {filtered.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Sin resultados</div>}
                </div>
            </div>
        </div>
    )
}
