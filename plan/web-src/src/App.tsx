import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Database,
  FileSpreadsheet,
  HelpCircle,
  Info,
  LayoutDashboard,
  LogOut,
  Wrench,
} from 'lucide-react'
import { type AuditEntry, api, getStoredToken, setStoredToken } from './api.ts'
import { DashboardView } from './components/DashboardView.tsx'
import { DailyPlanView } from './components/DailyPlanView.tsx'
import { ExcelSyncModal } from './components/ExcelSyncModal.tsx'
import { GuideAndAuditView } from './components/GuideAndAuditView.tsx'
import { LoginScreen } from './components/LoginScreen.tsx'
import { MastersView } from './components/MastersView.tsx'
import { MisView } from './components/MisView.tsx'
import { MonthlyGanttView } from './components/MonthlyGanttView.tsx'
import { type OtmFilterPreset, OtmProdView } from './components/OtmProdView.tsx'
import { computeWorkspaceAnalytics } from './shared/calculations.ts'
import type { UserPublic, UserRole, WorkspacePayload } from './shared/types.ts'

type ActiveTab = 'dashboard' | 'otm' | 'daily' | 'gantt' | 'mis' | 'masters' | 'guide'

const GUIDE_PREF_KEY = 'vepl_plan_show_guide'

function getTodayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const TAB_CONFIG: Record<
  ActiveTab,
  {
    title: string
    subtitle: string
    editableRoles: UserRole[]
    guideTitle: string
    guideText: string
    highlights: { label: string; detail: string }[]
    showCellLegend?: boolean
  }
