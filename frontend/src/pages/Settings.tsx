import { useEffect, useState } from 'react'
import { api, authApi, usersApi, alertsApi, type CurrentUser, type AlertRule } from '../api'

interface Props {
    onToast: (t: 'success' | 'error', m: string) => void
    currentUser: CurrentUser | null
    onUserUpdate: () => void
}

const SECTIONS = [
    {
        id: 'proxmox', title: 'Proxmox VE', icon: 'fa-cubes', color: 'var(--accent)',
        fields: [
            { key: 'pve_url',  label: 'URL (ej. https://192.168.1.7:8006)',        type: 'text' },
            { key: 'pve_user', label: 'Usuario (ej. root@pam o root@pam!tokenid)', type: 'text' },
            { key: 'pve_pass', label: 'Contraseña o API Token value',              type: 'password' },
        ]
    },
    {
        id: 'opnsense', title: 'OPNsense', icon: 'fa-shield-halved', color: 'var(--accent3)',
        fields: [
            { key: 'opn_url',    label: 'URL (ej. https://192.168.1.1)', type: 'text' },
            { key: 'opn_key',    label: 'API Key',                       type: 'password' },
            { key: 'opn_secret', label: 'API Secret',                    type: 'password' },
        ]
    },
    {
        id: 'k8s', title: 'Kubernetes', icon: 'fa-dharmachakra', color: 'var(--accent2)',
        fields: [
            { key: 'k8s_url',   label: 'API Server URL (vacío = in-cluster)', type: 'text' },
            { key: 'k8s_token', label: 'Bearer Token',                        type: 'password' },
        ]
    },
    {
        id: 'unraid', title: 'Unraid', icon: 'fa-server', color: 'var(--accent4)',
        fields: [
            { key: 'unraid_url', label: 'URL (ej. http://192.168.1.10)', type: 'text' },
            { key: 'unraid_key', label: 'API Key',                       type: 'password' },
        ]
    },
    {
        id: 'plex', title: 'Plex Media Server', icon: 'fa-film', color: 'var(--accent4)',
        fields: [
            { key: 'plex_url',   label: 'URL (ej. http://192.168.1.10:32400)', type: 'text' },
            { key: 'plex_token', label: 'X-Plex-Token',                        type: 'password' },
        ]
    },
    {
        id: 'immich', title: 'Immich', icon: 'fa-images', color: 'var(--accent)',
        fields: [
            { key: 'immich_url', label: 'URL (ej. http://192.168.1.10:2283)', type: 'text' },
            { key: 'immich_key', label: 'API Key',                            type: 'password' },
        ]
    },
    {
        id: 'ha', title: 'Home Assistant', icon: 'fa-house-signal', color: 'var(--accent6)',
        fields: [
            { key: 'ha_url',      label: 'URL (ej. http://homeassistant.local:8123)',         type: 'text' },
            { key: 'ha_token',    label: 'Long-Lived Access Token',                           type: 'password' },
            { key: 'ha_entities', label: 'Entity IDs (coma-separados, vacío = todos)',        type: 'text' },
        ]
    },
    {
        id: 'snmp', title: 'SNMP (Switch)', icon: 'fa-sitemap', color: 'var(--accent2)',
        fields: [
            { key: 'snmp_host',      label: 'IP del switch (ej. 192.168.1.2)',      type: 'text' },
            { key: 'snmp_community', label: 'Community string (ej. public)',         type: 'text' },
            { key: 'snmp_port',      label: 'Puerto UDP (default: 161)',             type: 'text' },
        ]
    },
]

const OP_LABELS: Record<string, string> = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=', ne: '≠' }

