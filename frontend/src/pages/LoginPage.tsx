import { useRef, useState } from 'react'
import { NoDyeLogo } from '../components/NoDyeLogo'
import { useAuth } from '../hooks/useAuth'

export function LoginPage() {
  const { signIn } = useAuth()
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const email = emailRef.current?.value.trim() ?? ''
    const password = passwordRef.current?.value ?? ''
    const err = await signIn(email, password)
    if (err) {
      setError(err)
      setBusy(false)
    }
    // On success, App.tsx redirects to /patients via session state change.
  }

  return (
    <div className="login-page">
      {/* ── Left panel ── */}
      <aside className="login-aside">
        <div className="login-aside__grid" aria-hidden="true" />

        <div>
          <NoDyeLogo size={36} color="#F5F2EB" />
          <h1 className="login-aside__title" style={{ marginTop: '2rem' }}>
            Contrast-free MRI enhancement
          </h1>
          <p className="login-aside__lede">
            Synthetic T1CE volumes from T1 input using a validated deep-learning
            generator. No gadolinium. No patient risk.
          </p>
        </div>

        <div style={{ marginTop: '3rem' }}>
          <p
            className="small"
            style={{ marginTop: '1rem', color: 'var(--teal-300)', maxWidth: '38ch' }}
          >
            Access is restricted to pre-authorised hospital accounts. Contact
            your system administrator to request credentials.
          </p>
        </div>
      </aside>

      {/* ── Right panel ── */}
      <div className="login-main">
        <div className="login-card fade-in">
          <div className="login-card__logo">
            <NoDyeLogo size={30} color="var(--teal-700)" />
          </div>

          <h1>Sign in</h1>
          <p className="muted small" style={{ marginTop: '0.35rem' }}>
            Use your hospital account credentials.
          </p>

          <form onSubmit={handleSubmit} noValidate style={{ marginTop: '1.75rem' }}>
            <div className="stack" style={{ '--stack-gap': '1rem' } as React.CSSProperties}>
              <div className="field">
                <label className="field__label" htmlFor="email">
                  Email address
                </label>
                <input
                  id="email"
                  ref={emailRef}
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@hospital.org"
                  aria-invalid={error ? 'true' : undefined}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  ref={passwordRef}
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  aria-invalid={error ? 'true' : undefined}
                />
              </div>

              {error && (
                <div className="alert alert--error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn--primary btn--block btn--lg"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          <div className="login-card__foot">
            No self-registration. Accounts are provisioned by your hospital
            administrator via the Supabase dashboard.
          </div>
        </div>
      </div>
    </div>
  )
}
