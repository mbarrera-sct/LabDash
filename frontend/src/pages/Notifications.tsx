import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

interface AlertRule {
    id: number; name: string; metric_key: string; operator: string
    threshold: number; notify_url: string; cooldown_s: number
    enabled: number; last_fired: number
}

interface AlertHistory {
    id: number; ts: number; rule_id: number; rule_name: string
    metric_key: string; value: number; threshold: number
}

interface Silence { rule_id: number; until_ts: number }

interface TgStatus {
    configured: boolean
    bot: { username: string; first_name: string } | null
    chat_id: string | null
    daily_digest: boolean
}

const OPS = ['gt', 'lt', 'gte', 'lte', 'eq', 'ne']
const OP_LABELS: Record<string, string> = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', ne: '≠' }
const COOLDOWNS = [
    { label: '5 min',   value: 300 },
    { label: '15 min',  value: 900 },
    { label: '1 hora',  value: 3600 },
    { label: '6 horas', value: 21600 },
    { label: '24 horas',value: 86400 },
]
const QUICK_METRICS = [
    { label: 'CPU Proxmox (nodo)', key: 'pve.cpu.', placeholder: 'pve.cpu.pve1' },
    { label: 'RAM Proxmox (nodo)', key: 'pve.mem.', placeholder: 'pve.mem.pve1' },
    { label: 'Gateway RTT', key: 'gw.rtt.', placeholder: 'gw.rtt.WAN_GW' },
    { label: 'SNMP IN (kbps)',  key: 'snmp.in_kbps',  placeholder: 'snmp.in_kbps' },
    { label: 'SNMP OUT (kbps)', key: 'snmp.out_kbps', placeholder: 'snmp.out_kbps' },
]

function fmtTs(ts: number) {
    return new Date(ts * 1000).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    })
}
function fmtRelative(ts: number) {
    const diff = Date.now() / 1000 - ts
    if (diff < 60)  return 'Hace unos segundos'
    if (diff < 3600) return `Hace ${Math.round(diff / 60)} min`
    if (diff < 86400) return `Hace ${Math.round(diff / 3600)}h`
    return `Hace ${Math.round(diff / 86400)}d`
}

