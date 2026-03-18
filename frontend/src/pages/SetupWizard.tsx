import { useState } from 'react'
import { api } from '../api'

interface Props {
    onDone: () => void
}

// ── Step definitions ──────────────────────────────────────────────────────────

interface StepField {
    key: string
    label: string
    type: 'text' | 'password'
    placeholder?: string
}

interface WizardStep {
    id: string
    title: string
    icon: string
    color: string
    description: string
    fields?: StepField[]
    multiKey?: 'k8s' | 'snmp'   // special multi-entry steps
    help: string[]               // bullet points shown in help accordion
}

const STEPS: WizardStep[] = [
    {
        id: 'welcome',
        title: 'Bienvenido a LabDash',
        icon: 'fa-network-wired',
        color: '#63b3ed',
        description: 'Vamos a configurar las integraciones con tu infraestructura. Puedes omitir cualquier servicio que no tengas desplegado y configurarlo más tarde en Settings.',
        help: [],
    },
    {
        id: 'proxmox',
        title: 'Proxmox VE',
        icon: 'fa-cubes',
        color: '#63b3ed',
        description: 'Hypervisor principal. Permite ver nodos, VMs, LXC y métricas en tiempo real.',
        fields: [
            { key: 'pve_url',  label: 'URL',      type: 'text',     placeholder: 'https://192.168.1.7:8006' },
            { key: 'pve_user', label: 'Usuario',   type: 'text',     placeholder: 'root@pam o root@pam!mitoken' },
            { key: 'pve_pass', label: 'Contraseña / API Token value', type: 'password' },
        ],
        help: [
            'Ve a Datacenter → Permissions → API Tokens → Add',
            'Usuario: root@pam (o el usuario deseado)',
            'Token ID: cualquier nombre, p.ej. labdash',
            'Desactiva "Privilege Separation" para acceso completo',
            'El campo "Usuario" admite el formato completo: root@pam!labdash',
            'El campo "Contraseña" es el valor del token generado',
        ],
    },
    {
        id: 'opnsense',
        title: 'OPNsense',
        icon: 'fa-shield-halved',
        color: '#f6ad55',
        description: 'Firewall/router. Permite ver gateways, interfaces, reglas, tabla ARP y mapa de red.',
        fields: [
            { key: 'opn_url',    label: 'URL',        type: 'text',     placeholder: 'https://192.168.1.1' },
            { key: 'opn_key',    label: 'API Key',     type: 'password' },
            { key: 'opn_secret', label: 'API Secret',  type: 'password' },
        ],
        help: [
            'Ve a System → Access → Users → edita tu usuario',
            'Baja hasta "API keys" → Add',
            'Descarga el archivo .txt con la key y secret',
            'Asegúrate de que el usuario tiene permisos de API',
        ],
    },
    {
        id: 'unraid',
        title: 'Unraid',
        icon: 'fa-server',
        color: '#68d391',
        description: 'Servidor NAS/Docker. Permite ver discos, contenedores y estado del sistema.',
        fields: [
            { key: 'unraid_url', label: 'URL',     type: 'text',     placeholder: 'http://192.168.1.10' },
            { key: 'unraid_key', label: 'API Key', type: 'password' },
        ],
        help: [
            'Ve a Settings → Management Access',
            'En la sección "API" activa la API y genera una clave',
            'La URL es la dirección de la interfaz web de Unraid',
        ],
    },
    {
        id: 'k8s',
        title: 'Kubernetes',
        icon: 'fa-dharmachakra',
        color: '#9f7aea',
        description: 'Clústeres de Kubernetes. Puedes añadir múltiples clústeres.',
        multiKey: 'k8s',
        help: [
            'Para obtener un token de servicio:',
            '  kubectl create serviceaccount labdash -n default',
            '  kubectl create clusterrolebinding labdash --clusterrole=view --serviceaccount=default:labdash',
            '  kubectl create token labdash -n default',
            'O copia el token del campo "token:" en tu kubeconfig (~/.kube/config)',
            'La URL es el API server: https://IP:6443',
            'Puedes dejar la URL vacía si el dashboard corre dentro del clúster (in-cluster)',
        ],
    },
    {
        id: 'snmp',
        title: 'SNMP (Switches)',
        icon: 'fa-sitemap',
        color: '#63b3ed',
        description: 'Monitorización de switches via SNMP. Puedes añadir múltiples switches.',
        multiKey: 'snmp',
        help: [
            'El protocolo SNMP v2c usa una "community string" como contraseña (por defecto: public)',
            'En tu switch, activa SNMP v2c y define la community string',
            'Para Cisco IOS: snmp-server community public RO',
            'Para switches con interfaz web: busca en la sección "Management" o "SNMP"',
            'El puerto por defecto es 161 (UDP)',
        ],
    },
    {
        id: 'plex',
        title: 'Plex Media Server',
        icon: 'fa-film',
        color: '#ed8936',
        description: 'Servidor de medios. Permite ver estadísticas y sesiones activas.',
        fields: [
            { key: 'plex_url',   label: 'URL',           type: 'text',     placeholder: 'http://192.168.1.10:32400' },
            { key: 'plex_token', label: 'X-Plex-Token',  type: 'password' },
        ],
        help: [
            'Inicia sesión en app.plex.tv',
            'Abre las herramientas de desarrollo del navegador (F12)',
            'Ve a cualquier petición de red a plex.tv y busca el header "X-Plex-Token"',
            'Alternativa: ve a plex.tv/users/account → clic en el enlace XML → copia el atributo authenticationToken',
        ],
    },
    {
        id: 'immich',
        title: 'Immich',
        icon: 'fa-images',
        color: '#63b3ed',
        description: 'Gestor de fotos auto-hospedado.',
        fields: [
            { key: 'immich_url', label: 'URL',     type: 'text',     placeholder: 'http://192.168.1.10:2283' },
            { key: 'immich_key', label: 'API Key', type: 'password' },
        ],
        help: [
            'Ve al icono de usuario → Account Settings',
            'Sección "API Keys" → New API Key',
            'Ponle un nombre (p.ej. LabDash) y copia la clave generada',
        ],
    },
    {
        id: 'ha',
        title: 'Home Assistant',
        icon: 'fa-house-signal',
        color: '#f6ad55',
        description: 'Automatización del hogar. Permite ver entidades y estados.',
        fields: [
            { key: 'ha_url',      label: 'URL',               type: 'text',     placeholder: 'http://homeassistant.local:8123' },
            { key: 'ha_token',    label: 'Long-Lived Token',  type: 'password' },
            { key: 'ha_entities', label: 'Entity IDs (coma-separados, vacío = todos)', type: 'text', placeholder: 'sensor.temp,switch.lamp' },
        ],
        help: [
            'Ve a tu perfil de usuario (clic en tu nombre en la esquina inferior izquierda)',
            'Baja hasta "Long-Lived Access Tokens"',
            'Clic en "Create Token", ponle un nombre y copia el token',
            'En Entity IDs puedes filtrar qué entidades ver (vacío = todas)',
        ],
    },
    {
        id: 'portainer',
        title: 'Portainer',
        icon: 'fa-cube',
        color: '#63b3ed',
        description: 'Gestión de contenedores Docker.',
        fields: [
            { key: 'portainer_url',   label: 'URL',     type: 'text',     placeholder: 'http://192.168.1.x:9000' },
            { key: 'portainer_token', label: 'API Key', type: 'password' },
        ],
        help: [
            'Ve a Settings → Users → selecciona tu usuario',
            'Sección "Access tokens" → Add access token',
            'Ponle un nombre (p.ej. LabDash) y copia la clave generada',
        ],
    },
    {
        id: 'uptime_kuma',
        title: 'Uptime Kuma',
        icon: 'fa-heart-pulse',
        color: '#68d391',
        description: 'Monitor de disponibilidad auto-hospedado.',
        fields: [
            { key: 'uptime_kuma_url',  label: 'URL',             type: 'text',     placeholder: 'http://192.168.1.x:3001' },
            { key: 'uptime_kuma_slug', label: 'Status page slug', type: 'text',     placeholder: 'default' },
        ],
        help: [
            'La URL es la dirección de tu instancia de Uptime Kuma',
            'El "slug" es la última parte de la URL de tu status page',
            'Ej: si la URL es http://kuma.local/status/milab, el slug es "milab"',
            'Si no tienes status page creada, créala en Status Pages → New Status Page',
        ],
    },
    {
        id: 'tailscale',
        title: 'Tailscale',
        icon: 'fa-shield-halved',
        color: '#63b3ed',
        description: 'VPN mesh. Permite ver dispositivos conectados a tu red Tailscale.',
        fields: [
            { key: 'tailscale_tailnet', label: 'Tailnet',    type: 'text',     placeholder: 'mi-empresa.com o nombre@gmail.com' },
            { key: 'tailscale_token',   label: 'API Token',  type: 'password' },
        ],
        help: [
            'Ve a tailscale.com/admin → Settings → Keys',
            'Crea un "API access token" (no un auth key)',
            'El Tailnet es el dominio de tu red: p.ej. mi-empresa.com o tu-email@gmail.com',
            'Puedes ver tu tailnet en tailscale.com/admin en la barra superior',
        ],
    },
]

