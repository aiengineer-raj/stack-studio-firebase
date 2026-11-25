import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Database,
  FileSpreadsheet,
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

function getTodayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function App() {
  const [user, setUser] = useState<UserPublic | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard')
  const [asOfDate, setAsOfDate] = useState<string>(getTodayIso())
  const [excelModalOpen, setExcelModalOpen] = useState(false)

  // Cross-tab drilldowns
  const [otmPreset, setOtmPreset] = useState<OtmFilterPreset | null>(null)
  const [dailyPrefill, setDailyPrefill] = useState<{
    projectNo: string
    itemDesc: string
  } | null>(null)

  // Toast
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null)

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
        Initializing ForgePlan MES...
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
        Loading manufacturing workspace...
      </div>
    )
  }

  const tabMeta: Record<ActiveTab, { title: string; editableRoles: UserRole[] }> = {
    dashboard: { title: 'Production Dashboard', editableRoles: [] },
    otm: { title: 'OTM - PROD · Master Item Register', editableRoles: ['admin', 'planner'] },
    daily: {
      title: 'Daily Plan · Shop-Floor Log',
      editableRoles: ['admin', 'planner', 'supervisor'],
    },
    gantt: {
      title: 'Monthly Plan · Interactive Gantt',
      editableRoles: ['admin', 'planner', 'supervisor'],
    },
    mis: { title: 'MIS · Plan vs Actual & Cost/Kg', editableRoles: ['admin'] },
    masters: { title: 'Masters & Role Access', editableRoles: ['admin'] },
    guide: { title: 'Workflow Guide & Audit Log', editableRoles: [] },
  }

  const currentTabInfo = tabMeta[activeTab]
  const isCurrentEditable = currentTabInfo.editableRoles.includes(user.role)

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">FP</div>
          <div>
            <div className="brand-title">ForgePlan MES</div>
            <div className="brand-subtitle">Manufacturing Monthly Plan</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main Navigation">
          <div className="nav-section-label">Operations</div>

          <button
            id="nav-dashboard"
            type="button"
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="nav-btn-left">
              <LayoutDashboard size={16} />
              Dashboard
            </span>
            {analytics.attentionList.length > 0 && (
              <span className="nav-count-badge alert" title="Delayed / Overdue items">
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
              OTM - PROD
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
              Daily Plan
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
              Monthly Plan
            </span>
          </button>

          <div className="nav-section-label" style={{ marginTop: 8 }}>
            Management &amp; Setup
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
                MIS &amp; Cost/Kg
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
              Masters
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
              Workflow &amp; Audit
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
            <h1 className="page-heading">{currentTabInfo.title}</h1>
            {activeTab !== 'dashboard' && activeTab !== 'guide' && (
              <span className={`permission-pill ${isCurrentEditable ? 'editable' : ''}`}>
                {isCurrentEditable ? `Editable (${user.role})` : `Read-Only (${user.role})`}
              </span>
            )}
          </div>

          <div className="topbar-actions">
            <label className="asof-control" title="Simulated TODAY() date for status & overdue formulas">
              <span>As on:</span>
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
              id="open-excel-sync-btn"
              type="button"
              className="btn btn-primary"
              onClick={() => setExcelModalOpen(true)}
            >
              <FileSpreadsheet size={15} />
              Excel Sync (.xlsx)
            </button>
          </div>
        </header>

        <main className="page-content">
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
