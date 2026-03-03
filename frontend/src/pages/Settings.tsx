import { useEffect, useState } from 'react'
import { api } from '../api'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

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
]

export default function Settings({ onToast }: Props) {
    const [values, setValues] = useState<Record<string, string>>({})
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        api.getSettings().then((s: any) => setValues(s as Record<string, string>)).catch(() => { })
    }, [])

    const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }))

    const handleSave = async () => {
        setSaving(true)
        try {
            await api.saveSettings(values)
            onToast('success', '✓ Configuración guardada. Los cachés se han invalidado.')
        } catch {
            onToast('error', 'Error al guardar la configuración')
        } finally { setSaving(false) }
    }

    return (
        <div style={{ maxWidth: 900 }}>
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
        </div>
    )
}