> = {
  dashboard: {
    title: 'Executive Production Dashboard',
    subtitle: 'Live shop-floor & sub-vendor KPIs, project progress, and overdue dispatch alerts',
    editableRoles: [],
    guideTitle: 'How the Production Dashboard Works',
    guideText:
      'Every number and chart below is calculated automatically from OTM - PROD and Daily Plan against the selected Reference Date ("As on") in the top bar. Click any KPI card, status bar, or project row to jump directly into the matching equipment items.',
    highlights: [
      { label: 'Click-to-Drill', detail: 'Click any KPI tile or project row to filter OTM - PROD' },
      { label: 'Production Delayed', detail: 'Plan End date has passed & item is not yet Completed' },
      { label: 'Delivery Overdue', detail: 'Committed delivery date passed without Actual Dispatch Date' },
    ],
  },
  otm: {
    title: 'OTM - PROD · Master Equipment Register',
    subtitle: 'Order-to-Manufacturing register for weights, drawings, material readiness, sub-vendor POs & dispatch',
    editableRoles: ['admin', 'planner'],
    guideTitle: 'How OTM - PROD Works (Master Item Schedule)',
    guideText:
      'Each row represents one fabricable deliverable (chimney shell, tank, cone, ducting, or structure) linked to a Veda Project No from Masters. Planners & Admins enter weights, fabrication location (Shop vs Subvendor), and Plan Start / Plan End dates; % Complete and Production Status update automatically as Daily Plan logs come in.',
    highlights: [
      { label: 'Final Wt (T)', detail: 'Uses Drawing Wt (Kg) if entered, else Cost Sheet Wt ÷ 1000' },
      { label: 'Committed Delivery', detail: 'Revised Agreed Date → else Customer Delivery → else Plan End' },
      { label: 'Column Views', detail: 'Switch tabs on the right to inspect Weights, Sub-Vendor POs, or All 37 Columns' },
    ],
    showCellLegend: true,
  },
  daily: {
    title: 'Daily Plan · Shop-Floor Fabrication Log',
    subtitle: 'Record daily bay execution, fit-up, rolling, welding, painting & completion status',
    editableRoles: ['admin', 'planner', 'supervisor'],
    guideTitle: 'How Daily Shop-Floor Logging Updates the Entire Plan',
    guideText:
      'Supervisors, Planners, and Admins log daily shop-floor progress here. Selecting a Project No automatically filters the Item dropdown to items registered in OTM - PROD. Every "Done" entry advances % Complete, and logging "Item Completed" immediately marks the OTM deliverable 100% Completed.',
    highlights: [
      { label: 'Done', detail: 'Counts +1 working day toward Plan Days & % Complete' },
      { label: 'Item Completed', detail: 'Marks the OTM item 100% Completed on that date' },
      { label: 'Not Done / In Progress', detail: 'Records a blocker or partial shift without inflating Done days' },
    ],
    showCellLegend: true,
  },
  gantt: {
    title: 'Monthly Plan · Interactive Gantt Matrix',
    subtitle: 'Day-by-day visual comparison of planned schedule bars vs logged shop-floor execution',
    editableRoles: ['admin', 'planner', 'supervisor'],
    guideTitle: 'How to Read & Log Work from the Monthly Gantt',
    guideText:
      'This matrix overlays each item’s planned window (Plan Start → Plan End) with actual daily shop-floor entries for the chosen month. Click any day cell on any row to inspect what work was done on that date or log a new shop-floor entry directly.',
    highlights: [
      { label: 'Green ✓', detail: 'Work logged as Done / Item Completed on that date' },
      { label: 'Blue vs Red Cell', detail: 'Blue = Planned upcoming day · Red = Planned day passed without Done log' },
      { label: 'Carryover Toggle', detail: 'Shows unfinished items from earlier months still active on the shop floor' },
    ],
  },
  mis: {
    title: 'MIS · Monthly Tonnage & Factory Cost / Kg',
    subtitle: '12-month rolling Plan vs Achieved output, on-time dispatch rate & ₹/Kg fabrication cost ledger',
    editableRoles: ['admin'],
    guideTitle: 'How MIS Tonnage & Cost-per-Kg Analytics Work',
    guideText:
      'Sections A & B roll up automatically from OTM - PROD and Daily Plan across a 12-month window. In Section C, Admin / Management enters monthly factory expenses (Fixed, Sub-Contract, Direct Labour, Consumables, R&M) to compute real-time Total Expenses and Fabrication Cost per Kg (₹/Kg).',
    highlights: [
      { label: 'Planned vs Achieved (T)', detail: 'Planned = Plan End in month · Achieved = Completion Date in month' },
      { label: 'Cost / Kg Formula', detail: 'Total Monthly Expenses (Rs.) ÷ (Completed Output Tons × 1,000)' },
      { label: 'Role Security', detail: 'Visible to Planners & Admins; expense editing restricted to Admin' },
    ],
    showCellLegend: true,
  },
  masters: {
    title: 'Masters & Veda Team Role Access',
    subtitle: 'Central register of customer projects, approved sub-vendors, dropdown lists & @vedaengg.com staff roles',
    editableRoles: ['admin'],
    guideTitle: 'How Masters & Staff Role Access Control Work',
    guideText:
      'Always register a new Project No and Customer Name here first before adding its items in OTM - PROD. Marking a project "Hold" here automatically pauses all its OTM items as "On Hold". Admins can also pre-authorize @vedaengg.com colleagues or switch anyone between Admin, Planner, and Supervisor.',
    highlights: [
      { label: 'Project Cascade', detail: 'Customer name & Hold status flow automatically to OTM & Daily Plan' },
      { label: 'Sub-Vendor List', detail: 'Populates the Sub-Vendor dropdown whenever Location = Subvendor' },
      { label: '@vedaengg.com Roles', detail: 'Role changes take effect immediately without requiring re-login' },
    ],
    showCellLegend: true,
  },
  guide: {
    title: 'Workflow Reference & Live Audit Trail',
    subtitle: 'Standard operating routine, workbook formula definitions, and chronological activity log',
    editableRoles: [],
    guideTitle: 'Standard Operating Guide & Tamper-Evident Change Log',
    guideText:
      'Use this reference anytime a new engineer or supervisor joins the team. Every project update, OTM schedule change, daily shop-floor log, role update, and Excel import is recorded with user name, role, and timestamp below.',
    highlights: [
      { label: '100% Formula Parity', detail: 'Matches every status, weight & delivery rule from your Excel workbook' },
      { label: 'Cloud Persistence', detail: 'All changes save permanently to Veda Engineering’s Firestore database' },
    ],
  },
}

