import { useEffect, useState } from 'react'
import { api, authApi, usersApi, type CurrentUser } from '../api'

interface Props {
    onToast: (t: 'success' | 'error', m: string) => void
    currentUser: CurrentUser | null
    onUserUpdate: () => void
}

const SECTIONS = [
    {
        id: 'proxmox', title: 'Proxmox VE', icon: 'fa-cubes', color: 'var(--accent)',
        fields: [
            { key: 'pve_url', label: 'URL (ej. https://192.168.1.7:8006)', type: 'text' },
            { key: 'pve_user', label: 'Usuario (ej. root@pam)', type: 'text' },
            { key: 'pve_pass', label: 'Contraseña', type: 'password' },
        ]
    },
    {
        id: 'opnsense', title: 'OPNsense', icon: 'fa-shield-halved', color: 'var(--accent3)',
        fields: [
            { key: 'opn_url', label: 'URL (ej. https://192.168.1.1)', type: 'text' },
            { key: 'opn_key', label: 'API Key', type: 'password' },
            { key: 'opn_secret', label: 'API Secret', type: 'password' },
        ]
    },
    {
        id: 'k8s', title: 'Kubernetes', icon: 'fa-dharmachakra', color: 'var(--accent2)',
        fields: [
            { key: 'k8s_url', label: 'API Server URL (vacío = in-cluster)', type: 'text' },
            { key: 'k8s_token', label: 'Bearer Token', type: 'password' },
        ]
    },
    {
        id: 'unraid', title: 'Unraid', icon: 'fa-server', color: 'var(--accent4)',
        fields: [
            { key: 'unraid_url', label: 'URL (ej. http://192.168.1.10)', type: 'text' },
            { key: 'unraid_key', label: 'API Key', type: 'password' },
        ]
    },
    {
        id: 'plex', title: 'Plex Media Server', icon: 'fa-film', color: 'var(--accent4)',
        fields: [
            { key: 'plex_url', label: 'URL (ej. http://192.168.1.10:32400)', type: 'text' },
            { key: 'plex_token', label: 'X-Plex-Token', type: 'password' },
        ]
    },
    {
        id: 'immich', title: 'Immich', icon: 'fa-images', color: 'var(--accent)',
        fields: [
            { key: 'immich_url', label: 'URL (ej. http://192.168.1.10:2283)', type: 'text' },
            { key: 'immich_key', label: 'API Key', type: 'password' },
        ]
    },
    {
        id: 'ha', title: 'Home Assistant', icon: 'fa-house-signal', color: 'var(--accent6)',
        fields: [
            { key: 'ha_url', label: 'URL (ej. http://homeassistant.local:8123)', type: 'text' },
            { key: 'ha_token', label: 'Long-Lived Access Token', type: 'password' },
            { key: 'ha_entities', label: 'Entity IDs (coma-separados, vacío = todos)', type: 'text' },
        ]
    },
    {
        id: 'snmp', title: 'SNMP (Switch)', icon: 'fa-sitemap', color: 'var(--accent2)',
        fields: [
            { key: 'snmp_host', label: 'IP del switch (ej. 192.168.1.2)', type: 'text' },
            { key: 'snmp_community', label: 'Community string (ej. public)', type: 'text' },
            { key: 'snmp_port', label: 'Puerto UDP (default: 161)', type: 'text' },
        ]
    },
]

