import { useState } from 'react'

interface Props {
    onLoginSuccess: (token: string) => void
}

type Step = 'login' | 'totp-setup' | 'totp-verify'

interface SetupData { secret: string; uri: string; username: string }

export default function Login({ onLoginSuccess }: Props) {
    const [step, setStep] = useState<Step>('login')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [totpCode, setTotpCode] = useState('')
    const [tempToken, setTempToken] = useState('')
    const [setup, setSetup] = useState<SetupData | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // ── Step 1: Password ──────────────────────────────────────
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true); setError('')
        try {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })
            const d = await r.json()
            if (!r.ok) throw new Error(d.detail ?? 'Error')
            setTempToken(d.temp_token)

            if (d.needs_totp_setup) {
                const sr = await fetch('/api/auth/totp-setup', {
                    headers: { 'X-Temp-Token': d.temp_token },
                })
                const sd = await sr.json()
                if (!sr.ok) throw new Error(sd.detail ?? 'Error')
                setSetup(sd)
                setStep('totp-setup')
            } else {
                setStep('totp-verify')
            }
        } catch (err: any) { setError(err.message) }
        finally { setLoading(false) }
    }

    // ── Step 2a: First-time setup confirm ─────────────────────
    const handleSetupConfirm = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true); setError('')
        try {
            const r = await fetch('/api/auth/totp-setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ temp_token: tempToken, code: totpCode }),
            })
            const d = await r.json()
            if (!r.ok) throw new Error(d.detail ?? 'Código incorrecto')
            onLoginSuccess(d.token)
        } catch (err: any) { setError(err.message) }
        finally { setLoading(false) }
    }

    // ── Step 2b: Verify TOTP ───────────────────────────────────
    const handleTotpVerify = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true); setError('')
        try {
            const r = await fetch('/api/auth/verify-totp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ temp_token: tempToken, code: totpCode }),
            })
            const d = await r.json()
            if (!r.ok) throw new Error(d.detail ?? 'Código incorrecto')
            onLoginSuccess(d.token)
        } catch (err: any) { setError(err.message) }
        finally { setLoading(false) }
    }

    const qrUrl = setup ? `/api/auth/totp-qr?uri=${encodeURIComponent(setup.uri)}` : ''

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)',
            backgroundImage: 'radial-gradient(ellipse at 50% 20%, rgba(99,179,237,0.06) 0%, transparent 70%)',
        }}>
            <div style={{
                width: 420, background: 'var(--bg2)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '40px 36px',
                boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}>
                {/* Logo */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{
                        width: 60, height: 60, borderRadius: '50%',
                        background: 'linear-gradient(135deg, var(--accent), var(--accent5))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 14px',
                        boxShadow: '0 0 30px rgba(99,179,237,0.3)',
                    }}>
                        <i className="fa-solid fa-network-wired" style={{ fontSize: 24, color: '#fff' }} />
                    </div>
                    <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>MXHOME</h1>
                    <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                        {step === 'login' && 'Accede a tu infraestructura'}
                        {step === 'totp-setup' && 'Configura la autenticación 2FA'}
                        {step === 'totp-verify' && 'Verificación en dos pasos'}
                    </p>
                </div>

                {/* Error */}
                {error && (
                    <div style={{
                        background: 'rgba(252,129,129,0.12)', border: '1px solid rgba(252,129,129,0.4)',
                        borderRadius: 10, padding: '10px 14px', marginBottom: 18,
                        color: '#fc8181', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <i className="fa-solid fa-circle-exclamation" /> {error}
                    </div>
                )}

                {/* ── Login form ── */}
                {step === 'login' && (
                    <form onSubmit={handleLogin}>
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label>
                                <i className="fa-solid fa-user" style={{ marginRight: 7, color: 'var(--accent)' }} />
                                Usuario
                            </label>
                            <input value={username} onChange={e => setUsername(e.target.value)}
                                placeholder="admin" autoFocus autoComplete="username" required />
                        </div>
                        <div className="form-group" style={{ marginBottom: 24 }}>
                            <label>
                                <i className="fa-solid fa-lock" style={{ marginRight: 7, color: 'var(--accent)' }} />
                                Contraseña
                            </label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••" autoComplete="current-password" required />
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={loading}
                            style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 15 }}>
                            {loading
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Accediendo…</>
                                : <><i className="fa-solid fa-right-to-bracket" /> Entrar</>}
                        </button>
                    </form>
                )}

                {/* ── TOTP Setup (QR) ── */}
                {step === 'totp-setup' && setup && (
                    <form onSubmit={handleSetupConfirm}>
                        <div style={{
                            background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.2)',
                            borderRadius: 12, padding: '12px 14px', marginBottom: 18,
                            fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6,
                        }}>
                            <i className="fa-solid fa-shield-halved" style={{ color: 'var(--accent)', marginRight: 7 }} />
                            Primera vez — escanea el QR con <strong style={{ color: 'var(--text)' }}>Google Authenticator</strong>,{' '}
                            <strong style={{ color: 'var(--text)' }}>Authy</strong> o cualquier app TOTP.
                        </div>

                        {/* QR code */}
                        <div style={{ textAlign: 'center', marginBottom: 18 }}>
                            <div style={{
                                display: 'inline-block', padding: 10, background: '#fff',
                                borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                            }}>
                                <img src={qrUrl} alt="QR 2FA" style={{ width: 200, height: 200, display: 'block' }} />
                            </div>
                        </div>

                        {/* Manual key */}
                        <details style={{ marginBottom: 18 }}>
                            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none' }}>
                                <i className="fa-solid fa-key" style={{ marginRight: 6 }} />Clave manual
                            </summary>
                            <div style={{
                                marginTop: 8, background: 'var(--bg)', border: '1px solid var(--border)',
                                borderRadius: 8, padding: '8px 12px',
                                fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                                letterSpacing: '0.1em', wordBreak: 'break-all', color: 'var(--accent)',
                                userSelect: 'all', cursor: 'text',
                            }}>
                                {setup.secret}
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                                Issuer: LabDash · Account: {setup.username}
                            </p>
                        </details>

                        <div className="form-group" style={{ marginBottom: 20 }}>
                            <label>
                                <i className="fa-solid fa-mobile-screen-button" style={{ marginRight: 7, color: 'var(--accent5)' }} />
                                Código de verificación
                            </label>
                            <input value={totpCode}
                                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="123456" maxLength={6} autoFocus
                                style={{ letterSpacing: '0.4em', fontSize: 24, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}
                            />
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={loading || totpCode.length < 6}
                            style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 15 }}>
                            {loading
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Verificando…</>
                                : <><i className="fa-solid fa-check-double" /> Confirmar y entrar</>}
                        </button>
                    </form>
                )}

                {/* ── TOTP Verify (returning) ── */}
                {step === 'totp-verify' && (
                    <form onSubmit={handleTotpVerify}>
                        <div style={{
                            background: 'rgba(183,148,244,0.08)', border: '1px solid rgba(183,148,244,0.2)',
                            borderRadius: 12, padding: '12px 14px', marginBottom: 22,
                            fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6,
                        }}>
                            <i className="fa-solid fa-mobile-screen-button" style={{ color: 'var(--accent5)', marginRight: 7 }} />
                            Introduce el código de tu app para <strong style={{ color: 'var(--text)' }}>{username}</strong>.
                        </div>
                        <div className="form-group" style={{ marginBottom: 24 }}>
                            <label>Código 2FA</label>
                            <input value={totpCode}
                                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="123456" maxLength={6} autoFocus
                                style={{ letterSpacing: '0.5em', fontSize: 30, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}
                            />
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={loading || totpCode.length < 6}
                            style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 15 }}>
                            {loading
                                ? <><i className="fa-solid fa-spinner fa-spin" /> Verificando…</>
                                : <><i className="fa-solid fa-unlock-keyhole" /> Verificar y entrar</>}
                        </button>
                        <button type="button" onClick={() => { setStep('login'); setTotpCode(''); setError('') }}
                            style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
                            ← Volver
                        </button>
                    </form>
                )}

                <p style={{ textAlign: 'center', marginTop: 28, fontSize: 11, color: 'var(--muted)' }}>
                    MXHOME · LabDash v1.1
                </p>
            </div>
        </div>
    )
}