export function App() {
  const [user, setUser] = useState<UserPublic | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [asOfDate, setAsOfDate] = useState<string>(getTodayIso())
  const [excelModalOpen, setExcelModalOpen] = useState(false)
  const [showGuide, setShowGuide] = useState<boolean>(() => {
    return localStorage.getItem(GUIDE_PREF_KEY) !== '0'
  })

  // Cross-tab drilldowns
  const [otmPreset, setOtmPreset] = useState<OtmFilterPreset | null>(null)
  const [dailyPrefill, setDailyPrefill] = useState<{
    projectNo: string
    itemDesc: string
  } | null>(null)

  // Toast
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null)

  const toggleGuide = () => {
    setShowGuide((prev) => {
      const next = !prev
      localStorage.setItem(GUIDE_PREF_KEY, next ? '1' : '0')
      return next
    })
  }

  const notify = useCallback((msg: string, isError?: boolean) => {
    setToast({ msg, isError })
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev))
    }, 3800)
  }, [])

  const fetchWorkspace = useCallback(async () => {
    const res = await api.getWorkspace()
    setWorkspace({
      projects: res.projects,
      subVendors: res.subVendors,
      dropdowns: res.dropdowns,
      otmItems: res.otmItems,
      dailyLogs: res.dailyLogs,
      misCosts: res.misCosts,
      settings: res.settings,
    })
    setAuditLogs(res.auditLogs || [])
  }, [])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      setAuthChecking(false)
      return
    }
    api
      .me()
      .then(async (r) => {
        setUser(r.user)
        await fetchWorkspace()
      })
      .catch(() => {
        setStoredToken(null)
        setUser(null)
      })
      .finally(() => setAuthChecking(false))
  }, [fetchWorkspace])

  const handleAuthenticated = async (loggedInUser: UserPublic) => {
    setUser(loggedInUser)
    if (loggedInUser.role === 'supervisor' && activeTab === 'mis') {
      setActiveTab('daily')
    }
    await fetchWorkspace()
  }

  const handleLogout = () => {
    setStoredToken(null)
    setUser(null)
    setWorkspace(null)
  }

  const analytics = useMemo(() => {
    if (!workspace) return null
    return computeWorkspaceAnalytics({
      projects: workspace.projects,
      otmItems: workspace.otmItems,
      dailyLogs: workspace.dailyLogs,
      misCosts: workspace.misCosts,
      misStartMonth: workspace.settings.mis_start_month,
      asOfDate,
    })
  }, [workspace, asOfDate])

  if (authChecking) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontWeight: 600,
        }}
      >
        Connecting to Veda Engineering Production Workspace...
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />
  }

  if (!workspace || !analytics) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontWeight: 600,
        }}
      >
        Loading Veda Engineering production register...
      </div>
    )
  }

  const currentTabInfo = TAB_CONFIG[activeTab]
  const isCurrentEditable = currentTabInfo.editableRoles.includes(user.role)

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <div className="brand-mark">VEPL</div>
            <div>
              <div className="brand-title">Veda Engineering</div>
              <div className="brand-subtitle">Monthly Production Plan</div>
            </div>
          </div>
          <a className="vepl-portal-link" href="https://veplworks.com">
            <ArrowLeft size={12} /> Back to veplworks.com
          </a>
        </div>

        <nav className="sidebar-nav" aria-label="Main Navigation">
          <div className="nav-section-label">Shop-Floor &amp; Schedule</div>

          <button
            id="nav-dashboard"
            type="button"
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="nav-btn-left">
              <LayoutDashboard size={16} />
              <span className="nav-btn-text">
                <span className="nav-btn-title">Dashboard</span>
                <span className="nav-btn-desc">KPIs, delays &amp; project health</span>
              </span>
            </span>
            {analytics.attentionList.length > 0 && (
              <span
                className="nav-count-badge alert"
                title="Items currently Delayed or Delivery Overdue"
              >
                {analytics.attentionList.length}
              </span>
            )}
          </button>

          <button
            id="nav-otm"
            type="button"
            className={`nav-btn ${activeTab === 'otm' ? 'active' : ''}`}
            onClick={() => setActiveTab('otm')}
          >
            <span className="nav-btn-left">
              <ClipboardList size={16} />
              <span className="nav-btn-text">
                <span className="nav-btn-title">OTM - PROD</span>
                <span className="nav-btn-desc">Master equipment &amp; PO register</span>
              </span>
            </span>
            <span className="nav-count-badge">{analytics.computedOtmItems.length}</span>
          </button>

          <button
            id="nav-daily"
            type="button"
            className={`nav-btn ${activeTab === 'daily' ? 'active' : ''}`}
            onClick={() => setActiveTab('daily')}
          >
            <span className="nav-btn-left">
              <Wrench size={16} />
              <span className="nav-btn-text">
                <span className="nav-btn-title">Daily Plan</span>
                <span className="nav-btn-desc">Log daily shop-floor work</span>
              </span>
            </span>
            <span className="nav-count-badge">{analytics.computedDailyLogs.length}</span>
          </button>

          <button
            id="nav-gantt"
            type="button"
            className={`nav-btn ${activeTab === 'gantt' ? 'active' : ''}`}
            onClick={() => setActiveTab('gantt')}
          >
            <span className="nav-btn-left">
              <CalendarDays size={16} />
              <span className="nav-btn-text">
                <span className="nav-btn-title">Monthly Plan</span>
                <span className="nav-btn-desc">Day-by-day interactive Gantt</span>
              </span>
            </span>
          </button>

          <div className="nav-section-label" style={{ marginTop: 8 }}>
            Management &amp; Masters
          </div>

          {user.role !== 'supervisor' && (
            <button
              id="nav-mis"
              type="button"
              className={`nav-btn ${activeTab === 'mis' ? 'active' : ''}`}
              onClick={() => setActiveTab('mis')}
            >
              <span className="nav-btn-left">
                <BarChart3 size={16} />
                <span className="nav-btn-text">
                  <span className="nav-btn-title">MIS &amp; Cost/Kg</span>
                  <span className="nav-btn-desc">Plan vs actual tonnage &amp; ₹/Kg</span>
                </span>
              </span>
            </button>
          )}

          <button
            id="nav-masters"
            type="button"
            className={`nav-btn ${activeTab === 'masters' ? 'active' : ''}`}
            onClick={() => setActiveTab('masters')}
          >
            <span className="nav-btn-left">
              <Database size={16} />
              <span className="nav-btn-text">
                <span className="nav-btn-title">Masters &amp; Roles</span>
                <span className="nav-btn-desc">Projects, vendors &amp; staff access</span>
              </span>
            </span>
            <span className="nav-count-badge">{analytics.enrichedProjects.length}</span>
          </button>

          <button
            id="nav-guide"
            type="button"
            className={`nav-btn ${activeTab === 'guide' ? 'active' : ''}`}
            onClick={() => setActiveTab('guide')}
          >
            <span className="nav-btn-left">
              <BookOpen size={16} />
              <span className="nav-btn-text">
                <span className="nav-btn-title">Workflow &amp; Audit</span>
                <span className="nav-btn-desc">Formula rules &amp; activity log</span>
              </span>
            </span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">
              {user.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)}
            </div>
            <div className="user-meta" style={{ minWidth: 0 }}>
              <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: 'var(--sidebar-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={user.email}
              >
                {user.email}
              </div>
              <span className="user-role-tag" style={{ marginTop: 3 }}>
                {user.role}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{
                background: 'rgba(255,255,255,0.08)',
                borderColor: 'transparent',
                color: '#fff',
                padding: '5px 7px',
              }}
              title="Sign Out"
              onClick={handleLogout}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-heading-row">
              <h1 className="page-heading">{currentTabInfo.title}</h1>
              {activeTab !== 'dashboard' && activeTab !== 'guide' && (
                <span className={`permission-pill ${isCurrentEditable ? 'editable' : ''}`}>
                  {isCurrentEditable ? `Editable (${user.role})` : `Read-Only (${user.role})`}
                </span>
              )}
            </div>
            <p className="page-subheading">{currentTabInfo.subtitle}</p>
          </div>

          <div className="topbar-actions">
            <label
              className="asof-control"
              title="Reference date (equivalent to Excel TODAY()) used to evaluate Delayed production & Overdue delivery formulas"
            >
              <span>Ref. Date:</span>
              <input
                id="asof-date-input"
                type="date"
                value={asOfDate}
                onChange={(e) => {
                  if (e.target.value) setAsOfDate(e.target.value)
                }}
              />
            </label>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={toggleGuide}
              title="Show or hide the plain-English guide banner at the top of each screen"
            >
              <HelpCircle size={14} />
              {showGuide ? 'Hide Guide' : 'Show Guide'}
            </button>

            <button
              id="open-excel-sync-btn"
              type="button"
              className="btn btn-primary"
              onClick={() => setExcelModalOpen(true)}
              title="Download live data as multi-sheet .xlsx or import an updated workbook"
            >
              <FileSpreadsheet size={15} />
              Excel Sync (.xlsx)
            </button>
          </div>
        </header>

        <main className="page-content">
          {showGuide && (
            <section className="module-guide-banner" aria-label="Screen Guide">
              <div className="module-guide-top">
                <div>
                  <div className="module-guide-title">
                    <Info size={15} color="var(--brand-primary)" />
                    {currentTabInfo.guideTitle}
                  </div>
                  <p className="module-guide-desc">{currentTabInfo.guideText}</p>
                </div>
                {currentTabInfo.showCellLegend && (
                  <div className="cell-legend-strip">
                    <span>
                      <span className="cell-swatch editable" />
                      <strong>Yellow</strong> = Editable Input
                    </span>
                    <span>
                      <span className="cell-swatch auto" />
                      <strong>Grey</strong> = Auto-Calculated Formula
                    </span>
                  </div>
                )}
              </div>

              <div className="module-guide-pills">
                {currentTabInfo.highlights.map((h) => (
                  <span key={h.label} className="guide-Step-pill">
                    <strong>{h.label}:</strong> {h.detail}
                  </span>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              asOfDate={asOfDate}
              kpis={analytics.kpis}
              statusSummary={analytics.statusSummary}
              locationSummary={analytics.locationSummary}
              projectWiseSummary={analytics.projectWiseSummary}
              attentionList={analytics.attentionList}
              misMonths={analytics.misMonths}
              onDrillToOtm={(preset) => {
                setOtmPreset(preset)
                setActiveTab('otm')
              }}
            />
          )}

          {activeTab === 'otm' && (
            <OtmProdView
              userRole={user.role}
              items={analytics.computedOtmItems}
              projects={workspace.projects}
              subVendors={workspace.subVendors}
              dropdowns={workspace.dropdowns}
              preset={otmPreset}
              onClearPreset={() => setOtmPreset(null)}
              onRefresh={fetchWorkspace}
              onNotify={notify}
              onLogWorkForItem={(projectNo, itemDesc) => {
                setDailyPrefill({ projectNo, itemDesc })
                setActiveTab('daily')
              }}
            />
          )}

          {activeTab === 'daily' && (
            <DailyPlanView
              userRole={user.role}
              asOfDate={asOfDate}
              logs={analytics.computedDailyLogs}
              otmItems={analytics.computedOtmItems}
              dropdowns={workspace.dropdowns}
              prefillItem={dailyPrefill}
              onClearPrefill={() => setDailyPrefill(null)}
              onRefresh={fetchWorkspace}
              onNotify={notify}
            />
          )}

          {activeTab === 'gantt' && (
            <MonthlyGanttView
              defaultMonth={workspace.settings.default_gantt_month}
              asOfDate={asOfDate}
              otmItems={analytics.computedOtmItems}
              logsByItemKey={analytics.logsByItemKey}
              dropdowns={workspace.dropdowns}
              onRefresh={fetchWorkspace}
              onNotify={notify}
            />
          )}

          {activeTab === 'mis' && user.role !== 'supervisor' && (
            <MisView
              userRole={user.role}
              startMonth={workspace.settings.mis_start_month}
              misMonths={analytics.misMonths}
              deliveryKpis={analytics.kpis}
              onRefresh={fetchWorkspace}
              onNotify={notify}
            />
          )}

          {activeTab === 'masters' && (
            <MastersView
              userRole={user.role}
              currentUserId={user.id}
              projects={analytics.enrichedProjects}
              subVendors={workspace.subVendors}
              dropdowns={workspace.dropdowns}
              onRefresh={fetchWorkspace}
              onNotify={notify}
            />
          )}

          {activeTab === 'guide' && (
            <GuideAndAuditView
              auditLogs={auditLogs}
              onNavigate={(t) => setActiveTab(t)}
            />
          )}
        </main>
      </div>

      {excelModalOpen && (
        <ExcelSyncModal
          userRole={user.role}
          asOfDate={asOfDate}
          onClose={() => setExcelModalOpen(false)}
          onRefresh={fetchWorkspace}
          onNotify={notify}
        />
      )}

      {toast && (
        <div className={`toast-banner ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>
      )}
    </div>
  )
}

export default App
