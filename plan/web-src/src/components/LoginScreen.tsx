import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CalendarRange,
  ExternalLink,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
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
      setError('Please enter your @vedaengg.com work email address.')
      return
    }
    setLoading(true)
    try {
      const res = await api.requestOtpCode(normalizedEmail)
      setChallenge(res.challenge)
      setCode('')
      setCooldown(res.resendAfter || 60)
      setInfo(`Sent a 6-digit verification code to ${normalizedEmail}. Valid for 10 minutes.`)
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="brand-mark">VEPL</div>
              <div>
                <div className="brand-title" style={{ fontSize: 16 }}>
                  Veda Engineering Pvt. Ltd.
                </div>
                <div className="brand-subtitle mono" style={{ fontSize: 10.5, letterSpacing: '0.08em' }}>
                  SINCE 1995 · MONTHLY PRODUCTION PLAN &amp; OTM CONTROL
                </div>
              </div>
            </div>

            <a className="vepl-portal-link" href="https://veplworks.com">
              <ArrowLeft size={13} /> veplworks.com
            </a>
          </div>

          <h1>
            Shop-Floor Production Schedule, OTM Register &amp; Monthly Cost Control
          </h1>
          <p>
            Veda Engineering&rsquo;s live cloud workspace for planning and tracking heavy fabrication
            across self-supporting steel chimneys, storage tanks, ducting, and support structures —
            connecting planning engineers, shop-floor supervisors, sub-vendors, and management in one
            place.
          </p>

          <div className="hero-metrics">
            <div className="hero-metric-box">
              <div className="hero-metric-num">OTM → Shop</div>
              <div className="hero-metric-lbl">
                Track weights, drawings, material readiness, Shop vs Sub-Vendor POs &amp; dispatch
              </div>
            </div>
            <div className="hero-metric-box">
              <div className="hero-metric-num">Live Gantt</div>
              <div className="hero-metric-lbl">
                Daily shop-floor logs update % completion, delayed alerts &amp; monthly bars automatically
              </div>
            </div>
            <div className="hero-metric-box">
              <div className="hero-metric-num">2-Way .XLSX</div>
              <div className="hero-metric-lbl">
                Import or export the full 6-sheet Excel workbook anytime with permanent Firestore storage
              </div>
            </div>
          </div>

          <div className="hero-workflow-list">
            <div className="hero-workflow-step">
              <div className="hero-workflow-num">Step 01 · Masters</div>
              <div className="hero-workflow-title">Register Customer Projects &amp; Sub-Vendors</div>
              <div className="hero-workflow-desc">
                Add each Veda Project No, Customer Name, Active/Hold status, and approved sub-vendors
                once so they cascade everywhere.
              </div>
            </div>

            <div className="hero-workflow-step">
              <div className="hero-workflow-num">Step 02 · OTM - PROD</div>
              <div className="hero-workflow-title">Schedule Deliverable Equipment Items</div>
              <div className="hero-workflow-desc">
                Enter equipment items with drawing/cost-sheet weight, material status, fabrication
                location, Plan Start, Plan End, and committed delivery dates.
              </div>
            </div>

            <div className="hero-workflow-step">
              <div className="hero-workflow-num">Step 03 · Daily Plan</div>
              <div className="hero-workflow-title">Log Daily Shop-Floor Fabrication</div>
              <div className="hero-workflow-desc">
                Supervisors record daily work (shell rolling, seam welding, fit-up, painting) as
                Done, In Progress, Not Done, or Item Completed.
              </div>
            </div>

            <div className="hero-workflow-step">
              <div className="hero-workflow-num">Step 04 · Gantt &amp; MIS</div>
              <div className="hero-workflow-title">Monitor Delays, Tonnage &amp; Cost/Kg</div>
              <div className="hero-workflow-desc">
                Review day-by-day Monthly Gantt execution, overdue dispatch alerts on Dashboard, and
                12-month factory ₹/Kg cost efficiency.
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 12,
            color: 'var(--sidebar-muted)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            paddingTop: 14,
          }}
        >
          <span>Veda Engineering Pvt. Ltd. · Internal Staff Workspace</span>
          <a
            href="https://veplworks.com"
            style={{
              color: 'hsl(208, 86%, 74%)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            All Veda Engineering Tools <ExternalLink size={12} />
          </a>
        </div>
      </section>

      <main className="login-form-pane">
        <div className="login-box">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {challenge ? 'Enter 6-Digit Verification Code' : 'Staff Sign-In (@vedaengg.com)'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
              {challenge
                ? `We emailed a one-time 6-digit code to ${normalizedEmail}. Enter it below to open the production workspace.`
                : 'Enter your official @vedaengg.com email address. We will send a one-time 6-digit verification code — no separate password required.'}
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
                  placeholder="firstname.lastname@vedaengg.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <span className="field-hint">
                  Restricted to verified <code>@vedaengg.com</code> staff accounts (same sign-in as
                  Team Workboard &amp; StackStudio).
                </span>
              </div>

              <button
                id="login-submit-btn"
                type="submit"
                className="btn btn-primary"
                style={{ height: 39, marginTop: 2 }}
                disabled={loading}
              >
                <Mail size={15} />
                {loading ? 'Sending verification code...' : 'Send 6-Digit Sign-In Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div className="field-group">
                <label className="field-label" htmlFor="login-code">
                  One-Time Verification Code
                </label>
                <input
                  id="login-code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="input-control mono"
                  style={{ fontSize: 19, letterSpacing: '0.28em', textAlign: 'center', height: 44 }}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  required
                />
                <span className="field-hint">
                  Code expires in 10 minutes. Check your inbox (and spam folder if delayed).
                </span>
              </div>

              <button
                id="verify-code-btn"
                type="submit"
                className="btn btn-primary"
                style={{ height: 39, marginTop: 2 }}
                disabled={loading || code.length !== 6}
              >
                <KeyRound size={15} />
                {loading ? 'Verifying...' : 'Verify & Open Production Workspace'}
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

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 15 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                marginBottom: 9,
              }}
            >
              How Role Permissions Work Inside
            </div>
            <div className="role-demo-list">
              <div className="role-demo-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <ShieldCheck size={17} color="var(--brand-primary)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                      Admin / Project Manager
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      Full access: Masters projects &amp; sub-vendors, staff role assignment, OTM
                      schedule, Daily Plan, and monthly MIS ₹/Kg cost ledger.
                    </div>
                  </div>
                </div>
              </div>

              <div className="role-demo-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <CalendarRange size={17} color="var(--brand-accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                      Production Planner
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      Add &amp; update OTM equipment items, planned dates, sub-vendor POs, Daily
                      Plan logs, Monthly Gantt, and two-way Excel (.xlsx) sync.
                    </div>
                  </div>
                </div>
              </div>

              <div className="role-demo-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <Wrench size={17} color="var(--st-completed-fg)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                      Shop-Floor Supervisor (Default for new staff)
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      Log &amp; update daily shop-floor work in Daily Plan and Monthly Gantt;
                      read-only visibility across Dashboard, OTM &amp; Masters.
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
