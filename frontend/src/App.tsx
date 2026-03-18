import { useEffect, useState, useCallback, Component, type ReactNode, type ErrorInfo } from 'react'

// ── Error boundary to catch render crashes and show them instead of blank page ──
interface EBState { error: Error | null }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
    constructor(props: { children: ReactNode }) {
        super(props)
        this.state = { error: null }
    }
    static getDerivedStateFromError(e: Error) { return { error: e } }
    componentDidCatch(e: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary]', e, info.componentStack)
    }
    render() {
        if (this.state.error) {
            return (
                <div style={{
                    padding: 32, fontFamily: 'monospace', color: '#fc8181',
                    background: 'rgba(252,129,129,0.08)', borderRadius: 12,
                    border: '1px solid rgba(252,129,129,0.3)', margin: 24,
                }}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                        ⚠ Error de renderizado — por favor copia esto y reporta el bug
                    </div>
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#fbd38d', margin: 0 }}>
                        {this.state.error.message}
                        {'\n\n'}
                        {this.state.error.stack}
                    </pre>
                    <button
                        onClick={() => this.setState({ error: null })}
                        style={{
                            marginTop: 16, padding: '6px 16px', borderRadius: 8,
                            background: 'rgba(252,129,129,0.2)', border: '1px solid rgba(252,129,129,0.4)',
                            color: '#fc8181', cursor: 'pointer', fontSize: 13,
                        }}
                    >
                        Reintentar
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
import SetupWizard from './pages/SetupWizard'
import Dashboard from './pages/Dashboard'
import Network from './pages/Network'
import Services from './pages/Services'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import Login from './pages/Login'
import ProxmoxPage from './pages/Proxmox'
import OPNsensePage from './pages/OPNsense'
import UnraidPage from './pages/Unraid'
import { GlobalSearch } from './components/GlobalSearch'
import { authApi, api, type CurrentUser, clearToken, setToken as storeToken } from './api'

type Tab = 'dashboard' | 'network' | 'proxmox' | 'opnsense' | 'unraid' | 'services' | 'notifications' | 'settings'
type AuthState = 'checking' | 'unauthenticated' | 'authenticated'

interface Toast { id: number; type: 'success' | 'error'; msg: string }

const TOKEN_KEY = 'labdash_token'

const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'dashboard',     icon: 'fa-gauge-high',      label: 'Dashboard'      },
    { id: 'proxmox',       icon: 'fa-cubes',            label: 'Proxmox'        },
    { id: 'opnsense',      icon: 'fa-shield-halved',    label: 'OPNsense'       },
    { id: 'unraid',        icon: 'fa-hard-drive',       label: 'Unraid'         },
    { id: 'network',       icon: 'fa-diagram-project',  label: 'Network'        },
    { id: 'services',      icon: 'fa-server',           label: 'Services'       },
    { id: 'notifications', icon: 'fa-bell',             label: 'Notificaciones' },
    { id: 'settings',      icon: 'fa-sliders',          label: 'Settings'       },
]

// Attach token to every API request
function setAuthHeaders(token: string | null) {
    const origFetch = window._origFetch ?? window.fetch
    window._origFetch = origFetch
        ; (window as any).fetch = (input: RequestInfo, init: RequestInit = {}) => {
            if (token && typeof input === 'string' && input.startsWith('/api/')) {
                init.headers = { ...init.headers as Record<string, string>, Authorization: `Bearer ${token}` }
            }
            return origFetch(input, init)
        }
}

export default function App() {
    const [authState, setAuthState] = useState<AuthState>('checking')
    const [token, setToken] = useState<string | null>(null)
    const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
    const [tab, setTab] = useState<Tab>('dashboard')
    const [toasts, setToasts] = useState<Toast[]>([])
    const [lightMode, setLightMode] = useState(() => localStorage.getItem('labdash_theme') === 'light')
    const [needsSetup, setNeedsSetup] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchData, setSearchData] = useState<{
        pvNodes: any[]; pvVMs: Record<string, any[]>;
        opnGateways: any[]; k8sNodes: any[]; unraidDisks: any[];
        services: { label: string; ok: boolean }[]
    }>({ pvNodes: [], pvVMs: {}, opnGateways: [], k8sNodes: [], unraidDisks: [], services: [] })

    useEffect(() => {
        document.documentElement.classList.toggle('light-mode', lightMode)
        localStorage.setItem('labdash_theme', lightMode ? 'light' : 'dark')
    }, [lightMode])

    const onToast = (type: 'success' | 'error', msg: string) => {
        const id = Date.now()
        setToasts(t => [...t, { id, type, msg }])
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
    }

    const refreshUser = async () => {
        try {
            const u = await authApi.me()
            setCurrentUser(u)
        } catch { }
    }

    // Check existing session on mount
    useEffect(() => {
        const saved = localStorage.getItem(TOKEN_KEY)
        if (!saved) { setAuthState('unauthenticated'); return }
        setAuthHeaders(saved)
        authApi.me()
            .then(u => {
                setToken(saved)
                setCurrentUser(u)
                setAuthState('authenticated')
            })
            .catch(() => {
                clearToken()
                setAuthState('unauthenticated')
            })
    }, [])

    // Ctrl+K global search
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault()
                setSearchOpen(o => !o)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [])

    // Fetch data for global search (lazy — only when authenticated)
    const loadSearchData = useCallback(async () => {
        try {
            const [nodesRes, vmsRes, gwRes, diskRes] = await Promise.allSettled([
                api.proxmoxNodes(),
                api.proxmoxVMs(),
                api.opnsenseGateways(),
                api.unraidDisks(),
            ])
            setSearchData(prev => ({
                ...prev,
                pvNodes: nodesRes.status === 'fulfilled' ? (nodesRes.value as any).nodes ?? [] : prev.pvNodes,
                pvVMs:   vmsRes.status   === 'fulfilled' ? (vmsRes.value as any).by_node ?? {}  : prev.pvVMs,
                opnGateways: gwRes.status === 'fulfilled' ? ((gwRes.value as any)?.items ?? (gwRes.value as any)?.data?.items ?? []) : prev.opnGateways,
                unraidDisks: diskRes.status === 'fulfilled' ? ((diskRes.value as any).disks ?? []) : prev.unraidDisks,
            }))
        } catch { }
    }, [])

    useEffect(() => {
        if (authState === 'authenticated') {
            loadSearchData()
            api.setupStatus().then(r => setNeedsSetup(r.needs_setup)).catch(() => {})
        }
    }, [authState, loadSearchData])

    const handleLoginSuccess = (newToken: string) => {
        storeToken(newToken)
        setToken(newToken)
        setAuthHeaders(newToken)
        setAuthState('authenticated')
        // Fetch user info after login
        authApi.me().then(u => setCurrentUser(u)).catch(() => { })
    }

    const handleLogout = async () => {
        if (token) {
            await fetch('/api/auth/logout', { method: 'POST' }).catch(() => { })
        }
        clearToken()
        setToken(null)
        setCurrentUser(null)
        setAuthHeaders(null)
        setAuthState('unauthenticated')
    }

    // ── Loading splash ────────────────────────────────────────
    if (authState === 'checking') {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
                <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
                    <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 28, marginBottom: 12 }} />
                    <p style={{ margin: 0, fontSize: 14 }}>Comprobando sesión…</p>
                </div>
            </div>
        )
    }

    // ── Login page ────────────────────────────────────────────
    if (authState === 'unauthenticated') {
        return <Login onLoginSuccess={handleLoginSuccess} />
    }

    // ── Main app ──────────────────────────────────────────────
    return (
        <>
            {/* First-run setup wizard */}
            {needsSetup && (
                <SetupWizard onDone={() => { setNeedsSetup(false); loadSearchData() }} />
            )}

            {/* Toasts */}
            <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {toasts.map(t => (
                    <div key={t.id} style={{
                        background: t.type === 'success' ? 'rgba(104,211,145,0.15)' : 'rgba(252,129,129,0.15)',
                        border: `1px solid ${t.type === 'success' ? 'rgba(104,211,145,0.5)' : 'rgba(252,129,129,0.5)'}`,
                        color: t.type === 'success' ? '#68d391' : '#fc8181',
                        borderRadius: 10, padding: '10px 16px', fontSize: 13,
                        display: 'flex', alignItems: 'center', gap: 8,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                        animation: 'slideIn 0.2s ease',
                    }}>
                        <i className={`fa-solid ${t.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`} />
                        {t.msg}
                    </div>
                ))}
            </div>

            {/* Header */}
            <header className="header">
                <div className="header-brand">
                    <i className="fa-solid fa-network-wired" style={{ color: 'var(--accent)', fontSize: 22 }} />
                    <div>
                        <span className="header-title">MXHOME</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', display: 'block', lineHeight: 1 }}>
                            Home Lab Infrastructure Dashboard
                        </span>
                    </div>
                </div>

                <nav className="header-nav">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            className={`nav-btn ${tab === t.id ? 'active' : ''}`}
                            onClick={() => setTab(t.id)}
                        >
                            <i className={`fa-solid ${t.icon}`} />
                            {t.label}
                        </button>
                    ))}
                </nav>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Global search button */}
                    <button
                        onClick={() => setSearchOpen(true)}
                        title="Búsqueda global (Ctrl+K)"
                        style={{
                            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                            borderRadius: 8, color: 'var(--muted)', cursor: 'pointer',
                            padding: '5px 12px', fontSize: 12,
                            display: 'flex', alignItems: 'center', gap: 8, transition: 'all .15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)' }}
                    >
                        <i className="fa-solid fa-magnifying-glass" style={{ fontSize: 11 }} />
                        <span>Buscar</span>
                        <kbd style={{ fontSize: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>Ctrl K</kbd>
                    </button>
                    {currentUser && (
                        <span style={{
                            fontSize: 12, color: 'var(--muted)',
                            background: currentUser.role === 'readonly' ? 'rgba(251,211,141,0.1)' : 'rgba(104,211,145,0.1)',
                            border: `1px solid ${currentUser.role === 'readonly' ? 'rgba(251,211,141,0.3)' : 'rgba(104,211,145,0.3)'}`,
                            borderRadius: 20, padding: '3px 12px', display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: currentUser.role === 'readonly' ? '#fbd38d' : '#68d391', display: 'inline-block' }} />
                            {currentUser.username}
                            {currentUser.role === 'readonly' && (
                                <i className="fa-solid fa-eye" style={{ fontSize: 10, color: '#fbd38d', marginLeft: 2 }} title="Solo lectura" />
                            )}
                            {currentUser.totp_enabled && (
                                <i className="fa-solid fa-shield-halved" style={{ fontSize: 10, color: 'var(--accent5)', marginLeft: 2 }} title="2FA activo" />
                            )}
                        </span>
                    )}
                    <button
                        onClick={() => setLightMode(l => !l)}
                        title={lightMode ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
                        style={{
                            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                            color: 'var(--muted)', cursor: 'pointer', padding: '5px 10px', fontSize: 13,
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s',
                        }}
                    >
                        <i className={`fa-solid ${lightMode ? 'fa-moon' : 'fa-sun'}`} />
                    </button>
                    <button
                        onClick={handleLogout}
                        title="Cerrar sesión"
                        style={{
                            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                            color: 'var(--muted)', cursor: 'pointer', padding: '5px 10px', fontSize: 13,
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fc8181'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(252,129,129,0.5)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                    >
                        <i className="fa-solid fa-right-from-bracket" />
                    </button>
                </div>
            </header>

            {/* Global Search */}
            <GlobalSearch
                open={searchOpen}
                onClose={() => setSearchOpen(false)}
                onNavigate={(t) => { setTab(t as Tab); setSearchOpen(false) }}
                pvNodes={searchData.pvNodes}
                pvVMs={searchData.pvVMs}
                opnGateways={searchData.opnGateways}
                k8sNodes={searchData.k8sNodes}
                unraidDisks={searchData.unraidDisks}
                services={searchData.services}
            />

            {/* Main content */}
            <ErrorBoundary>
                <main className="main-content">
                    {tab === 'dashboard'     && <Dashboard onToast={onToast} />}
                    {tab === 'proxmox'       && <ProxmoxPage onToast={onToast} />}
                    {tab === 'opnsense'      && <OPNsensePage onToast={onToast} />}
                    {tab === 'unraid'        && <UnraidPage onToast={onToast} />}
                    {tab === 'network'       && <Network onToast={onToast} />}
                    {tab === 'services'      && <Services onToast={onToast} />}
                    {tab === 'notifications' && <Notifications onToast={onToast} />}
                    {tab === 'settings'      && (
                        <Settings
                            onToast={onToast}
                            currentUser={currentUser}
                            onUserUpdate={refreshUser}
                            onShowWizard={() => setNeedsSetup(true)}
                        />
                    )}
                </main>
            </ErrorBoundary>
        </>
    )
}

// Extend window type for _origFetch
declare global { interface Window { _origFetch?: typeof fetch } }
