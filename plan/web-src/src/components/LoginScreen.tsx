import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarRange, KeyRound, Mail, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { api, setStoredToken } from '../api.ts'
import type { UserPublic } from '../shared/types.ts'

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (user: UserPublic) => void }) {
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const normalizedEmail = email.trim().toLowerCase()

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (!normalizedEmail.endsWith('@vedaengg.com')) {
      setError('Use your @vedaengg.com work email address.')
      return
    }
    setLoading(true)
    try {
      const res = await api.requestOtpCode(normalizedEmail)
      setChallenge(res.challenge)
      setCode('')
      setCooldown(res.resendAfter || 60)
      setInfo(`6-digit sign-in code sent to ${normalizedEmail}. Expires in 10 minutes.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification code.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.verifyOtpCode(normalizedEmail, challenge, code.trim())
      setStoredToken(res.token)
      onAuthenticated(res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (cooldown > 0 || loading) return
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const res = await api.requestOtpCode(normalizedEmail)
      setChallenge(res.challenge)
      setCode('')
      setCooldown(res.resendAfter || 60)
      setInfo(`Sent a fresh 6-digit code to ${normalizedEmail}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="brand-mark">FP</div>
            <div>
              <div className="brand-title" style={{ fontSize: 17 }}>
                ForgePlan MES · Veda Engineering
              </div>
              <div className="brand-subtitle">
                Heavy Fabrication &amp; Equipment Production Control
              </div>
            </div>
          </div>

          <h1>
            Unified Manufacturing Plan, OTM Register &amp; Shop-Floor Execution
          </h1>
          <p>
            Purpose-built from your Manufacturing Monthly Plan workbook. Manage Masters, track
            100+ OTM equipment items, log daily shop-floor progress, inspect monthly Gantt
            schedules, and monitor MIS cost-per-kg in real time.
          </p>

          <div className="hero-metrics">
            <div className="hero-metric-box">
              <div className="hero-metric-num">49</div>
              <div className="hero-metric-lbl">Registered Customer Projects</div>
            </div>
            <div className="hero-metric-box">
              <div className="hero-metric-num">120.8 T</div>
              <div className="hero-metric-lbl">Tracked OTM Equipment Weight</div>
            </div>
            <div className="hero-metric-box">
              <div className="hero-metric-num">2-Way</div>
              <div className="hero-metric-lbl">Live .XLSX Import &amp; Export</div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--sidebar-muted)' }}>
          Veda Engineering Pvt. Ltd. · Staff Access via verified @vedaengg.com email OTP
        </div>
      </section>

      <main className="login-form-pane">
        <div className="login-box">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {challenge ? 'Enter Verification Code' : 'Sign in with Veda Email'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {challenge
                ? `Check ${normalizedEmail} for your one-time 6-digit code.`
                : 'Sign in with your @vedaengg.com work email — same OTP sign-in as Team Workboard.'}
            </p>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                background: 'var(--st-delayed-bg)',
                color: 'var(--st-delayed-fg)',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          {info && !error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                background: 'var(--st-completed-bg)',
                color: 'var(--st-completed-fg)',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {info}
            </div>
          )}

          {!challenge ? (
            <form onSubmit={handleRequestCode} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div className="field-group">
                <label className="field-label" htmlFor="login-email">
                  Veda Work Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  className="input-control"
                  placeholder="name@vedaengg.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <button
                id="login-submit-btn"
                type="submit"
                className="btn btn-primary"
                style={{ height: 38, marginTop: 4 }}
                disabled={loading}
              >
                <Mail size={15} />
                {loading ? 'Sending code...' : 'Send 6-Digit Sign-In Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div className="field-group">
                <label className="field-label" htmlFor="login-code">
                  6-Digit Verification Code
                </label>
                <input
                  id="login-code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="input-control mono"
                  style={{ fontSize: 18, letterSpacing: '0.25em', textAlign: 'center', height: 42 }}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  required
                />
              </div>

              <button
                id="verify-code-btn"
                type="submit"
                className="btn btn-primary"
                style={{ height: 38, marginTop: 4 }}
                disabled={loading || code.length !== 6}
              >
                <KeyRound size={15} />
                {loading ? 'Verifying...' : 'Verify & Open Workspace'}
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginTop: 2,
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setChallenge('')
                    setCode('')
                    setError('')
                    setInfo('')
                  }}
                  disabled={loading}
                >
                  <ArrowLeft size={13} /> Change email
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleResend}
                  disabled={loading || cooldown > 0}
                >
                  <RefreshCw size={13} />
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          )}

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                marginBottom: 10,
              }}
            >
              Workspace Access Levels
            </div>
            <div className="role-demo-list">
              <div className="role-demo-card" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ShieldCheck size={18} color="var(--brand-primary)" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      Admin / Management
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Full access · MIS Cost Ledger · Masters &amp; Roles · OTM · Daily Plan
                    </div>
                  </div>
                </div>
              </div>

              <div className="role-demo-card" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CalendarRange size={18} color="var(--brand-accent)" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      Production Planner
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Edit OTM-PROD &amp; Schedules · Daily Plan · Two-Way Excel Sync
                    </div>
                  </div>
                </div>
              </div>

              <div className="role-demo-card" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Wrench size={18} color="var(--st-completed-fg)" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      Shop-Floor Supervisor
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      Log Daily Shop-Floor Work · View OTM &amp; Monthly Gantt
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