export default function Settings({ onToast, currentUser, onUserUpdate }: Props) {
    // ── Integration settings state ────────────────────────────
    const [values, setValues] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState(false)

    // ── Change password state ─────────────────────────────────
    const [pwCurrent, setPwCurrent] = useState('')
    const [pwNew, setPwNew] = useState('')
    const [pwConfirm, setPwConfirm] = useState('')
    const [pwLoading, setPwLoading] = useState(false)

    // ── TOTP state ────────────────────────────────────────────
    const [totpLoading, setTotpLoading] = useState(false)
    const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null)
    const [totpCode, setTotpCode] = useState('')

    // ── Users state ───────────────────────────────────────────
    const [users, setUsers] = useState<{ id: number; username: string; totp_enabled: boolean }[]>([])
    const [newUsername, setNewUsername] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [userLoading, setUserLoading] = useState(false)

    useEffect(() => {
        api.getSettings().then((s: any) => setValues(s as Record<string, string>)).catch(() => { })
        loadUsers()
    }, [])

    const loadUsers = () => {
        usersApi.list().then(r => setUsers(r.users)).catch(() => { })
    }

    const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }))

    // ── Integration settings save ─────────────────────────────
    const handleSave = async () => {
        setSaving(true)
        try {
            await api.saveSettings(values)
            onToast('success', '✓ Configuración guardada. Los cachés se han invalidado.')
        } catch {
            onToast('error', 'Error al guardar la configuración')
        } finally { setSaving(false) }
    }

    // ── Change password ───────────────────────────────────────
    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (pwNew !== pwConfirm) {
            onToast('error', 'Las contraseñas nuevas no coinciden')
            return
        }
        if (pwNew.length < 6) {
            onToast('error', 'La contraseña debe tener al menos 6 caracteres')
            return
        }
        setPwLoading(true)
        try {
            await authApi.changePassword(pwCurrent, pwNew)
            onToast('success', '✓ Contraseña cambiada correctamente')
            setPwCurrent(''); setPwNew(''); setPwConfirm('')
        } catch (err: any) {
            onToast('error', err.message || 'Error al cambiar la contraseña')
        } finally { setPwLoading(false) }
    }

    // ── 2FA setup ─────────────────────────────────────────────
    const handleInitTotp = async () => {
        setTotpLoading(true)
        try {
            const data = await authApi.initTotp()
            setTotpSetup(data)
            setTotpCode('')
        } catch (err: any) {
            onToast('error', err.message || 'Error al iniciar 2FA')
        } finally { setTotpLoading(false) }
    }

    const handleEnableTotp = async (e: React.FormEvent) => {
        e.preventDefault()
        setTotpLoading(true)
        try {
            await authApi.enableTotp(totpCode)
            onToast('success', '✓ 2FA activado correctamente')
            setTotpSetup(null)
            setTotpCode('')
            onUserUpdate()
        } catch (err: any) {
            onToast('error', err.message || 'Código incorrecto')
        } finally { setTotpLoading(false) }
    }

    const handleDisableTotp = async () => {
        if (!confirm('¿Desactivar la autenticación 2FA? Tu cuenta quedará menos protegida.')) return
        setTotpLoading(true)
        try {
            await authApi.disableTotp()
            onToast('success', '2FA desactivado')
            setTotpSetup(null)
            onUserUpdate()
        } catch (err: any) {
            onToast('error', err.message || 'Error al desactivar 2FA')
        } finally { setTotpLoading(false) }
    }

    // ── User management ───────────────────────────────────────
    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newUsername.trim() || !newPassword) {
            onToast('error', 'Usuario y contraseña son obligatorios')
            return
        }
        setUserLoading(true)
        try {
            await usersApi.create(newUsername.trim(), newPassword)
            onToast('success', `✓ Usuario "${newUsername.trim()}" creado`)
            setNewUsername(''); setNewPassword('')
            loadUsers()
        } catch (err: any) {
            onToast('error', err.message || 'Error al crear usuario')
        } finally { setUserLoading(false) }
    }

    const handleDeleteUser = async (userId: number, username: string) => {
        if (!confirm(`¿Eliminar el usuario "${username}"? Esta acción no se puede deshacer.`)) return
        try {
            await usersApi.delete(userId)
            onToast('success', `Usuario "${username}" eliminado`)
            loadUsers()
        } catch (err: any) {
            onToast('error', err.message || 'Error al eliminar usuario')
        }
    }

    const qrUrl = totpSetup ? `/api/auth/totp-qr?uri=${encodeURIComponent(totpSetup.uri)}` : ''
    const totpEnabled = currentUser?.totp_enabled ?? false

    return (
        <div style={{ maxWidth: 900 }}>
            {/* ── Integration settings ── */}
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
                Las credenciales se guardan en SQLite (dentro del contenedor).
                Los valores marcados como <code style={{ fontFamily: 'JetBrains Mono' }}>***</code> ya están guardados — déjalos vacíos para mantenerlos.
            </p>

            {SECTIONS.map(sec => (
                <div key={sec.id} className="form-section">
                    <div className="form-section-title" style={{ color: sec.color }}>
                        <i className={`fa-solid ${sec.icon}`} />
                        {sec.title}
                    </div>
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
                </div>
            ))}

            <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                {saving ? 'Guardando…' : 'Guardar configuración'}
            </button>

            <div style={{ marginTop: 32, padding: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16 }}>
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

            {/* ── Security section ── */}
            <div className="form-section" style={{ marginTop: 40 }}>
                <div className="form-section-title" style={{ color: 'var(--accent5)' }}>
                    <i className="fa-solid fa-shield-halved" />
                    Seguridad — {currentUser?.username}
                </div>

                {/* Change password */}
                <div style={{ marginBottom: 32 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-key" style={{ color: 'var(--muted)' }} />
                        Cambiar contraseña
                    </div>
                    <form onSubmit={handleChangePassword}>
                        <div className="form-grid">
                            <div className="form-group">
                                <label>Contraseña actual</label>
                                <input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)}
                                    autoComplete="current-password" required />
                            </div>
                            <div className="form-group">
                                <label>Nueva contraseña</label>
                                <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)}
                                    autoComplete="new-password" required />
                            </div>
                            <div className="form-group">
                                <label>Confirmar nueva contraseña</label>
                                <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)}
                                    autoComplete="new-password" required />
                            </div>
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={pwLoading} style={{ marginTop: 8 }}>
                            <i className={`fa-solid ${pwLoading ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                            {pwLoading ? 'Guardando…' : 'Cambiar contraseña'}
                        </button>
                    </form>
                </div>

                {/* 2FA */}
                <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-mobile-screen-button" style={{ color: 'var(--muted)' }} />
                        Autenticación en dos pasos (2FA)
                        {totpEnabled ? (
                            <span style={{
                                fontSize: 11, padding: '2px 10px', borderRadius: 20,
                                background: 'rgba(104,211,145,0.15)', border: '1px solid rgba(104,211,145,0.4)',
                                color: '#68d391', marginLeft: 4,
                            }}>
                                <i className="fa-solid fa-check" style={{ marginRight: 4 }} />Activo
                            </span>
                        ) : (
                            <span style={{
                                fontSize: 11, padding: '2px 10px', borderRadius: 20,
                                background: 'rgba(252,129,129,0.1)', border: '1px solid rgba(252,129,129,0.3)',
                                color: '#fc8181', marginLeft: 4,
                            }}>
                                Inactivo
                            </span>
                        )}
                    </div>

                    {totpEnabled ? (
                        <div>
                            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                                Tu cuenta está protegida con 2FA. Al iniciar sesión necesitarás el código de tu app autenticadora.
                            </p>
                            <button
                                className="btn"
                                onClick={handleDisableTotp}
                                disabled={totpLoading}
                                style={{
                                    border: '1px solid rgba(252,129,129,0.4)',
                                    color: '#fc8181', background: 'rgba(252,129,129,0.08)',
                                }}
                            >
                                <i className={`fa-solid ${totpLoading ? 'fa-spinner fa-spin' : 'fa-shield-xmark'}`} />
                                Desactivar 2FA
                            </button>
                        </div>
                    ) : totpSetup ? (
                        // QR setup inline
                        <div>
                            <div style={{
                                background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.2)',
                                borderRadius: 12, padding: '12px 14px', marginBottom: 18, fontSize: 12.5,
                                color: 'var(--muted)', lineHeight: 1.6,
                            }}>
                                <i className="fa-solid fa-circle-info" style={{ color: 'var(--accent)', marginRight: 7 }} />
                                Escanea el QR con <strong style={{ color: 'var(--text)' }}>Google Authenticator</strong>,{' '}
                                <strong style={{ color: 'var(--text)' }}>Authy</strong> u otra app TOTP.
                                Luego introduce el código para confirmar.
                            </div>
                            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <div style={{
                                    display: 'inline-block', padding: 10, background: '#fff',
                                    borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                                }}>
                                    <img src={qrUrl} alt="QR 2FA" style={{ width: 180, height: 180, display: 'block' }} />
                                </div>
                                <div style={{ flex: 1, minWidth: 200 }}>
                                    <details style={{ marginBottom: 16 }}>
                                        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none' }}>
                                            <i className="fa-solid fa-key" style={{ marginRight: 6 }} />Clave manual
                                        </summary>
                                        <div style={{
                                            marginTop: 8, background: 'var(--bg)', border: '1px solid var(--border)',
                                            borderRadius: 8, padding: '8px 12px',
                                            fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                                            letterSpacing: '0.1em', wordBreak: 'break-all', color: 'var(--accent)',
                                            userSelect: 'all',
                                        }}>
                                            {totpSetup.secret}
                                        </div>
                                    </details>
                                    <form onSubmit={handleEnableTotp}>
                                        <div className="form-group" style={{ marginBottom: 12 }}>
                                            <label>Código de verificación</label>
                                            <input
                                                value={totpCode}
                                                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                                                placeholder="123456" maxLength={6} autoFocus
                                                style={{ letterSpacing: '0.4em', fontSize: 22, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button className="btn btn-primary" type="submit"
                                                disabled={totpLoading || totpCode.length < 6}>
                                                <i className={`fa-solid ${totpLoading ? 'fa-spinner fa-spin' : 'fa-check-double'}`} />
                                                {totpLoading ? 'Verificando…' : 'Activar 2FA'}
                                            </button>
                                            <button type="button" className="btn"
                                                onClick={() => { setTotpSetup(null); setTotpCode('') }}
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
                            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                                2FA no está activado. Actívalo para requerir un código adicional al iniciar sesión.
                            </p>
                            <button className="btn btn-primary" onClick={handleInitTotp} disabled={totpLoading}>
                                <i className={`fa-solid ${totpLoading ? 'fa-spinner fa-spin' : 'fa-shield-halved'}`} />
                                {totpLoading ? 'Preparando…' : 'Activar 2FA'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Users section ── */}
            <div className="form-section" style={{ marginTop: 24 }}>
                <div className="form-section-title" style={{ color: 'var(--accent2)' }}>
                    <i className="fa-solid fa-users" />
                    Usuarios
                </div>

                {/* User list */}
                <div style={{ marginBottom: 24 }}>
                    {users.length === 0 ? (
                        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Cargando usuarios…</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {users.map(u => (
                                <div key={u.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '10px 16px', background: 'var(--bg)',
                                    border: '1px solid var(--border)', borderRadius: 10,
                                }}>
                                    <i className="fa-solid fa-user" style={{ color: 'var(--muted)', fontSize: 14 }} />
                                    <span style={{ flex: 1, fontSize: 14, fontWeight: u.id === currentUser?.id ? 600 : 400 }}>
                                        {u.username}
                                        {u.id === currentUser?.id && (
                                            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(tú)</span>
                                        )}
                                    </span>
                                    {u.totp_enabled ? (
                                        <span style={{
                                            fontSize: 11, padding: '2px 8px', borderRadius: 20,
                                            background: 'rgba(104,211,145,0.12)', border: '1px solid rgba(104,211,145,0.3)',
                                            color: '#68d391', display: 'flex', alignItems: 'center', gap: 4,
                                        }}>
                                            <i className="fa-solid fa-shield-halved" style={{ fontSize: 10 }} />2FA
                                        </span>
                                    ) : (
                                        <span style={{
                                            fontSize: 11, padding: '2px 8px', borderRadius: 20,
                                            background: 'rgba(150,150,150,0.1)', border: '1px solid rgba(150,150,150,0.2)',
                                            color: 'var(--muted)',
                                        }}>
                                            Sin 2FA
                                        </span>
                                    )}
                                    {u.id !== currentUser?.id && (
                                        <button
                                            onClick={() => handleDeleteUser(u.id, u.username)}
                                            style={{
                                                background: 'none', border: '1px solid rgba(252,129,129,0.3)',
                                                borderRadius: 6, color: '#fc8181', cursor: 'pointer',
                                                padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5,
                                            }}
                                            title={`Eliminar ${u.username}`}
                                        >
                                            <i className="fa-solid fa-trash" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Add user form */}
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <i className="fa-solid fa-user-plus" style={{ color: 'var(--muted)' }} />
                    Añadir usuario
                </div>
                <form onSubmit={handleCreateUser}>
                    <div className="form-grid">
                        <div className="form-group">
                            <label>Nombre de usuario</label>
                            <input
                                type="text"
                                value={newUsername}
                                onChange={e => setNewUsername(e.target.value)}
                                placeholder="nuevo_usuario"
                                autoComplete="off"
                            />
                        </div>
                        <div className="form-group">
                            <label>Contraseña</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                autoComplete="new-password"
                            />
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
