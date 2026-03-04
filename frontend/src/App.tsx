import { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Network from './pages/Network'
import Services from './pages/Services'
import Settings from './pages/Settings'
import Login from './pages/Login'

type Tab = 'dashboard' | 'network' | 'services' | 'settings'
type AuthState = 'checking' | 'unauthenticated' | 'authenticated'

interface Toast { id: number; type: 'success' | 'error'; msg: string }

const TOKEN_KEY = 'labdash_token'

const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard' },
    { id: 'network', icon: 'fa-diagram-project', label: 'Network' },
    { id: 'services', icon: 'fa-server', label: 'Services' },
    { id: 'settings', icon: 'fa-sliders', label: 'Settings' },
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
    const [tab, setTab] = useState<Tab>('dashboard')
    const [toasts, setToasts] = useState<Toast[]>([])

    const onToast = (type: 'success' | 'error', msg: string) => {
        const id = Date.now()
        setToasts(t => [...t, { id, type, msg }])
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
    }

    // Check existing session on mount
    useEffect(() => {
        const saved = localStorage.getItem(TOKEN_KEY)
        if (!saved) { setAuthState('unauthenticated'); return }
        setAuthHeaders(saved)
        fetch('/api/auth/me')
            .then(r => {
                if (r.ok) { setToken(saved); setAuthState('authenticated') }
                else { localStorage.removeItem(TOKEN_KEY); setAuthState('unauthenticated') }
            })
            .catch(() => { localStorage.removeItem(TOKEN_KEY); setAuthState('unauthenticated') })
    }, [])

    const handleLoginSuccess = (newToken: string) => {
        localStorage.setItem(TOKEN_KEY, newToken)
        setToken(newToken)
        setAuthHeaders(newToken)
        setAuthState('authenticated')
    }

    const handleLogout = async () => {
        if (token) {
            await fetch('/api/auth/logout', { method: 'POST' }).catch(() => { })
        }
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
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
                    <span style={{
                        fontSize: 12, color: 'var(--muted)',
                        background: 'rgba(104,211,145,0.1)', border: '1px solid rgba(104,211,145,0.3)',
                        borderRadius: 20, padding: '3px 12px', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#68d391', display: 'inline-block' }} />
                        MXHOME · 2026
                    </span>
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

            {/* Main content */}
            <main className="main-content">
                {tab === 'dashboard' && <Dashboard onToast={onToast} />}
                {tab === 'network' && <Network onToast={onToast} />}
                {tab === 'services' && <Services onToast={onToast} />}
                {tab === 'settings' && <Settings onToast={onToast} />}
            </main>
        </>
    )
}

// Extend window type for _origFetch
declare global { interface Window { _origFetch?: typeof fetch } }
