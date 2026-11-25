import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Search } from 'lucide-react'
import { formatShortDate } from '../shared/calculations.ts'
import type {
  ComputedMisMonthRow,
  ComputedOtmItem,
  ProductionStatus,
} from '../shared/types.ts'
import { ProductionStatusBadge, ProgressDataBar } from './StatusBadge.tsx'

interface DashboardProps {
  asOfDate: string
  kpis: {
    total_items: number
    total_weight_tons: number
    completed: number
    in_progress: number
    delayed: number
    not_started: number
    on_hold: number
    not_planned: number
    wt_completed_tons: number
    delivery_overdue: number
    due_in_15_days: number
    data_issues: number
  }
  statusSummary: { status: ProductionStatus; items: number; wt_tons: number }[]
  locationSummary: { location: string; items: number; wt_tons: number }[]
  projectWiseSummary: {
    project_no: string
    customer_name: string
    items: number
    wt_tons: number
    completed: number
    in_progress: number
    delayed: number
    not_started: number
    avg_pct: number
    wt_done_tons: number
    next_committed_delivery: string | null
    overall_status: ProductionStatus
  }[]
  attentionList: ComputedOtmItem[]
  misMonths: ComputedMisMonthRow[]
  onDrillToOtm: (opts: {
    projectNo?: string
    prodStatus?: string
    deliveryStatus?: string
    dataCheck?: 'all' | 'issues' | 'ok'
  }) => void
}