// ── K8s cluster row component ─────────────────────────────────────────────────
function K8sEntry({ clusters, onChange }: {
    clusters: { name: string; url: string; token: string }[]
    onChange: (c: { name: string; url: string; token: string }[]) => void
}) {
    const [form, setForm] = useState({ name: '', url: '', token: '' })

    const add = () => {
        if (!form.name && !form.url) return
        onChange([...clusters, { ...form, name: form.name || `cluster-${clusters.length + 1}` }])
        setForm({ name: '', url: '', token: '' })
    }
    const remove = (i: number) => onChange(clusters.filter((_, j) => j !== i))

    return (
        <div>
            {clusters.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {clusters.map((c, i) => (
                        <span key={i} style={{
                            fontSize: 11, padding: '3px 10px', borderRadius: 20,
                            background: 'rgba(159,122,234,0.15)', border: '1px solid rgba(159,122,234,0.4)',
                            color: '#c4b5fd', display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <i className="fa-solid fa-dharmachakra" style={{ fontSize: 9 }} />
                            {c.name}
                            <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#c4b5fd', cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}>✕</button>
                        </span>
                    ))}
                </div>
            )}
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                {[
                    { f: 'name', label: 'Nombre del clúster', placeholder: 'produccion', type: 'text' },
                    { f: 'url',  label: 'API Server URL',     placeholder: 'https://192.168.1.x:6443', type: 'text' },
                    { f: 'token', label: 'Bearer Token',      placeholder: '', type: 'password' },
                ].map(({ f, label, placeholder, type }) => (
                    <div key={f} style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
                        <input
                            type={type}
                            value={(form as any)[f]}
                            onChange={e => setForm(prev => ({ ...prev, [f]: e.target.value }))}
                            placeholder={placeholder}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                ))}
                <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={add}>
                    <i className="fa-solid fa-plus" /> Añadir clúster
                </button>
            </div>
        </div>
    )
}

// ── SNMP target row component ─────────────────────────────────────────────────
function SnmpEntry({ targets, onChange }: {
    targets: { name: string; host: string; community: string; port: string }[]
    onChange: (t: { name: string; host: string; community: string; port: string }[]) => void
}) {
    const [form, setForm] = useState({ name: '', host: '', community: 'public', port: '161' })

    const add = () => {
        if (!form.host) return
        onChange([...targets, { ...form, name: form.name || `switch-${targets.length + 1}` }])
        setForm({ name: '', host: '', community: 'public', port: '161' })
    }
    const remove = (i: number) => onChange(targets.filter((_, j) => j !== i))

    return (
        <div>
            {targets.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {targets.map((t, i) => (
                        <span key={i} style={{
                            fontSize: 11, padding: '3px 10px', borderRadius: 20,
                            background: 'rgba(99,179,237,0.15)', border: '1px solid rgba(99,179,237,0.4)',
                            color: '#63b3ed', display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <i className="fa-solid fa-sitemap" style={{ fontSize: 9 }} />
                            {t.name} ({t.host})
                            <button onClick={() => remove(i)} style={{ background: 'none', border: 'none', color: '#63b3ed', cursor: 'pointer', padding: 0, fontSize: 11, lineHeight: 1 }}>✕</button>
                        </span>
                    ))}
                </div>
            )}
            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
                {[
                    { f: 'name',      label: 'Nombre del switch',    placeholder: 'switch-planta1', type: 'text' },
                    { f: 'host',      label: 'IP del switch',         placeholder: '192.168.1.2', type: 'text' },
                    { f: 'community', label: 'Community string',      placeholder: 'public', type: 'text' },
                    { f: 'port',      label: 'Puerto UDP',            placeholder: '161', type: 'text' },
                ].map(({ f, label, placeholder, type }) => (
                    <div key={f} style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
                        <input
                            type={type}
                            value={(form as any)[f]}
                            onChange={e => setForm(prev => ({ ...prev, [f]: e.target.value }))}
                            placeholder={placeholder}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                        />
                    </div>
                ))}
                <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={add}>
                    <i className="fa-solid fa-plus" /> Añadir switch
                </button>
            </div>
        </div>
    )
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export default function SetupWizard({ onDone }: Props) {
    const [step, setStep]           = useState(0)
    const [allValues, setAllValues] = useState<Record<string, string>>({})
    const [fieldVals, setFieldVals] = useState<Record<string, string>>({})
    const [k8sClusters, setK8sClusters] = useState<{ name: string; url: string; token: string }[]>([])
    const [snmpTargets, setSnmpTargets] = useState<{ name: string; host: string; community: string; port: string }[]>([])
    const [saving, setSaving]       = useState(false)
    const [helpOpen, setHelpOpen]   = useState(false)

    const current = STEPS[step]
    const isLast  = step === STEPS.length - 1
    const isWelcome = step === 0

    const handleFieldChange = (key: string, val: string) => {
        setFieldVals(prev => ({ ...prev, [key]: val }))
    }

    const collectAndAdvance = (skip = false) => {
        if (!skip) {
            const newVals: Record<string, string> = { ...allValues }
            if (current.fields) {
                current.fields.forEach(f => {
                    if (fieldVals[f.key]) newVals[f.key] = fieldVals[f.key]
                })
            }
            if (current.multiKey === 'k8s' && k8sClusters.length > 0) {
                newVals['k8s_clusters'] = JSON.stringify(k8sClusters)
            }
            if (current.multiKey === 'snmp' && snmpTargets.length > 0) {
                newVals['snmp_targets'] = JSON.stringify(snmpTargets)
            }
            setAllValues(newVals)
        }
        setFieldVals({})
        setHelpOpen(false)
        if (isLast) {
            finish(skip ? allValues : { ...allValues, ...fieldVals })
        } else {
            setStep(s => s + 1)
        }
    }

    const finish = async (vals: Record<string, string>) => {
        setSaving(true)
        try {
            await api.setupComplete(vals)
            onDone()
        } catch {
            setSaving(false)
        }
    }

    const hasInput = () => {
        if (current.fields) return current.fields.some(f => fieldVals[f.key])
        if (current.multiKey === 'k8s') return k8sClusters.length > 0
        if (current.multiKey === 'snmp') return snmpTargets.length > 0
        return false
    }

    // Progress dots
    const totalSteps = STEPS.length

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
        }}>
            <div style={{
                width: '100%', maxWidth: 580,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                maxHeight: '92vh',
            }}>
                {/* Header */}
                <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 12,
                            background: `${current.color}18`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: `1px solid ${current.color}33`, flexShrink: 0,
                        }}>
                            <i className={`fa-solid ${current.icon}`} style={{ color: current.color, fontSize: 16 }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{current.title}</div>
                            {!isWelcome && (
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                    Paso {step} de {totalSteps - 1}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ display: 'flex', gap: 4 }}>
                        {STEPS.map((_, i) => (
                            <div key={i} style={{
                                flex: 1, height: 3, borderRadius: 2,
                                background: i <= step ? current.color : 'rgba(255,255,255,0.1)',
                                transition: 'background 0.3s',
                            }} />
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
                    <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                        {current.description}
                    </p>

                    {/* Fields */}
                    {current.fields && (
                        <div style={{ marginBottom: 16 }}>
                            {current.fields.map(f => (
                                <div key={f.key} className="form-group" style={{ marginBottom: 12 }}>
                                    <label style={{ fontSize: 12, color: 'var(--muted)' }}>{f.label}</label>
                                    <input
                                        type={f.type}
                                        value={fieldVals[f.key] ?? ''}
                                        onChange={e => handleFieldChange(f.key, e.target.value)}
                                        placeholder={f.placeholder}
                                        style={{ width: '100%', boxSizing: 'border-box' }}
                                        autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Multi-K8s */}
                    {current.multiKey === 'k8s' && (
                        <K8sEntry clusters={k8sClusters} onChange={setK8sClusters} />
                    )}

                    {/* Multi-SNMP */}
                    {current.multiKey === 'snmp' && (
                        <SnmpEntry targets={snmpTargets} onChange={setSnmpTargets} />
                    )}

                    {/* Help accordion */}
                    {current.help.length > 0 && (
                        <div style={{ marginTop: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <button
                                onClick={() => setHelpOpen(o => !o)}
                                style={{
                                    width: '100%', padding: '10px 14px',
                                    background: 'rgba(255,255,255,0.03)', border: 'none',
                                    color: 'var(--muted)', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                                    textAlign: 'left',
                                }}
                            >
                                <i className={`fa-solid fa-circle-question`} style={{ color: '#63b3ed', fontSize: 13 }} />
                                ¿Cómo obtener las credenciales?
                                <i className={`fa-solid fa-chevron-${helpOpen ? 'up' : 'down'}`} style={{ fontSize: 10, marginLeft: 'auto' }} />
                            </button>
                            {helpOpen && (
                                <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                                        {current.help.map((line, i) => (
                                            <li key={i} style={{
                                                fontSize: 12, color: 'var(--muted)', lineHeight: 1.7,
                                                paddingLeft: line.startsWith('  ') ? 16 : 0,
                                                display: 'flex', gap: 6, alignItems: 'flex-start',
                                            }}>
                                                {!line.startsWith('  ') && (
                                                    <i className="fa-solid fa-circle-dot" style={{ color: '#63b3ed', fontSize: 7, marginTop: 5, flexShrink: 0 }} />
                                                )}
                                                <span style={{ fontFamily: line.includes('kubectl') || line.includes('~') ? 'JetBrains Mono, monospace' : 'inherit', fontSize: line.includes('kubectl') || line.includes('~') ? 11 : 12 }}>
                                                    {line.trim()}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--border)' }}>
                    {isWelcome ? (
                        <button
                            className="btn btn-primary"
                            style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 0' }}
                            onClick={() => setStep(1)}
                        >
                            <i className="fa-solid fa-arrow-right" />
                            Empezar configuración
                        </button>
                    ) : isLast ? (
                        <button
                            className="btn btn-primary"
                            style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: '10px 0' }}
                            onClick={() => finish(allValues)}
                            disabled={saving}
                        >
                            {saving
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Guardando…</>
                                : <><i className="fa-solid fa-check" /> ¡Listo! Ir al dashboard</>}
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                className="btn btn-secondary"
                                style={{ flex: 1, justifyContent: 'center' }}
                                onClick={() => collectAndAdvance(true)}
                            >
                                <i className="fa-solid fa-forward" /> Omitir
                            </button>
                            <button
                                className="btn btn-primary"
                                style={{ flex: 2, justifyContent: 'center' }}
                                onClick={() => collectAndAdvance(false)}
                                disabled={!hasInput()}
                            >
                                <i className="fa-solid fa-floppy-disk" />
                                {hasInput() ? 'Guardar y continuar' : 'Continuar →'}
                            </button>
                        </div>
                    )}

                    <div style={{ textAlign: 'center', marginTop: 12 }}>
                        <button
                            onClick={() => finish(allValues)}
                            disabled={saving}
                            style={{
                                background: 'none', border: 'none', color: 'var(--muted)',
                                cursor: 'pointer', fontSize: 11, textDecoration: 'underline',
                            }}
                        >
                            Configurar más tarde (ir al dashboard)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
