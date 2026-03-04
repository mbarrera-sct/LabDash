import { useState, useEffect, useRef } from "react"
import { authApi } from "../api"

interface Props {
    tempToken: string
    onAuthed: (token: string) => void
    onBack: () => void
}

interface SetupData { secret: string; uri: string; username: string }

export default function TotpSetup({ tempToken, onAuthed, onBack }: Props) {
    const [data, setData] = useState<SetupData | null>(null)
    const [code, setCode] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        authApi.getTotpSetup(tempToken)
            .then(setData)
            .catch(e => setError(e.message))
    }, [tempToken])

    function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
        const v = e.target.value.replace(/\D/g, "").slice(0, 6)
        setCode(v)
        if (v.length === 6) confirm(v)
    }

    async function confirm(c = code) {
        setError("")
        setLoading(true)
        try {
            const res = await authApi.confirmTotpSetup(tempToken, c)
            onAuthed(res.token)
        } catch (e: any) {
            setError(e.message || "Código incorrecto")
            setCode("")
            inputRef.current?.focus()
        } finally {
            setLoading(false)
        }
    }

    function copySecret() {
        if (!data) return
        navigator.clipboard.writeText(data.secret)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="auth-screen">
            <div className="auth-card" style={{ maxWidth: 480 }}>
                <div className="auth-logo">
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🛡️</div>
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Configura 2FA</h2>
                    <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                        Primera vez — añade tu cuenta al autenticador
                    </p>
                </div>

                {!data && !error && (
                    <div style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                        <i className="fa-solid fa-circle-notch fa-spin" /> Generando…
                    </div>
                )}

                {error && !data && (
                    <div className="auth-error"><i className="fa-solid fa-triangle-exclamation" /> {error}</div>
                )}

                {data && (
                    <div className="auth-form">
                        {/* Steps */}
                        <div className="totp-steps">
                            <div className="totp-step">
                                <div className="step-num">1</div>
                                <p>Abre <strong>Google Authenticator</strong>, <strong>Authy</strong> o similar</p>
                            </div>
                            <div className="totp-step">
                                <div className="step-num">2</div>
                                <div style={{ flex: 1 }}>
                                    <p style={{ marginBottom: 10 }}>
                                        Toca <strong>+</strong> → <em>Introducir clave de configuración</em>
                                    </p>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <div>
                                            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Cuenta</div>
                                            <code className="totp-code-box">{data.username}@LabDash</code>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Clave secreta</div>
                                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                <code className="totp-code-box" style={{ flex: 1, letterSpacing: 2 }}>
                                                    {data.secret}
                                                </code>
                                                <button className="icon-btn" onClick={copySecret} title="Copiar">
                                                    <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`}
                                                        style={{ color: copied ? "var(--accent2)" : undefined }} />
                                                </button>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                                            Tipo: <strong style={{ color: "var(--text)" }}>Basado en tiempo (TOTP)</strong>
                                        </div>
                                    </div>
                                    <div style={{ marginTop: 10 }}>
                                        <a
                                            href={data.uri}
                                            style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}
                                            title="Abrir en autenticador"
                                        >
                                            <i className="fa-solid fa-qrcode" /> Abrir URI en autenticador
                                        </a>
                                    </div>
                                </div>
                            </div>
                            <div className="totp-step">
                                <div className="step-num">3</div>
                                <div style={{ flex: 1 }}>
                                    <p style={{ marginBottom: 10 }}>Introduce el código de 6 dígitos para confirmar</p>
                                    <input
                                        ref={inputRef}
                                        className="auth-input totp-input"
                                        type="text"
                                        inputMode="numeric"
                                        pattern="\d{6}"
                                        maxLength={6}
                                        value={code}
                                        onChange={handleInput}
                                        placeholder="000000"
                                        disabled={loading}
                                        autoFocus
                                    />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="auth-error">
                                <i className="fa-solid fa-triangle-exclamation" /> {error}
                            </div>
                        )}

                        <button className="auth-btn" onClick={() => confirm()} disabled={loading || code.length < 6}>
                            {loading
                                ? <><i className="fa-solid fa-circle-notch fa-spin" /> Activando…</>
                                : <><i className="fa-solid fa-shield-halved" /> Activar 2FA</>}
                        </button>

                        <button className="auth-btn-ghost" onClick={onBack} disabled={loading}>
                            <i className="fa-solid fa-arrow-left" /> Volver
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