export default function Notifications({ onToast }: Props) {
    const [tab, setTab] = useState<'telegram' | 'rules' | 'history'>('telegram')

    // Telegram state
    const [tgStatus, setTgStatus]     = useState<TgStatus | null>(null)
    const [tgToken,  setTgToken]      = useState('')
    const [tgChat,   setTgChat]       = useState('')
    const [tgDigest, setTgDigest]     = useState(false)
    const [tgSaving, setTgSaving]     = useState(false)
    const [tgTesting, setTgTesting]   = useState(false)
    const [showToken, setShowToken]   = useState(false)

    // Rules state
    const [rules,    setRules]        = useState<AlertRule[]>([])
    const [silences, setSilences]     = useState<Silence[]>([])
    const [history,  setHistory]      = useState<AlertHistory[]>([])
    const [metricKeys, setMetricKeys] = useState<string[]>([])

    const [showNewRule, setShowNewRule] = useState(false)
    const [editRule,    setEditRule]    = useState<AlertRule | null>(null)
    const [newRule, setNewRule]         = useState({
        name: '', metric_key: '', operator: 'gt', threshold: 80,
        notify_url: '', cooldown_s: 3600
    })

    const loadAll = useCallback(async () => {
        const [tg, r, s, h, mk] = await Promise.allSettled([
            api.telegramStatus(),
            api.alertsApi.list(),
            api.alertSilences(),
            api.getAlertHistory(200),
            api.metricsKeys(),
        ])
        if (tg.status === 'fulfilled') {
            const d = tg.value as TgStatus
            setTgStatus(d)
            if (d.bot) {
                // Don't pre-fill token for security
            }
            if (d.chat_id) setTgChat(d.chat_id)
            setTgDigest(d.daily_digest)
        }
        if (r.status  === 'fulfilled') setRules((r.value as any).rules ?? [])
        if (s.status  === 'fulfilled') setSilences((s.value as any).silences ?? [])
        if (h.status  === 'fulfilled') setHistory((h.value as any).entries ?? [])
        if (mk.status === 'fulfilled') setMetricKeys((mk.value as any).keys ?? [])
    }, [])

    useEffect(() => { loadAll() }, [loadAll])

    // ── Telegram handlers ──────────────────────────────────────────────────────
    const handleSaveTelegram = async () => {
        setTgSaving(true)
        try {
            await api.telegramConfig({ token: tgToken, chat_id: tgChat, daily_digest: tgDigest })
            onToast('success', '✓ Telegram configurado correctamente')
            loadAll()
        } catch (e: any) {
            onToast('error', e.message || 'Error guardando configuración')
        } finally { setTgSaving(false) }
    }

    const handleTestTelegram = async () => {
        setTgTesting(true)
        try {
            const r = await api.telegramTest() as any
            if (r.ok) onToast('success', '✓ Mensaje de prueba enviado')
            else onToast('error', r.error || 'Error en el test')
        } catch (e: any) {
            onToast('error', e.message || 'Error en el test')
        } finally { setTgTesting(false) }
    }

    const handleDeleteTelegram = async () => {
        if (!confirm('¿Eliminar la configuración de Telegram?')) return
        try {
            await api.telegramDelete()
            setTgToken(''); setTgChat(''); setTgDigest(false)
            onToast('success', '✓ Configuración eliminada')
            loadAll()
        } catch (e: any) { onToast('error', e.message) }
    }

    // ── Rule handlers ──────────────────────────────────────────────────────────
    const handleCreateRule = async () => {
        if (!newRule.name || !newRule.metric_key) {
            onToast('error', 'Nombre y métrica son obligatorios')
            return
        }
        try {
            await api.alertsApi.create(newRule)
            onToast('success', '✓ Regla creada')
            setShowNewRule(false)
            setNewRule({ name: '', metric_key: '', operator: 'gt', threshold: 80, notify_url: '', cooldown_s: 3600 })
            loadAll()
        } catch (e: any) { onToast('error', e.message) }
    }

    const handleUpdateRule = async () => {
        if (!editRule) return
        try {
            await api.alertsApi.update(editRule.id, editRule)
            onToast('success', '✓ Regla actualizada')
            setEditRule(null)
            loadAll()
        } catch (e: any) { onToast('error', e.message) }
    }

    const handleDeleteRule = async (id: number) => {
        if (!confirm('¿Eliminar esta regla?')) return
        try {
            await api.alertsApi.delete(id)
            onToast('success', '✓ Regla eliminada')
            loadAll()
        } catch (e: any) { onToast('error', e.message) }
    }

    const handleToggleRule = async (id: number, enabled: boolean) => {
        try {
            await api.alertsApi.toggle(id, !enabled)
            loadAll()
        } catch (e: any) { onToast('error', e.message) }
    }

    const handleTestRule = async (id: number) => {
        try {
            const r = await api.alertsApi.test(id) as any
            onToast('success', r.message || '✓ Notificación de prueba enviada')
        } catch (e: any) { onToast('error', e.message) }
    }

    const handleSilenceRule = async (id: number, hours: number) => {
        try {
            await api.silenceAlert(id, hours)
            onToast('success', `✓ Alerta silenciada ${hours}h`)
            loadAll()
        } catch (e: any) { onToast('error', e.message) }
    }

    const silenceMap: Record<number, Silence> = {}
    silences.forEach(s => { silenceMap[s.rule_id] = s })

    // ── Styles ─────────────────────────────────────────────────────────────────
    const inputStyle: any = {
        width: '100%', background: 'rgba(15,22,40,0.8)', border: '1px solid var(--border)',
        borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 13,
        outline: 'none', boxSizing: 'border-box',
    }
    const labelStyle: any = { fontSize: 11, color: 'var(--muted)', marginBottom: 4, display: 'block' }
    const fieldStyle: any = { display: 'flex', flexDirection: 'column', gap: 4 }

    return (
        <div>
            <div className="sec-title" style={{ marginBottom: 20 }}>
                <i className="fa-solid fa-bell" /> Notificaciones
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                {([
                    { id: 'telegram', icon: 'fa-paper-plane', label: 'Telegram' },
                    { id: 'rules',    icon: 'fa-bell',        label: `Reglas (${rules.length})` },
                    { id: 'history',  icon: 'fa-clock-rotate-left', label: `Historial (${history.length})` },
                ] as const).map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        style={{
                            padding: '6px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                            background: tab === t.id ? 'rgba(99,179,237,.15)' : 'rgba(255,255,255,.04)',
                            border: `1px solid ${tab === t.id ? 'rgba(99,179,237,.4)' : 'var(--border)'}`,
                            color: tab === t.id ? 'var(--accent)' : 'var(--muted)',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                    >
                        <i className={`fa-solid ${t.icon}`} style={{ fontSize: 11 }} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── TELEGRAM TAB ── */}
            {tab === 'telegram' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>

                    {/* Bot status card */}
                    <div style={{ padding: '16px 20px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(99,179,237,.15)', border: '1px solid rgba(99,179,237,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#63b3ed' }}>
                                <i className="fa-brands fa-telegram" />
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Telegram Bot</div>
                                {tgStatus?.configured && tgStatus.bot ? (
                                    <div style={{ fontSize: 12, color: '#68d391' }}>
                                        <i className="fa-solid fa-circle" style={{ fontSize: 8, marginRight: 4 }} />
                                        @{tgStatus.bot.username} — {tgStatus.bot.first_name}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>No configurado</div>
                                )}
                            </div>
                            {tgStatus?.configured && (
                                <span style={{ marginLeft: 'auto', fontSize: 10, background: 'rgba(104,211,145,.15)', color: '#68d391', border: '1px solid rgba(104,211,145,.3)', borderRadius: 12, padding: '2px 10px', fontWeight: 700 }}>
                                    Activo
                                </span>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {/* Token */}
                            <div style={fieldStyle}>
                                <label style={labelStyle}>Bot Token <span style={{ color: '#fc8181' }}>*</span></label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showToken ? 'text' : 'password'}
                                        value={tgToken}
                                        onChange={e => setTgToken(e.target.value)}
                                        placeholder="123456789:AABBccDDeeFFggHHiiJJkkLLmmNNoopp"
                                        style={{ ...inputStyle, paddingRight: 40 }}
                                    />
                                    <button
                                        onClick={() => setShowToken(s => !s)}
                                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}
                                    >
                                        <i className={`fa-solid ${showToken ? 'fa-eye-slash' : 'fa-eye'}`} />
                                    </button>
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                                    Obtén un token de <strong>@BotFather</strong> en Telegram → /newbot
                                </div>
                            </div>

                            {/* Chat ID */}
                            <div style={fieldStyle}>
                                <label style={labelStyle}>Chat ID</label>
                                <input
                                    value={tgChat}
                                    onChange={e => setTgChat(e.target.value)}
                                    placeholder="-100123456789 (auto si usas /start en el bot)"
                                    style={inputStyle}
                                />
                                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                                    Opcional: escribe <code>/start</code> en tu bot y se registrará automáticamente.
                                    Para grupos usa el ID negativo del grupo.
                                </div>
                            </div>

                            {/* Daily digest */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: 'rgba(15,22,40,0.6)', borderRadius: 10, border: '1px solid var(--border)' }}>
                                <input
                                    type="checkbox"
                                    checked={tgDigest}
                                    onChange={e => setTgDigest(e.target.checked)}
                                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#63b3ed' }}
                                />
                                <div>
                                    <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Resumen diario</div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Recibe un resumen de alertas del día anterior cada mañana</div>
                                </div>
                            </label>
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                            <button
                                onClick={handleSaveTelegram}
                                disabled={tgSaving || !tgToken}
                                style={{
                                    padding: '8px 20px', borderRadius: 8, fontSize: 12, cursor: tgToken ? 'pointer' : 'not-allowed',
                                    background: 'rgba(99,179,237,.15)', border: '1px solid rgba(99,179,237,.4)',
                                    color: '#63b3ed', display: 'flex', alignItems: 'center', gap: 6, opacity: tgToken ? 1 : 0.5,
                                }}
                            >
                                <i className={`fa-solid ${tgSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                                {tgSaving ? 'Guardando…' : 'Guardar'}
                            </button>
                            {tgStatus?.configured && (
                                <>
                                    <button
                                        onClick={handleTestTelegram}
                                        disabled={tgTesting}
                                        style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(104,211,145,.12)', border: '1px solid rgba(104,211,145,.3)', color: '#68d391', display: 'flex', alignItems: 'center', gap: 6 }}
                                    >
                                        <i className={`fa-solid ${tgTesting ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} />
                                        {tgTesting ? 'Enviando…' : 'Probar'}
                                    </button>
                                    <button
                                        onClick={handleDeleteTelegram}
                                        style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(252,129,129,.1)', border: '1px solid rgba(252,129,129,.3)', color: '#fc8181', marginLeft: 'auto' }}
                                        title="Eliminar configuración"
                                    >
                                        <i className="fa-solid fa-trash" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Setup guide */}
                    <details style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 18px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="fa-solid fa-circle-question" style={{ color: 'var(--accent5)' }} />
                            Cómo configurar el bot paso a paso
                        </summary>
                        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
                            <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>1.</span> Abre Telegram y busca <strong>@BotFather</strong></div>
                            <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>2.</span> Envía <code>/newbot</code> y sigue las instrucciones para crear tu bot</div>
                            <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>3.</span> BotFather te dará un token como <code>123456789:AABBcc...</code> — cópialo arriba</div>
                            <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>4.</span> Guarda la configuración y luego escribe <code>/start</code> en tu bot para registrar el chat automáticamente</div>
                            <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>5.</span> Usa el botón <strong>Probar</strong> para verificar que funciona</div>
                            <div style={{ marginTop: 4, padding: '10px 12px', background: 'rgba(183,148,246,.08)', border: '1px solid rgba(183,148,246,.2)', borderRadius: 8 }}>
                                <i className="fa-solid fa-lightbulb" style={{ color: 'var(--accent5)', marginRight: 6 }} />
                                <strong>Para grupos:</strong> añade el bot al grupo, envía <code>/start</code> en el grupo. El Chat ID del grupo es un número negativo.
                            </div>
                            <div style={{ padding: '10px 12px', background: 'rgba(99,179,237,.08)', border: '1px solid rgba(99,179,237,.2)', borderRadius: 8 }}>
                                <i className="fa-solid fa-robot" style={{ color: 'var(--accent)', marginRight: 6 }} />
                                <strong>Comandos disponibles en el bot:</strong>
                                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {['/status — Resumen del sistema', '/vms — Lista de VMs Proxmox', '/alerts — Reglas de alerta', '/silences — Alertas silenciadas', '/help — Ayuda'].map(c => (
                                        <div key={c}><code style={{ color: 'var(--accent4)' }}>{c.split(' — ')[0]}</code> — {c.split(' — ')[1]}</div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </details>

                    {/* Alert format preview */}
                    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 18px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                            <i className="fa-solid fa-eye" style={{ marginRight: 8, color: 'var(--muted)' }} />
                            Formato de alertas
                        </div>
                        <div style={{ background: 'rgba(10,14,26,0.8)', border: '1px solid rgba(99,179,237,0.15)', borderRadius: 12, padding: '14px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#e2e8f0', lineHeight: 1.7 }}>
                            <div style={{ color: '#fc8181', fontWeight: 700 }}>🚨 LabDash — Alerta</div>
                            <div style={{ color: 'var(--muted)', margin: '2px 0' }}>━━━━━━━━━━━━━━━━━━</div>
                            <div><span style={{ color: '#fbd38d' }}>📈</span> <strong>CPU alta en pve1</strong></div>
                            <div style={{ marginTop: 6 }}>
                                <div><span style={{ color: 'var(--muted)' }}>📊 Fuente:</span> <span style={{ color: 'var(--accent4)' }}>PVE</span></div>
                                <div><span style={{ color: 'var(--muted)' }}>📋 Métrica:</span> <span style={{ color: 'var(--accent4)' }}>cpu.pve1</span></div>
                                <div><span style={{ color: 'var(--muted)' }}>📈 Valor:</span> <span style={{ color: '#fc8181' }}>87.3%</span>  (umbral: {'>'} 80)</div>
                                <div><span style={{ color: 'var(--muted)' }}>⏰ Hora:</span> 14:32:07</div>
                            </div>
                            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {['🔕 1h', '🔕 6h', '🔕 24h', '✅ OK'].map(b => (
                                    <span key={b} style={{ padding: '2px 10px', background: 'rgba(99,179,237,.15)', border: '1px solid rgba(99,179,237,.3)', borderRadius: 6, fontSize: 11, color: '#63b3ed' }}>{b}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── RULES TAB ── */}
            {tab === 'rules' && (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <button
                            onClick={() => { setShowNewRule(true); setEditRule(null) }}
                            style={{ padding: '7px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(104,211,145,.12)', border: '1px solid rgba(104,211,145,.3)', color: '#68d391', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            <i className="fa-solid fa-plus" /> Nueva regla
                        </button>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {rules.filter(r => r.enabled).length} activas · {silences.length} silenciadas
                        </span>
                    </div>

                    {/* Quick presets */}
                    <details style={{ marginBottom: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none' }}>
                            <i className="fa-solid fa-wand-magic-sparkles" style={{ marginRight: 6, color: 'var(--accent5)' }} />
                            Presets rápidos
                        </summary>
                        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {[
                                { name: 'CPU Proxmox > 85%',     metric_key: 'pve.cpu.pve', operator: 'gt', threshold: 85 },
                                { name: 'RAM Proxmox > 90%',     metric_key: 'pve.mem.pve', operator: 'gt', threshold: 90 },
                                { name: 'Gateway RTT > 100ms',   metric_key: 'gw.rtt.WAN_GW', operator: 'gt', threshold: 100 },
                                { name: 'SNMP OUT > 100 Mbps',   metric_key: 'snmp.out_kbps', operator: 'gt', threshold: 100000 },
                            ].map(preset => (
                                <button
                                    key={preset.name}
                                    onClick={() => { setNewRule({ ...newRule, ...preset }); setShowNewRule(true) }}
                                    style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', background: 'rgba(183,148,246,.1)', border: '1px solid rgba(183,148,246,.25)', color: 'var(--accent5)' }}
                                >
                                    {preset.name}
                                </button>
                            ))}
                        </div>
                    </details>

                    {/* New/Edit rule form */}
                    {(showNewRule || editRule) && (
                        <div style={{ marginBottom: 20, padding: '18px 20px', background: 'var(--card)', border: '1px solid rgba(99,179,237,.3)', borderRadius: 16 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
                                {editRule ? '✏️ Editar regla' : '➕ Nueva regla de alerta'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                {/* Name */}
                                <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Nombre <span style={{ color: '#fc8181' }}>*</span></label>
                                    <input
                                        value={editRule ? editRule.name : newRule.name}
                                        onChange={e => editRule ? setEditRule({ ...editRule, name: e.target.value }) : setNewRule({ ...newRule, name: e.target.value })}
                                        placeholder="CPU alta en pve1"
                                        style={inputStyle}
                                    />
                                </div>
                                {/* Metric key */}
                                <div style={fieldStyle}>
                                    <label style={labelStyle}>Métrica <span style={{ color: '#fc8181' }}>*</span></label>
                                    <input
                                        list="metric-keys-list"
                                        value={editRule ? editRule.metric_key : newRule.metric_key}
                                        onChange={e => editRule ? setEditRule({ ...editRule, metric_key: e.target.value }) : setNewRule({ ...newRule, metric_key: e.target.value })}
                                        placeholder="pve.cpu.pve1"
                                        style={inputStyle}
                                    />
                                    <datalist id="metric-keys-list">
                                        {metricKeys.map(k => <option key={k} value={k} />)}
                                    </datalist>
                                </div>
                                {/* Operator */}
                                <div style={fieldStyle}>
                                    <label style={labelStyle}>Condición</label>
                                    <select
                                        value={editRule ? editRule.operator : newRule.operator}
                                        onChange={e => editRule ? setEditRule({ ...editRule, operator: e.target.value }) : setNewRule({ ...newRule, operator: e.target.value })}
                                        style={{ ...inputStyle, cursor: 'pointer' }}
                                    >
                                        {OPS.map(op => (
                                            <option key={op} value={op}>{OP_LABELS[op]} ({op})</option>
                                        ))}
                                    </select>
                                </div>
                                {/* Threshold */}
                                <div style={fieldStyle}>
                                    <label style={labelStyle}>Umbral</label>
                                    <input
                                        type="number"
                                        value={editRule ? editRule.threshold : newRule.threshold}
                                        onChange={e => editRule ? setEditRule({ ...editRule, threshold: parseFloat(e.target.value) }) : setNewRule({ ...newRule, threshold: parseFloat(e.target.value) })}
                                        style={inputStyle}
                                    />
                                </div>
                                {/* Notify URL */}
                                <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                                    <label style={labelStyle}>Canal de notificación</label>
                                    <input
                                        value={editRule ? editRule.notify_url : newRule.notify_url}
                                        onChange={e => editRule ? setEditRule({ ...editRule, notify_url: e.target.value }) : setNewRule({ ...newRule, notify_url: e.target.value })}
                                        placeholder="tg:// (Telegram global) · ntfy://topic · smtp://user:pass@host/to@email"
                                        style={inputStyle}
                                    />
                                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                        Deja vacío para usar Telegram global si está configurado. <code>tg://TOKEN/CHAT_ID</code> para Telegram específico.
                                    </div>
                                </div>
                                {/* Cooldown */}
                                <div style={fieldStyle}>
                                    <label style={labelStyle}>Cooldown (espera entre alertas)</label>
                                    <select
                                        value={editRule ? editRule.cooldown_s : newRule.cooldown_s}
                                        onChange={e => editRule ? setEditRule({ ...editRule, cooldown_s: parseInt(e.target.value) }) : setNewRule({ ...newRule, cooldown_s: parseInt(e.target.value) })}
                                        style={{ ...inputStyle, cursor: 'pointer' }}
                                    >
                                        {COOLDOWNS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                                <button
                                    onClick={editRule ? handleUpdateRule : handleCreateRule}
                                    style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(104,211,145,.15)', border: '1px solid rgba(104,211,145,.4)', color: '#68d391', display: 'flex', alignItems: 'center', gap: 6 }}
                                >
                                    <i className="fa-solid fa-check" /> {editRule ? 'Actualizar' : 'Crear regla'}
                                </button>
                                <button
                                    onClick={() => { setShowNewRule(false); setEditRule(null) }}
                                    style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Rules list */}
                    {rules.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
                            <i className="fa-solid fa-bell-slash" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
                            No hay reglas de alerta. Crea una o usa un preset rápido.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {rules.map(rule => {
                                const silence = silenceMap[rule.id]
                                const silenced = !!silence
                                const enabled  = bool(rule.enabled)
                                return (
                                    <div key={rule.id} style={{
                                        padding: '14px 18px', background: 'var(--card)',
                                        border: `1px solid ${silenced ? 'rgba(251,211,141,.3)' : enabled ? 'rgba(104,211,145,.2)' : 'var(--border)'}`,
                                        borderRadius: 12, display: 'flex', alignItems: 'flex-start', gap: 14,
                                        opacity: enabled ? 1 : 0.6,
                                    }}>
                                        {/* Status indicator */}
                                        <div style={{ paddingTop: 2 }}>
                                            {silenced ? (
                                                <i className="fa-solid fa-bell-slash" style={{ color: '#fbd38d', fontSize: 16 }} title="Silenciada" />
                                            ) : enabled ? (
                                                <i className="fa-solid fa-bell" style={{ color: '#68d391', fontSize: 16 }} title="Activa" />
                                            ) : (
                                                <i className="fa-solid fa-bell-slash" style={{ color: 'var(--muted)', fontSize: 16 }} title="Desactivada" />
                                            )}
                                        </div>
                                        {/* Info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                                                {rule.name}
                                                {silenced && (
                                                    <span style={{ marginLeft: 8, fontSize: 10, color: '#fbd38d', background: 'rgba(251,211,141,.1)', border: '1px solid rgba(251,211,141,.3)', borderRadius: 8, padding: '1px 8px' }}>
                                                        silenciada hasta {fmtTs(silence.until_ts)}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4 }}>
                                                <span style={{ color: 'var(--accent4)' }}>{rule.metric_key}</span>
                                                {' '}<span style={{ color: '#fbd38d' }}>{OP_LABELS[rule.operator]}</span>{' '}
                                                <span style={{ color: 'var(--text)' }}>{rule.threshold}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--muted)', flexWrap: 'wrap' }}>
                                                {rule.notify_url ? (
                                                    <span><i className="fa-solid fa-paper-plane" style={{ marginRight: 4 }} />{rule.notify_url.split('://')[0]}</span>
                                                ) : (
                                                    <span style={{ color: '#63b3ed' }}><i className="fa-brands fa-telegram" style={{ marginRight: 4 }} />Telegram global</span>
                                                )}
                                                <span><i className="fa-solid fa-clock" style={{ marginRight: 4 }} />cooldown {rule.cooldown_s / 3600 >= 1 ? `${rule.cooldown_s / 3600}h` : `${rule.cooldown_s / 60}min`}</span>
                                                {rule.last_fired > 0 && (
                                                    <span>última: {fmtRelative(rule.last_fired)}</span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Actions */}
                                        <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <button
                                                onClick={() => handleToggleRule(rule.id, enabled)}
                                                title={enabled ? 'Desactivar' : 'Activar'}
                                                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: enabled ? 'rgba(104,211,145,.1)' : 'rgba(255,255,255,.04)', border: `1px solid ${enabled ? 'rgba(104,211,145,.3)' : 'var(--border)'}`, color: enabled ? '#68d391' : 'var(--muted)' }}
                                            >
                                                <i className={`fa-solid ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`} />
                                            </button>
                                            {/* Silence dropdown */}
                                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                                <select
                                                    defaultValue=""
                                                    onChange={e => { if (e.target.value) { handleSilenceRule(rule.id, parseFloat(e.target.value)); e.target.value = '' } }}
                                                    title="Silenciar"
                                                    style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(251,211,141,.1)', border: '1px solid rgba(251,211,141,.3)', color: '#fbd38d' }}
                                                >
                                                    <option value="" disabled>🔕 Silenciar</option>
                                                    <option value="1">1 hora</option>
                                                    <option value="6">6 horas</option>
                                                    <option value="24">24 horas</option>
                                                    <option value="168">7 días</option>
                                                </select>
                                            </div>
                                            <button
                                                onClick={() => { setEditRule(rule); setShowNewRule(false) }}
                                                title="Editar"
                                                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', color: 'var(--muted)' }}
                                            >
                                                <i className="fa-solid fa-pencil" />
                                            </button>
                                            <button
                                                onClick={() => handleTestRule(rule.id)}
                                                title="Test"
                                                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(183,148,246,.1)', border: '1px solid rgba(183,148,246,.25)', color: 'var(--accent5)' }}
                                            >
                                                <i className="fa-solid fa-bolt" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteRule(rule.id)}
                                                title="Eliminar"
                                                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'rgba(252,129,129,.1)', border: '1px solid rgba(252,129,129,.3)', color: '#fc8181' }}
                                            >
                                                <i className="fa-solid fa-trash" />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ── HISTORY TAB ── */}
            {tab === 'history' && (
                <div>
                    <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                            Últimas {history.length} alertas disparadas
                        </span>
                    </div>
                    {history.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
                            <i className="fa-solid fa-inbox" style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
                            Sin historial de alertas
                        </div>
                    ) : (
                        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Hora</th>
                                        <th>Regla</th>
                                        <th>Métrica</th>
                                        <th>Valor</th>
                                        <th>Umbral</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map(h => (
                                        <tr key={h.id}>
                                            <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                                {fmtTs(h.ts)}
                                            </td>
                                            <td style={{ color: 'var(--text)', fontWeight: 500 }}>{h.rule_name}</td>
                                            <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent4)' }}>{h.metric_key}</td>
                                            <td style={{ fontFamily: 'JetBrains Mono, monospace', color: '#fc8181', fontWeight: 700 }}>
                                                {h.value.toFixed(2)}
                                            </td>
                                            <td style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--muted)' }}>{h.threshold}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// Helper: convert SQLite 0/1 to boolean
function bool(v: number | boolean): boolean {
    return v === 1 || v === true
}
