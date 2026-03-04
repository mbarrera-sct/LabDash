import { useState, useRef, useEffect } from "react"
import { authApi } from "../api"

interface Props {
    tempToken: string
    onAuthed: (token: string) => void
    onBack: () => void
}

export default function TotpVerify({ tempToken, onAuthed, onBack }: Props) {
    const [code, setCode] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { inputRef.current?.focus() }, [])

    function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
        const v = e.target.value.replace(/\D/g, "").slice(0, 6)
        setCode(v)
        if (v.length === 6) verify(v)
    }

    async function verify(c = code) {
        setError("")
        setLoading(true)
        try {
            const res = await authApi.verifyTotp(tempToken, c)
            onAuthed(res.token)
        } catch (e: any) {
            setError(e.message || "Código incorrecto")
            setCode("")
            inputRef.current?.focus()
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-screen">
            <div className="auth-card">
                <div className="auth-logo">
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🔐</div>
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Verificación 2FA</h2>
                    <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
                        Introduce el código de tu autenticador
                    </p>
                </div>

                <div className="auth-form">
                    <div className="auth-field" style={{ textAlign: "center" }}>
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
                        />
                        <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
                            El código se renueva cada 30 segundos
                        </p>
                    </div>

                    {error && (
                        <div className="auth-error">
                            <i className="fa-solid fa-triangle-exclamation" /> {error}
                        </div>
                    )}

                    <button className="auth-btn" onClick={() => verify()} disabled={loading || code.length < 6}>
                        {loading
                            ? <><i className="fa-solid fa-circle-notch fa-spin" /> Verificando…</>
                            : <><i className="fa-solid fa-check" /> Verificar</>}
                    </button>

                    <button className="auth-btn-ghost" onClick={onBack} disabled={loading}>
                        <i className="fa-solid fa-arrow-left" /> Volver
                    </button>
                </div>
            </div>
        </div>
    )
}
