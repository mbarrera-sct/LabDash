import { useState, useEffect, useCallback } from 'react'
import Dashboard from './pages/Dashboard'
import Network from './pages/Network'
import Services from './pages/Services'
import Settings from './pages/Settings'
import './index.css'

type Tab = 'dashboard' | 'network' | 'services' | 'settings'

interface Toast { id: number; type: 'success' | 'error'; msg: string }

export default function App() {
    const [tab, setTab] = useState<Tab>('dashboard')
    const [toasts, setToasts] = useState<Toast[]>([])

    const addToast = useCallback((type: 'success' | 'error', msg: string) => {
        const id = Date.now()
        setToasts(t => [...t, { id, type, msg }])
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }, [])

    const tabs: { id: Tab; icon: string; label: string }[] = [
        { id: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard' },
        { id: 'network', icon: 'fa-network-wired', label: 'Network' },
        { id: 'services', icon: 'fa-cubes-stacked', label: 'Services' },
        { id: 'settings', icon: 'fa-sliders', label: 'Settings' },
    ]

    return (
        <div className="app-shell">
            {/* Header */}
            <header className="app-header">
                <div className="logo">
                    <div className="logo-icon"><i className="fa-solid fa-server" /></div>
                    <div>
                        <h1>MX<span>HOME</span></h1>
                        <p>Home Lab Infrastructure Dashboard</p>
                    </div>
                </div>

                <nav className="nav-tabs">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            className={`nav-tab${tab === t.id ? ' active' : ''}`}
                            onClick={() => setTab(t.id)}
                        >
                            <i className={`fa-solid ${t.icon}`} />
                            {t.label}
                        </button>
                    ))}
                </nav>

                <div className="header-badges">
                    <div className="badge">
                        <span className="dot dot-green" />
                        MXHOME · 2026
                    </div>
                </div>
            </header>

            {/* Page content */}
            <main className="app-content">
                {tab === 'dashboard' && <Dashboard onToast={addToast} />}
                {tab === 'network' && <Network onToast={addToast} />}
                {tab === 'services' && <Services onToast={addToast} />}
                {tab === 'settings' && <Settings onToast={addToast} />}
            </main>

            {/* Toast notifications */}
            <div className="toast-container">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
                ))}
            </div>
        </div>
    )
}