export default function Settings({ onToast, currentUser, onUserUpdate }: Props) {
    // ── Integration settings ───────────────────────────────────
    const [values, setValues] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState(false)
    const [testingPve, setTestingPve] = useState(false)

    // ── Change password ────────────────────────────────────────
    const [pwCurrent, setPwCurrent] = useState('')
    const [pwNew, setPwNew]         = useState('')
    const [pwConfirm, setPwConfirm] = useState('')
    const [pwLoading, setPwLoading] = useState(false)

    // ── TOTP ──────────────────────────────────────────────────
    const [totpLoading, setTotpLoading] = useState(false)
    const [totpSetup,   setTotpSetup]   = useState<{ secret: string; uri: string } | null>(null)
    const [totpCode,    setTotpCode]    = useState('')

    // ── Users ─────────────────────────────────────────────────
    const [users,       setUsers]       = useState<{ id: number; username: string; totp_enabled: boolean }[]>([])
    const [newUsername, setNewUsername] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [userLoading, setUserLoading] = useState(false)

    // ── Alert rules ────────────────────────────────────────────
    const [rules,         setRules]         = useState<AlertRule[]>([])
    const [ruleLoading,   setRuleLoading]   = useState(false)
    const [newRule, setNewRule] = useState({ name: '', metric_key: '', operator: 'gt', threshold: 0, notify_url: '', cooldown_s: 3600 })

    useEffect(() => {
        api.getSettings().then((s: any) => setValues(s as Record<string, string>)).catch(() => { })
        loadUsers()
        loadRules()
    }, [])

    const loadUsers = () => usersApi.list().then(r => setUsers(r.users)).catch(() => { })
    const loadRules = () => alertsApi.list().then(r => setRules(r.rules)).catch(() => { })

    const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }))

    // ── Handlers ──────────────────────────────────────────────

    const handleSave = async () => {
        setSaving(true)
        try {
            await api.saveSettings(values)
            onToast('success', '✓ Configuración guardada. Los cachés se han invalidado.')
        } catch {
            onToast('error', 'Error al guardar la configuración')
        } finally { setSaving(false) }
    }

    const handleTestPve = async () => {
        setTestingPve(true)
        try {
            const r = await api.proxmoxTest()
            onToast(r.ok ? 'success' : 'error', r.message)
        } catch (err: any) {
            onToast('error', err.message)
        } finally { setTestingPve(false) }
    }

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (pwNew !== pwConfirm) { onToast('error', 'Las contraseñas nuevas no coinciden'); return }
        if (pwNew.length < 6)   { onToast('error', 'La contraseña debe tener al menos 6 caracteres'); return }
        setPwLoading(true)
        try {
            await authApi.changePassword(pwCurrent, pwNew)
            onToast('success', '✓ Contraseña cambiada correctamente')
            setPwCurrent(''); setPwNew(''); setPwConfirm('')
        } catch (err: any) { onToast('error', err.message || 'Error al cambiar la contraseña') }
        finally { setPwLoading(false) }
    }

    const handleInitTotp = async () => {
        setTotpLoading(true)
        try { setTotpSetup(await authApi.initTotp()); setTotpCode('') }
        catch (err: any) { onToast('error', err.message || 'Error al iniciar 2FA') }
        finally { setTotpLoading(false) }
    }

    const handleEnableTotp = async (e: React.FormEvent) => {
        e.preventDefault()
        setTotpLoading(true)
        try {
            await authApi.enableTotp(totpCode)
            onToast('success', '✓ 2FA activado correctamente')
            setTotpSetup(null); setTotpCode('')
            onUserUpdate()
        } catch (err: any) { onToast('error', err.message || 'Código incorrecto') }
        finally { setTotpLoading(false) }
    }

    const handleDisableTotp = async () => {
        if (!confirm('¿Desactivar la autenticación 2FA?')) return
        setTotpLoading(true)
        try {
            await authApi.disableTotp()
            onToast('success', '2FA desactivado')
            setTotpSetup(null); onUserUpdate()
        } catch (err: any) { onToast('error', err.message || 'Error al desactivar 2FA') }
        finally { setTotpLoading(false) }
    }

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newUsername.trim() || !newPassword) { onToast('error', 'Usuario y contraseña son obligatorios'); return }
        setUserLoading(true)
        try {
            await usersApi.create(newUsername.trim(), newPassword)
            onToast('success', `✓ Usuario "${newUsername.trim()}" creado`)
            setNewUsername(''); setNewPassword('')
            loadUsers()
        } catch (err: any) { onToast('error', err.message || 'Error al crear usuario') }
        finally { setUserLoading(false) }
    }

    const handleDeleteUser = async (userId: number, username: string) => {
        if (!confirm(`¿Eliminar el usuario "${username}"?`)) return
        try {
            await usersApi.delete(userId)
            onToast('success', `Usuario "${username}" eliminado`)
            loadUsers()
        } catch (err: any) { onToast('error', err.message || 'Error al eliminar usuario') }
    }

    const handleCreateRule = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newRule.name || !newRule.metric_key) { onToast('error', 'Nombre y métrica son obligatorios'); return }
        setRuleLoading(true)
        try {
            await alertsApi.create(newRule)
            onToast('success', '✓ Regla de alerta creada')
            setNewRule({ name: '', metric_key: '', operator: 'gt', threshold: 0, notify_url: '', cooldown_s: 3600 })
            loadRules()
        } catch (err: any) { onToast('error', err.message || 'Error al crear regla') }
        finally { setRuleLoading(false) }
    }

    const handleDeleteRule = async (id: number) => {
        if (!confirm('¿Eliminar esta regla de alerta?')) return
        try {
            await alertsApi.delete(id)
            onToast('success', 'Regla eliminada')
            loadRules()
        } catch (err: any) { onToast('error', err.message) }
    }

    const handleToggleRule = async (rule: AlertRule) => {
        try {
            await alertsApi.toggle(rule.id, !rule.enabled)
            loadRules()
        } catch { }
    }

    const qrUrl = totpSetup ? `/api/auth/totp-qr?uri=${encodeURIComponent(totpSetup.uri)}` : ''
    const totpEnabled = currentUser?.totp_enabled ?? false

    return (
        <div style={{ maxWidth: 900 }}>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
                Las credenciales se guardan en SQLite. Valores <code style={{ fontFamily: 'JetBrains Mono' }}>***</code> ya guardados — déjalos vacíos para mantenerlos.
            </p>

            {/* ── Integration sections ── */}
            {SECTIONS.map(sec => (
                <div key={sec.id} className="form-section">
                    <div className="form-section-title" style={{ color: sec.color }}>
                        <i className={`fa-solid ${sec.icon}`} />{sec.title}
                    </div>
                    {sec.id === 'proxmox' && (
                        <div style={{
                            fontSize: 12, color: 'var(--muted)', marginBottom: 12, padding: '8px 12px',
                            background: 'rgba(99,179,237,0.06)', border: '1px solid rgba(99,179,237,0.15)',
                            borderRadius: 8, lineHeight: 1.7,
                        }}>
                            <i className="fa-solid fa-circle-info" style={{ color: 'var(--accent)', marginRight: 6 }} />
                            Para usar <strong style={{ color: 'var(--text)' }}>API Token</strong> (recomendado si tienes 2FA):
                            Datacenter → API Tokens → Añadir → copia el Token ID.
                            Pon <code>root@pam!tokenid</code> en Usuario y el token value en Contraseña.
                        </div>
                    )}
                    <div className="form-grid">
                        {sec.fields.map(f => (
                            <div key={f.key} className="form-group">
                                <label>{f.label}</label>
                                <input
                                    type={f.type}
                                    value={values[f.key] ?? ''}
                                    onChange={e => set(f.key, e.target.value)}
                                    placeholder={values[f.key] === '***' ? '(guardado)' : ''}
                                    autoComplete="off"
                                />
                            </div>
                        ))}
                    </div>
                    {sec.id === 'proxmox' && (
                        <button
                            className="btn"
                            onClick={handleTestPve}
                            disabled={testingPve}
                            style={{ marginTop: 8, border: '1px solid rgba(99,179,237,0.3)', color: 'var(--accent)', background: 'rgba(99,179,237,0.06)' }}
                        >
                            <i className={`fa-solid ${testingPve ? 'fa-spinner fa-spin' : 'fa-plug'}`} />
                            {testingPve ? 'Probando…' : 'Probar conexión'}
                        </button>
                    )}
                </div>
            ))}

            {/* Session timeout */}
            <div className="form-section">
                <div className="form-section-title" style={{ color: 'var(--muted)' }}>
                    <i className="fa-solid fa-clock" /> Sesión
                </div>
                <div className="form-group" style={{ maxWidth: 260 }}>
                    <label>Timeout de sesión (horas, 0 = sin límite)</label>
                    <input
                        type="number"
                        min="0" max="720"
                        value={values['session_timeout_hours'] ?? '24'}
                        onChange={e => set('session_timeout_hours', e.target.value)}
                    />
                </div>
            </div>

            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                {saving ? 'Guardando…' : 'Guardar configuración'}
            </button>

            <div style={{ marginTop: 24, padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Variables de entorno (alternativa a la UI)
                </div>
                <pre style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono', lineHeight: 1.8, overflowX: 'auto' }}>
                    {`PVE_URL=https://192.168.1.7:8006    PVE_USER=root@pam    PVE_PASS=...
OPN_URL=https://192.168.1.1          OPN_KEY=...          OPN_SECRET=...
K8S_URL=https://k8s-api:6443         K8S_TOKEN=...
UNRAID_URL=http://192.168.1.x        UNRAID_KEY=...
PLEX_URL=http://192.168.1.x:32400    PLEX_TOKEN=...
IMMICH_URL=http://192.168.1.x:2283   IMMICH_KEY=...
HA_URL=http://homeassistant:8123     HA_TOKEN=...         HA_ENTITIES=person.x,sensor.y
DB_PATH=/data/labdash.db`}
                </pre>
            </div>

            {/* ── Alert rules ── */}
            <div className="form-section" style={{ marginTop: 40 }}>
                <div className="form-section-title" style={{ color: '#fc8181' }}>
                    <i className="fa-solid fa-bell" /> Reglas de alerta
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                    Define umbrales sobre métricas recogidas (ej. <code>pve.cpu.pve</code>, <code>gw.rtt.WAN_DHCP</code>, <code>snmp.in_kbps</code>).
                    Cuando se supera el umbral se genera un evento y se envía un webhook (compatible con Slack, Discord, etc.)
                </p>

                {/* Rule list */}
                {rules.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                        {rules.map(rule => (
                            <div key={rule.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8,
                                opacity: rule.enabled ? 1 : 0.5,
                            }}>
                                <i className="fa-solid fa-bell" style={{ color: '#fc8181', fontSize: 13 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{rule.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                                        {rule.metric_key} {OP_LABELS[rule.operator] ?? rule.operator} {rule.threshold}
                                        {rule.notify_url && <span style={{ marginLeft: 8, color: 'var(--accent6)' }}>· webhook</span>}
                                        {rule.last_fired ? <span style={{ marginLeft: 8 }}>· última vez {new Date(rule.last_fired * 1000).toLocaleString('es-ES')}</span> : ''}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggleRule(rule)}
                                    style={{
                                        background: 'none', border: `1px solid ${rule.enabled ? 'rgba(104,211,145,0.3)' : 'rgba(150,150,150,0.3)'}`,
                                        borderRadius: 6, color: rule.enabled ? '#68d391' : 'var(--muted)',
                                        cursor: 'pointer', padding: '3px 10px', fontSize: 11,
                                    }}
                                    title={rule.enabled ? 'Deshabilitar' : 'Habilitar'}
                                >
                                    <i className={`fa-solid ${rule.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`} />
                                </button>
                                <button
                                    onClick={() => handleDeleteRule(rule.id)}
                                    style={{ background: 'none', border: '1px solid rgba(252,129,129,0.3)', borderRadius: 6, color: '#fc8181', cursor: 'pointer', padding: '3px 8px', fontSize: 11 }}
                                >
                                    <i className="fa-solid fa-trash" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* New rule form */}
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
                    <i className="fa-solid fa-plus" style={{ color: 'var(--muted)', marginRight: 6 }} />
                    Nueva regla
                </div>
                <form onSubmit={handleCreateRule}>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Nombre</label>
                            <input value={newRule.name} onChange={e => setNewRule(r => ({ ...r, name: e.target.value }))} placeholder="CPU alta en pve" autoComplete="off" />
                        </div>
                        <div className="form-group">
                            <label>Clave de métrica</label>
                            <input value={newRule.metric_key} onChange={e => setNewRule(r => ({ ...r, metric_key: e.target.value }))} placeholder="pve.cpu.pve" autoComplete="off" />
                        </div>
                        <div className="form-group">
                            <label>Operador</label>
                            <select value={newRule.operator} onChange={e => setNewRule(r => ({ ...r, operator: e.target.value }))}
                                style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 13, width: '100%' }}>
                                {Object.entries(OP_LABELS).map(([op, label]) => (
                                    <option key={op} value={op}>{label} ({op})</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Umbral</label>
                            <input type="number" step="any" value={newRule.threshold} onChange={e => setNewRule(r => ({ ...r, threshold: parseFloat(e.target.value) || 0 }))} />
                        </div>
                        <div className="form-group">
                            <label>Webhook URL (opcional — Slack/Discord/etc.)</label>
                            <input value={newRule.notify_url} onChange={e => setNewRule(r => ({ ...r, notify_url: e.target.value }))} placeholder="https://hooks.slack.com/..." type="url" autoComplete="off" />
                        </div>
                        <div className="form-group">
                            <label>Cooldown (segundos, mín. tiempo entre alertas)</label>
                            <input type="number" min="60" value={newRule.cooldown_s} onChange={e => setNewRule(r => ({ ...r, cooldown_s: parseInt(e.target.value) || 3600 }))} />
                        </div>
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={ruleLoading} style={{ marginTop: 8 }}>
                        <i className={`fa-solid ${ruleLoading ? 'fa-spinner fa-spin' : 'fa-bell-plus'}`} />
                        {ruleLoading ? 'Creando…' : 'Crear regla'}
                    </button>
                </form>
            </div>

            {/* ── Security ── */}
            <div className="form-section" style={{ marginTop: 24 }}>
                <div className="form-section-title" style={{ color: 'var(--accent5)' }}>
                    <i className="fa-solid fa-shield-halved" />
                    Seguridad — {currentUser?.username}
                </div>

                <div style={{ marginBottom: 32 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-key" style={{ color: 'var(--muted)' }} /> Cambiar contraseña
                    </div>
                    <form onSubmit={handleChangePassword}>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Contraseña actual</label>
                                <input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} autoComplete="current-password" required />
                            </div>
                            <div className="form-group">
                                <label>Nueva contraseña</label>
                                <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} autoComplete="new-password" required />
                            </div>
                            <div className="form-group">
                                <label>Confirmar nueva contraseña</label>
                                <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} autoComplete="new-password" required />
                            </div>
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={pwLoading} style={{ marginTop: 8 }}>
                            <i className={`fa-solid ${pwLoading ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                            {pwLoading ? 'Guardando…' : 'Cambiar contraseña'}
                        </button>
                    </form>
                </div>

                <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-mobile-screen-button" style={{ color: 'var(--muted)' }} />
                        Autenticación en dos pasos (2FA)
                        {totpEnabled ? (
                            <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: 'rgba(104,211,145,0.15)', border: '1px solid rgba(104,211,145,0.4)', color: '#68d391', marginLeft: 4 }}>
                                <i className="fa-solid fa-check" style={{ marginRight: 4 }} />Activo
                            </span>
                        ) : (
                            <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)', color: '#fc8181', marginLeft: 4 }}>Inactivo</span>
                        )}
                    </div>
                    {totpEnabled ? (
                        <div>
                            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Tu cuenta está protegida con 2FA.</p>
                            <button className="btn" onClick={handleDisableTotp} disabled={totpLoading}
                                style={{ border: '1px solid rgba(252,129,129,0.4)', color: '#fc8181', background: 'rgba(252,129,129,0.08)' }}>
                                <i className={`fa-solid ${totpLoading ? 'fa-spinner fa-spin' : 'fa-shield-xmark'}`} /> Desactivar 2FA
                            </button>
                        </div>
                    ) : totpSetup ? (
                        <div>
                            <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.2)', borderRadius: 12, padding: '12px 14px', marginBottom: 18, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                                <i className="fa-solid fa-circle-info" style={{ color: 'var(--accent)', marginRight: 7 }} />
                                Escanea el QR con Google Authenticator, Authy u otra app TOTP.
                            </div>
                            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <div style={{ display: 'inline-block', padding: 10, background: '#fff', borderRadius: 12 }}>
                                    <img src={qrUrl} alt="QR 2FA" style={{ width: 180, height: 180, display: 'block' }} />
                                </div>
                                <div style={{ flex: 1, minWidth: 200 }}>
                                    <details style={{ marginBottom: 16 }}>
                                        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none' }}>
                                            <i className="fa-solid fa-key" style={{ marginRight: 6 }} />Clave manual
                                        </summary>
                                        <div style={{ marginTop: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, wordBreak: 'break-all', color: 'var(--accent)', userSelect: 'all' }}>
                                            {totpSetup.secret}
                                        </div>
                                    </details>
                                    <form onSubmit={handleEnableTotp}>
                                        <div className="form-group" style={{ marginBottom: 12 }}>
                                            <label>Código de verificación</label>
                                            <input value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                                                placeholder="123456" maxLength={6} autoFocus
                                                style={{ letterSpacing: '0.4em', fontSize: 22, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }} />
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button className="btn btn-primary" type="submit" disabled={totpLoading || totpCode.length < 6}>
                                                <i className={`fa-solid ${totpLoading ? 'fa-spinner fa-spin' : 'fa-check-double'}`} />
                                                {totpLoading ? 'Verificando…' : 'Activar 2FA'}
                                            </button>
                                            <button type="button" className="btn" onClick={() => { setTotpSetup(null); setTotpCode('') }}
                                                style={{ border: '1px solid var(--border)', color: 'var(--muted)', background: 'none' }}>
                                                Cancelar
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>2FA no está activado.</p>
                            <button className="btn btn-primary" onClick={handleInitTotp} disabled={totpLoading}>
                                <i className={`fa-solid ${totpLoading ? 'fa-spinner fa-spin' : 'fa-shield-halved'}`} />
                                {totpLoading ? 'Preparando…' : 'Activar 2FA'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Users ── */}
            <div className="form-section" style={{ marginTop: 24 }}>
                <div className="form-section-title" style={{ color: 'var(--accent2)' }}>
                    <i className="fa-solid fa-users" /> Usuarios
                </div>
                <div style={{ marginBottom: 24 }}>
                    {users.length === 0 ? (
                        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Cargando usuarios…</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {users.map(u => (
                                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
                                    <i className="fa-solid fa-user" style={{ color: 'var(--muted)', fontSize: 14 }} />
                                    <span style={{ flex: 1, fontSize: 14, fontWeight: u.id === currentUser?.id ? 600 : 400 }}>
                                        {u.username}
                                        {u.id === currentUser?.id && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(tú)</span>}
                                    </span>
                                    {u.totp_enabled ? (
                                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(104,211,145,0.12)', border: '1px solid rgba(104,211,145,0.3)', color: '#68d391', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <i className="fa-solid fa-shield-halved" style={{ fontSize: 10 }} />2FA
                                        </span>
                                    ) : (
                                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(150,150,150,0.1)', border: '1px solid rgba(150,150,150,0.2)', color: 'var(--muted)' }}>Sin 2FA</span>
                                    )}
                                    {u.id !== currentUser?.id && (
                                        <button onClick={() => handleDeleteUser(u.id, u.username)}
                                            style={{ background: 'none', border: '1px solid rgba(252,129,129,0.3)', borderRadius: 6, color: '#fc8181', cursor: 'pointer', padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <i className="fa-solid fa-trash" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fa-solid fa-user-plus" style={{ color: 'var(--muted)' }} /> Añadir usuario
                </div>
                <form onSubmit={handleCreateUser}>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Nombre de usuario</label>
                            <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="nuevo_usuario" autoComplete="off" />
                        </div>
                        <div className="form-group">
                            <label>Contraseña</label>
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" />
                        </div>
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={userLoading} style={{ marginTop: 8 }}>
                        <i className={`fa-solid ${userLoading ? 'fa-spinner fa-spin' : 'fa-user-plus'}`} />
                        {userLoading ? 'Creando…' : 'Crear usuario'}
                    </button>
                </form>
            </div>
        </div>
    )
}
