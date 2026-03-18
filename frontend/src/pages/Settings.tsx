import { useEffect, useState } from 'react'
import { api, authApi, usersApi, type CurrentUser } from '../api'
import React from 'react'

interface Props {
    onToast: (t: 'success' | 'error', m: string) => void
    currentUser: CurrentUser | null
    onUserUpdate: () => void
    onShowWizard?: () => void
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
    {
        id: 'portainer', title: 'Portainer', icon: 'fa-cube', color: '#63b3ed',
        fields: [
            { key: 'portainer_url',   label: 'URL (ej. http://192.168.1.x:9000)', type: 'text' },
            { key: 'portainer_token', label: 'API Key (Settings → Users → Access tokens)', type: 'password' },
        ]
    },
    {
        id: 'uptime_kuma', title: 'Uptime Kuma', icon: 'fa-heart-pulse', color: '#68d391',
        fields: [
            { key: 'uptime_kuma_url',  label: 'URL (ej. http://192.168.1.x:3001)', type: 'text' },
            { key: 'uptime_kuma_slug', label: 'Status page slug (default: default)',  type: 'text' },
        ]
    },
    {
        id: 'tailscale', title: 'Tailscale', icon: 'fa-shield-halved', color: '#63b3ed',
        fields: [
            { key: 'tailscale_tailnet', label: 'Tailnet (ej. mi-empresa.com o nombre@gmail.com)', type: 'text' },
            { key: 'tailscale_token',   label: 'API Token (generado en tailscale.com/admin/settings/keys)', type: 'password' },
        ]
    },
    {
        id: 'snmp_trap', title: 'SNMP Trap Receiver', icon: 'fa-tower-cell', color: '#fbd38d',
        fields: [
            { key: 'snmp_trap_port', label: 'Puerto UDP para traps (default: 1620, requiere 162 con root)', type: 'text' },
        ]
    },
]