export function DashboardView({
  asOfDate,
  kpis,
  statusSummary,
  locationSummary,
  projectWiseSummary,
  attentionList,
  misMonths,
  onDrillToOtm,
}: DashboardProps) {
  const [projQuery, setProjQuery] = useState('')
  const [attnQuery, setAttnQuery] = useState('')

  const filteredProjects = projectWiseSummary.filter((p) => {
    const q = projQuery.trim().toLowerCase()
    if (!q) return true
    return (
      p.project_no.toLowerCase().includes(q) || p.customer_name.toLowerCase().includes(q)
    )
  })

  const filteredAttention = attentionList.filter((a) => {
    const q = attnQuery.trim().toLowerCase()
    if (!q) return true
    return (
      a.project_no.toLowerCase().includes(q) ||
      a.customer_name.toLowerCase().includes(q) ||
      a.item_description.toLowerCase().includes(q)
    )
  })

  const activeMonths = misMonths.slice(0, 6)
  const maxChartTonnage = Math.max(
    1,
    ...activeMonths.map((m) => Math.max(m.planned_tonnage, m.achieved_tonnage))
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPI Strip — click any card to drill straight into OTM-PROD */}
      <div className="kpi-grid">
        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({})}
          title="Total fabricable deliverable items registered in OTM - PROD. Click to view all items."
        >
          <span className="kpi-label">
            Total Equipment Items <ExternalLink size={12} />
          </span>
          <span className="kpi-value">{kpis.total_items}</span>
          <span className="kpi-foot">
            {kpis.total_weight_tons.toFixed(3)} T combined fabrication weight
          </span>
        </button>

        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({ prodStatus: 'Completed' })}
          title="Items marked Dispatched, logged as 'Item Completed' in Daily Plan, or where Done days >= Planned days."
        >
          <span className="kpi-label">
            Completed Items <CheckCircle2 size={13} color="var(--st-completed-fg)" />
          </span>
          <span className="kpi-value success">{kpis.completed}</span>
          <span className="kpi-foot">
            {kpis.wt_completed_tons.toFixed(3)} T finished fabrication output
          </span>
        </button>

        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({ prodStatus: 'In Progress' })}
          title="Active items with at least 1 'Done' day logged in Daily Plan whose Plan End date has not yet passed."
        >
          <span className="kpi-label">Active on Shop Floor</span>
          <span className="kpi-value">{kpis.in_progress}</span>
          <span className="kpi-foot">
            Plus {kpis.not_started} scheduled items awaiting start
          </span>
        </button>

        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({ prodStatus: 'Delayed' })}
          title="Items whose Plan End date is earlier than the Reference Date and fabrication is not yet Completed."
        >
          <span className="kpi-label">
            Production Delayed <AlertTriangle size={13} color="var(--st-delayed-fg)" />
          </span>
          <span className={`kpi-value ${kpis.delayed > 0 ? 'danger' : ''}`}>
            {kpis.delayed}
          </span>
          <span className="kpi-foot">Past Plan End as of {formatShortDate(asOfDate)}</span>
        </button>

        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({ deliveryStatus: 'Overdue' })}
          title="Items whose Committed Customer Delivery Date has passed without an Actual Dispatch Date recorded."
        >
          <span className="kpi-label">
            Dispatch Overdue <Clock size={13} color="var(--st-delayed-fg)" />
          </span>
          <span className={`kpi-value ${kpis.delivery_overdue > 0 ? 'danger' : ''}`}>
            {kpis.delivery_overdue}
          </span>
          <span className="kpi-foot">{kpis.due_in_15_days} more due within next 15 days</span>
        </button>

        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({ prodStatus: 'On Hold' })}
          title="Left number: items under Hold projects in Masters. Right number: items missing Plan Start & Plan End dates."
        >
          <span className="kpi-label">On Hold / Unscheduled</span>
          <span className="kpi-value warning">
            {kpis.on_hold}{' '}
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/ {kpis.not_planned}</span>
          </span>
          <span className="kpi-foot">Customer Hold / awaiting plan dates</span>
        </button>

        <button
          type="button"
          className="kpi-tile"
          onClick={() => onDrillToOtm({ dataCheck: 'issues' })}
          title="Automatic audit of OTM rows missing weight, fabrication location, sub-vendor name, or plan dates."
        >
          <span className="kpi-label">Missing Data Flags</span>
          <span className={`kpi-value ${kpis.data_issues > 0 ? 'warning' : 'success'}`}>
            {kpis.data_issues}
          </span>
          <span className="kpi-foot">Click to review incomplete OTM rows</span>
        </button>
      </div>

      {/* Analytics Row: Status Breakdown, Fabrication Location, Monthly Tonnage Chart */}
      <div className="analytics-row-3">
        <div className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">Production Status Summary</div>
              <div className="card-subtitle">Item count &amp; tonnage distribution</div>
            </div>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {statusSummary.map((row) => {
              const share =
                kpis.total_items > 0 ? Math.round((row.items / kpis.total_items) * 100) : 0
              return (
                <div
                  key={row.status}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 48px 72px',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                  }}
                  onClick={() => onDrillToOtm({ prodStatus: row.status })}
                >
                  <ProductionStatusBadge status={row.status} />
                  <div className="databar-track">
                    <div
                      className={`databar-fill ${
                        row.status === 'Completed'
                          ? 'done'
                          : row.status === 'Delayed'
                            ? 'late'
                            : ''
                      }`}
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <span className="mono text-right" style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {row.items}
                  </span>
                  <span
                    className="mono text-right"
                    style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                  >
                    {row.wt_tons.toFixed(2)} T
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">Fabrication Location</div>
              <div className="card-subtitle">In-house shop vs sub-vendor allocation</div>
            </div>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <table className="data-table" style={{ border: '1px solid var(--border-subtle)' }}>
              <thead>
                <tr>
                  <th>Location</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Weight (T)</th>
                </tr>
              </thead>
              <tbody>
                {locationSummary.map((loc) => (
                  <tr key={loc.location}>
                    <td style={{ fontWeight: 600 }}>{loc.location}</td>
                    <td className="mono text-right">{loc.items}</td>
                    <td className="mono text-right">{loc.wt_tons.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="mono text-right">{kpis.total_items}</td>
                  <td className="mono text-right">{kpis.total_weight_tons.toFixed(3)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">Monthly Planned vs Achieved Tonnage</div>
              <div className="card-subtitle">6-month rolling schedule output (Tons)</div>
            </div>
          </div>
          <div style={{ padding: '16px 18px 14px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${activeMonths.length}, 1fr)`,
                gap: 10,
                height: 150,
                alignItems: 'end',
                paddingTop: 18,
              }}
            >
              {activeMonths.map((m) => {
                const pH = Math.round((m.planned_tonnage / maxChartTonnage) * 105)
                const aH = Math.round((m.achieved_tonnage / maxChartTonnage) * 105)
                return (
                  <div
                    key={m.month_key}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      {m.planned_tonnage > 0 ? `${m.planned_tonnage.toFixed(1)}T` : '0'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        gap: 4,
                        height: 108,
                      }}
                    >
                      <div
                        title={`Planned: ${m.planned_tonnage.toFixed(3)} T`}
                        style={{
                          width: 16,
                          height: Math.max(3, pH),
                          background: 'hsl(212, 65%, 36%)',
                          borderRadius: '4px 4px 0 0',
                        }}
                      />
                      <div
                        title={`Achieved: ${m.achieved_tonnage.toFixed(3)} T`}
                        style={{
                          width: 16,
                          height: Math.max(3, aH),
                          background: 'var(--st-completed-bar)',
                          borderRadius: '4px 4px 0 0',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.month_label.split(' ')[0]}
                    </div>
                  </div>
                )
              })}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 16,
                justifyContent: 'center',
                marginTop: 10,
                fontSize: 11.5,
                color: 'var(--text-muted)',
              }}
            >
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: 'hsl(212, 65%, 36%)',
                    marginRight: 5,
                  }}
                />
                Planned (T)
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: 'var(--st-completed-bar)',
                    marginRight: 5,
                  }}
                />
                Completed (T)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: Project-wise Summary & Attention List */}
      <div className="split-grid-2">
        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">
                Project-wise Summary ({filteredProjects.length})
              </div>
              <div className="card-subtitle">
                Click any project row to inspect its items in OTM - PROD
              </div>
            </div>
            <div className="search-box" style={{ minWidth: 180, maxWidth: 230 }}>
              <Search size={14} />
              <input
                type="text"
                className="input-control"
                placeholder="Filter project or customer..."
                value={projQuery}
                onChange={(e) => setProjQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="table-scroll" style={{ maxHeight: 460 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th title="Veda customer order / project code">Project No</th>
                  <th title="Customer name linked from Masters">Customer</th>
                  <th className="text-right" title="Number of equipment items in OTM - PROD">
                    Items
                  </th>
                  <th className="text-right" title="Combined final fabrication weight in Metric Tons">
                    Wt (T)
                  </th>
                  <th className="text-right" title="Number of Completed items">
                    Done
                  </th>
                  <th className="text-right" title="Items past Plan End date that are not yet Completed">
                    Delayed
                  </th>
                  <th title="Average completion percentage across all items in this project">
                    Avg %
                  </th>
                  <th title="Earliest upcoming Committed Delivery Date among undispatched items">
                    Next Delivery
                  </th>
                  <th title="Overall rolled-up production status for this project">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => {
                  const isOverdueDate =
                    p.next_committed_delivery && p.next_committed_delivery < asOfDate
                  return (
                    <tr
                      key={p.project_no}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onDrillToOtm({ projectNo: p.project_no })}
                    >
                      <td className="mono nowrap" style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                        {p.project_no}
                      </td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.customer_name}>
                        {p.customer_name}
                      </td>
                      <td className="mono text-right">{p.items}</td>
                      <td className="mono text-right">{p.wt_tons > 0 ? p.wt_tons.toFixed(2) : '0'}</td>
                      <td className="mono text-right">{p.completed}</td>
                      <td
                        className="mono text-right"
                        style={{
                          fontWeight: p.delayed > 0 ? 700 : 400,
                          color: p.delayed > 0 ? 'var(--st-delayed-fg)' : undefined,
                        }}
                      >
                        {p.delayed}
                      </td>
                      <td>
                        <ProgressDataBar pct={p.avg_pct} status={p.overall_status} />
                      </td>
                      <td
                        className="mono nowrap"
                        style={{
                          color: isOverdueDate ? 'var(--st-delayed-fg)' : undefined,
                          fontWeight: isOverdueDate ? 600 : 400,
                        }}
                      >
                        {formatShortDate(p.next_committed_delivery)}
                      </td>
                      <td>
                        <ProductionStatusBadge status={p.overall_status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title" style={{ color: 'var(--st-delayed-fg)' }}>
                Attention List — Delayed &amp; Overdue ({filteredAttention.length})
              </div>
              <div className="card-subtitle">
                Items past Plan End or past Committed Delivery Date requiring immediate follow-up
              </div>
            </div>
            <div className="search-box" style={{ minWidth: 170, maxWidth: 210 }}>
              <Search size={14} />
              <input
                type="text"
                className="input-control"
                placeholder="Search item..."
                value={attnQuery}
                onChange={(e) => setAttnQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="table-scroll" style={{ maxHeight: 460 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th title="Veda Project No">Project</th>
                  <th title="Deliverable equipment item description">Item</th>
                  <th title="Scheduled production completion date">Plan End</th>
                  <th title="Logged Done days divided by Planned days">%</th>
                  <th title="Current shop-floor production status">Status</th>
                  <th title="Customer dispatch & delivery status">Delivery</th>
                  <th
                    className="text-right"
                    title="Calendar days overdue beyond Plan End or Committed Delivery Date"
                  >
                    Late (d)
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAttention.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onDrillToOtm({ projectNo: item.project_no })}
                  >
                    <td className="mono" style={{ color: 'var(--text-muted)' }}>
                      {idx + 1}
                    </td>
                    <td className="mono nowrap" style={{ fontWeight: 600 }}>
                      {item.project_no}
                    </td>
                    <td style={{ fontWeight: 500 }}>{item.item_description}</td>
                    <td className="mono nowrap">{formatShortDate(item.plan_end)}</td>
                    <td>
                      <ProgressDataBar pct={item.pct_complete} status={item.production_status} />
                    </td>
                    <td>
                      <ProductionStatusBadge status={item.production_status} />
                    </td>
                    <td>
                      <ProductionStatusBadge status={item.delivery_status} />
                    </td>
                    <td
                      className="mono text-right"
                      style={{ color: 'var(--st-delayed-fg)', fontWeight: 700 }}
                    >
                      {item.production_late_days ?? item.dispatch_late_days ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