export default function Settings({ onToast, currentUser, onUserUpdate, onShowWizard }: Props) {
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
    const [users,       setUsers]       = useState<{ id: number; username: string; totp_enabled: boolean; role: string }[]>([])
    const [newUsername, setNewUsername] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [newUserRole, setNewUserRole] = useState<'admin' | 'readonly'>('admin')
    const [userLoading, setUserLoading] = useState(false)

    // ── Backup / Restore ──────────────────────────────────────
    const [restoring, setRestoring] = useState(false)

    // ── Push notifications ─────────────────────────────────────
    const [pushSupported, setPushSupported] = useState(false)
    const [pushSubscribed, setPushSubscribed] = useState(false)
    const [pushLoading, setPushLoading] = useState(false)

    // ── Audit log, sessions ────────────────────────────────────
    const [auditLog,      setAuditLog]      = useState<any[]>([])
    const [sessions,      setSessions]      = useState<{ token_hint: string; expires_at: number; token: string }[]>([])

    useEffect(() => {
        api.getSettings().then((s: any) => setValues(s as Record<string, string>)).catch(() => { })
        loadUsers()
        api.getAuditLog(50).then(r => setAuditLog(r.entries ?? [])).catch(() => {})
        api.getSessions().then(r => setSessions(r.sessions ?? [])).catch(() => {})
        // Check push notification support
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            setPushSupported(true)
            navigator.serviceWorker.register('/sw.js').then(reg => {
                reg.pushManager.getSubscription().then(sub => {
                    setPushSubscribed(!!sub)
                }).catch(() => {})
            }).catch(() => {})
        }
    }, [])

    const loadUsers = () => usersApi.list().then(r => setUsers(r.users)).catch(() => { })

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
            await usersApi.create(newUsername.trim(), newPassword, newUserRole)
            onToast('success', `✓ Usuario "${newUsername.trim()}" creado como ${newUserRole === 'readonly' ? 'solo lectura' : 'administrador'}`)
            setNewUsername(''); setNewPassword(''); setNewUserRole('admin')
            loadUsers()
        } catch (err: any) { onToast('error', err.message || 'Error al crear usuario') }
        finally { setUserLoading(false) }
    }

    const handleToggleRole = async (userId: number, currentRole: string) => {
        const newRole = currentRole === 'readonly' ? 'admin' : 'readonly'
        const label = newRole === 'readonly' ? 'solo lectura' : 'administrador'
        if (!confirm(`¿Cambiar rol a "${label}"?`)) return
        try {
            await usersApi.setRole(userId, newRole)
            onToast('success', `✓ Rol cambiado a ${label}`)
            loadUsers()
        } catch (err: any) { onToast('error', err.message || 'Error al cambiar rol') }
    }

    const handleDeleteUser = async (userId: number, username: string) => {
        if (!confirm(`¿Eliminar el usuario "${username}"?`)) return
        try {
            await usersApi.delete(userId)
            onToast('success', `Usuario "${username}" eliminado`)
            loadUsers()
        } catch (err: any) { onToast('error', err.message || 'Error al eliminar usuario') }
    }

    const handleBackup = () => {
        const t = localStorage.getItem('labdash_token') ?? ''
        const a = document.createElement('a')
        a.href = '/api/backup'
        // attach token via a hidden fetch → blob → link
        fetch('/api/backup', { headers: { Authorization: `Bearer ${t}` } })
            .then(r => r.blob())
            .then(blob => {
                const cd = undefined // filename comes from Content-Disposition
                void cd
                const url = URL.createObjectURL(blob)
                a.href = url
                a.download = `labdash-backup-${new Date().toISOString().slice(0, 10)}.json`
                a.click()
                URL.revokeObjectURL(url)
            })
            .catch(() => onToast('error', 'Error al descargar el backup'))
    }

    const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        e.target.value = ''
        if (!confirm(`¿Restaurar configuración desde "${file.name}"?\nEsto sobreescribirá los ajustes actuales. El diagrama y las reglas de alerta se fusionarán.`)) return
        setRestoring(true)
        try {
            const text = await file.text()
            const payload = JSON.parse(text)
            const r = await api.restore(payload)
            onToast('success', `✓ Restaurado: ${r.restored.join(', ') || 'nada nuevo'}`)
            // Reload settings
            api.getSettings().then((s: any) => setValues(s as Record<string, string>)).catch(() => {})
        } catch (err: any) {
            onToast('error', err.message || 'Error al restaurar — verifica que el archivo es válido')
        } finally { setRestoring(false) }
    }

    const handlePushToggle = async () => {
        setPushLoading(true)
        try {
            const reg = await navigator.serviceWorker.ready
            if (pushSubscribed) {
                const sub = await reg.pushManager.getSubscription()
                if (sub) {
                    const endpoint = sub.endpoint
                    await sub.unsubscribe()
                    await api.pushUnsubscribe(endpoint)
                }
                setPushSubscribed(false)
                onToast('success', 'Notificaciones desactivadas')
            } else {
                // Get VAPID key from backend
                const { key } = await api.pushVapidKey()
                if (!key) { onToast('error', 'VAPID key no disponible — recarga y vuelve a intentarlo'); return }
                // Convert URL-safe base64 to Uint8Array
                const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'))
                const appKey = new Uint8Array(raw.length)
                for (let i = 0; i < raw.length; i++) appKey[i] = raw.charCodeAt(i)
                const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey })
                const json = sub.toJSON()
                await api.pushSubscribe({
                    endpoint: json.endpoint!,
                    p256dh:   (json.keys as any).p256dh,
                    auth:     (json.keys as any).auth,
                })
                setPushSubscribed(true)
                onToast('success', '✓ Notificaciones push activadas')
            }
        } catch (err: any) {
            onToast('error', err.message || 'Error al gestionar notificaciones push')
        } finally { setPushLoading(false) }
    }

    const handleRevokeSession = async (token: string) => {
        if (!confirm('¿Revocar esta sesión?')) return
        try {
            await api.revokeSession(token)
            onToast('success', 'Sesión revocada')
            api.getSessions().then(r => setSessions(r.sessions ?? [])).catch(() => {})
        } catch (err: any) { onToast('error', err.message || 'Error al revocar sesión') }
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

            {/* ── Setup wizard ── */}
            {onShowWizard && (
                <div style={{ marginTop: 24, padding: '16px 20px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
                            <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--accent5)', marginRight: 8 }} />
                            Asistente de configuración
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            Vuelve a abrir el asistente paso a paso para configurar integraciones.
                        </div>
                    </div>
                    <button
                        className="btn btn-secondary"
                        onClick={onShowWizard}
                        style={{ flexShrink: 0, border: '1px solid rgba(183,148,246,0.35)', color: 'var(--accent5)', background: 'rgba(183,148,246,0.08)' }}
                    >
                        <i className="fa-solid fa-play" /> Abrir asistente
                    </button>
                </div>
            )}

            {/* ── Backup / Restore ── */}
            <div className="form-section" style={{ marginTop: 40 }}>
                <div className="form-section-title" style={{ color: 'var(--accent6)' }}>
                    <i className="fa-solid fa-box-archive" /> Backup y restauración
                </div>
                <div style={{
                    fontSize: 12, color: 'var(--muted)', marginBottom: 16, padding: '8px 12px',
                    background: 'rgba(252,129,129,0.06)', border: '1px solid rgba(252,129,129,0.2)',
                    borderRadius: 8, lineHeight: 1.7,
                }}>
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#fc8181', marginRight: 6 }} />
                    El backup contiene <strong style={{ color: 'var(--text)' }}>credenciales en texto plano</strong>.
                    Guárdalo en un lugar seguro y no lo compartas.
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleBackup}
                        style={{ border: '1px solid rgba(129,230,217,0.35)', color: 'var(--accent6)', background: 'rgba(129,230,217,0.08)' }}
                    >
                        <i className="fa-solid fa-download" /> Descargar backup (.json)
                    </button>
                    <label style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                        cursor: restoring ? 'not-allowed' : 'pointer', opacity: restoring ? 0.5 : 1,
                        border: '1px solid rgba(251,211,141,0.35)', color: 'var(--accent4)',
                        background: 'rgba(251,211,141,0.08)', transition: 'all .15s',
                    }}>
                        <i className={`fa-solid ${restoring ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
                        {restoring ? 'Restaurando…' : 'Importar backup'}
                        <input
                            type="file" accept=".json" style={{ display: 'none' }}
                            disabled={restoring}
                            onChange={handleRestore}
                        />
                    </label>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, lineHeight: 1.6 }}>
                    El backup incluye: todos los ajustes, diagrama de red y reglas de alerta.
                    Al restaurar, los ajustes se sobreescriben y las reglas se fusionan (no duplica).
                </p>
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

            {/* ── Push notifications ── */}
            {pushSupported && (
                <div className="form-section" style={{ marginTop: 24 }}>
                    <div className="form-section-title" style={{ color: '#b794f4' }}>
                        <i className="fa-solid fa-bell-ring" /> Notificaciones push del navegador
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
                        Recibe notificaciones del navegador cuando se dispare una alerta, incluso si la pestaña está en segundo plano.
                        Las notificaciones se envían a través de tu navegador — no requieren app móvil.
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button
                            onClick={handlePushToggle}
                            disabled={pushLoading}
                            style={{
                                border: `1px solid ${pushSubscribed ? 'rgba(252,129,129,0.4)' : 'rgba(183,148,244,0.4)'}`,
                                background: pushSubscribed ? 'rgba(252,129,129,0.08)' : 'rgba(183,148,244,0.08)',
                                color: pushSubscribed ? '#fc8181' : '#b794f4',
                                borderRadius: 8, padding: '8px 16px', cursor: 'pointer',
                                fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                            }}
                        >
                            <i className={`fa-solid ${pushLoading ? 'fa-spinner fa-spin' : pushSubscribed ? 'fa-bell-slash' : 'fa-bell'}`} />
                            {pushLoading ? 'Procesando…' : pushSubscribed ? 'Desactivar notificaciones' : 'Activar notificaciones'}
                        </button>
                        {pushSubscribed && (
                            <span style={{ fontSize: 12, color: '#68d391', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <i className="fa-solid fa-circle-check" /> Activas en este navegador
                            </span>
                        )}
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
                        Las notificaciones son por navegador y dispositivo. Actívalas en cada dispositivo donde quieras recibirlas.
                    </p>
                </div>
            )}

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
                            {users.map(u => {
                                const isReadonly = (u.role || 'admin') === 'readonly'
                                const isMe = u.id === currentUser?.id
                                const isAdmin = (currentUser?.role || 'admin') === 'admin'
                                return (
                                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
                                        <i className={`fa-solid ${isReadonly ? 'fa-user-clock' : 'fa-user-shield'}`} style={{ color: isReadonly ? '#fbd38d' : 'var(--accent)', fontSize: 14 }} />
                                        <span style={{ flex: 1, fontSize: 14, fontWeight: isMe ? 600 : 400 }}>
                                            {u.username}
                                            {isMe && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(tú)</span>}
                                        </span>
                                        {/* Role badge */}
                                        <span style={{
                                            fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 700,
                                            background: isReadonly ? 'rgba(251,211,141,0.12)' : 'rgba(99,179,237,0.12)',
                                            border: `1px solid ${isReadonly ? 'rgba(251,211,141,0.3)' : 'rgba(99,179,237,0.3)'}`,
                                            color: isReadonly ? '#fbd38d' : '#63b3ed',
                                        }}>
                                            {isReadonly ? 'Solo lectura' : 'Admin'}
                                        </span>
                                        {u.totp_enabled ? (
                                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(104,211,145,0.12)', border: '1px solid rgba(104,211,145,0.3)', color: '#68d391', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <i className="fa-solid fa-shield-halved" style={{ fontSize: 10 }} />2FA
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(150,150,150,0.1)', border: '1px solid rgba(150,150,150,0.2)', color: 'var(--muted)' }}>Sin 2FA</span>
                                        )}
                                        {!isMe && isAdmin && (
                                            <button onClick={() => handleToggleRole(u.id, u.role || 'admin')}
                                                title={isReadonly ? 'Promover a admin' : 'Cambiar a solo lectura'}
                                                style={{ background: 'none', border: `1px solid ${isReadonly ? 'rgba(99,179,237,0.3)' : 'rgba(251,211,141,0.3)'}`, borderRadius: 6, color: isReadonly ? '#63b3ed' : '#fbd38d', cursor: 'pointer', padding: '4px 10px', fontSize: 12 }}>
                                                <i className={`fa-solid ${isReadonly ? 'fa-arrow-up' : 'fa-arrow-down'}`} />
                                            </button>
                                        )}
                                        {!isMe && isAdmin && (
                                            <button onClick={() => handleDeleteUser(u.id, u.username)}
                                                style={{ background: 'none', border: '1px solid rgba(252,129,129,0.3)', borderRadius: 6, color: '#fc8181', cursor: 'pointer', padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                                                <i className="fa-solid fa-trash" />
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
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
                        <div className="form-group">
                            <label>Rol</label>
                            <select value={newUserRole} onChange={e => setNewUserRole(e.target.value as 'admin' | 'readonly')}
                                style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontSize: 13, width: '100%' }}>
                                <option value="admin">Administrador — acceso total</option>
                                <option value="readonly">Solo lectura — no puede modificar</option>
                            </select>
                        </div>
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={userLoading} style={{ marginTop: 8 }}>
                        <i className={`fa-solid ${userLoading ? 'fa-spinner fa-spin' : 'fa-user-plus'}`} />
                        {userLoading ? 'Creando…' : 'Crear usuario'}
                    </button>
                </form>
            </div>

            {/* ── Active sessions ── */}
            <div className="form-section" style={{ marginTop: 24 }}>
                <div className="form-section-title" style={{ color: 'var(--accent)' }}>
                    <i className="fa-solid fa-key" /> Sesiones activas
                </div>
                {sessions.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 13 }}>No hay sesiones activas.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {sessions.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10 }}>
                                <i className="fa-solid fa-shield-check" style={{ color: 'var(--accent)', fontSize: 14 }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)' }}>{s.token_hint}</div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                        Expira: {new Date(s.expires_at * 1000).toLocaleString('es-ES')}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRevokeSession(s.token)}
                                    style={{ background: 'none', border: '1px solid rgba(252,129,129,0.3)', borderRadius: 6, color: '#fc8181', cursor: 'pointer', padding: '4px 10px', fontSize: 12 }}
                                >
                                    <i className="fa-solid fa-ban" /> Revocar
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Audit log ── */}
            <div className="form-section" style={{ marginTop: 24 }}>
                <div className="form-section-title" style={{ color: 'var(--accent4)' }}>
                    <i className="fa-solid fa-scroll" /> Log de auditoría
                </div>
                {auditLog.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin entradas de auditoría.</p>
                ) : (
                    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {auditLog.map((e: any) => (
                            <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                                <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 70, marginTop: 1 }}>
                                    {new Date(e.ts * 1000).toLocaleTimeString('es-ES')}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--accent)', minWidth: 80 }}>{e.username}</span>
                                <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 80 }}>{e.action}</span>
                                <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, wordBreak: 'break-all' }}>{e.detail}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

        </div>
    )
}
