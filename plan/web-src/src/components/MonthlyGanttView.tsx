import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { api } from '../api.ts'
import {
  addMonths,
  computeMonthlyGantt,
  formatMonthLabel,
  formatShortDate,
} from '../shared/calculations.ts'
import type {
  ComputedDailyLog,
  ComputedOtmItem,
  DropdownLists,
} from '../shared/types.ts'
import { ProductionStatusBadge, ProgressDataBar } from './StatusBadge.tsx'

interface MonthlyGanttProps {
  defaultMonth: string
  asOfDate: string
  otmItems: ComputedOtmItem[]
  logsByItemKey: Map<string, ComputedDailyLog[]>
  dropdowns: DropdownLists
  onRefresh: () => Promise<void>
  onNotify: (msg: string, isError?: boolean) => void
}

export function MonthlyGanttView({
  defaultMonth,
  asOfDate,
  otmItems,
  logsByItemKey,
  dropdowns,
  onRefresh,
  onNotify,
}: MonthlyGanttProps) {
  const [monthKey, setMonthKey] = useState(defaultMonth || '2026-10')
  const [includeCarryover, setIncludeCarryover] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Day Cell Popover / Modal
  const [selectedCell, setSelectedCell] = useState<{
    item: ComputedOtmItem
    isoDate: string
    logs: ComputedDailyLog[]
  } | null>(null)
  const [newWork, setNewWork] = useState('')
  const [newStatus, setNewStatus] = useState('Done')
  const [newRemarks, setNewRemarks] = useState('')
  const [savingCell, setSavingCell] = useState(false)

  const gantt = useMemo(
    () =>
      computeMonthlyGantt({
        monthKey,
        computedOtmItems: otmItems,
        logsByItemKey,
        asOfDate,
        includeCarryover,
      }),
    [monthKey, otmItems, logsByItemKey, asOfDate, includeCarryover]
  )

  const visibleRows = useMemo(() => {
    return gantt.rows.filter((r) => {
      if (statusFilter && r.item.production_status !== statusFilter) return false
      const q = search.trim().toLowerCase()
      if (q) {
        const hay = `${r.item.project_no} ${r.item.customer_name} ${r.item.item_description}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [gantt.rows, statusFilter, search])

  const handleLogFromGantt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCell || !newWork.trim()) return
    setSavingCell(true)
    try {
      await api.createDailyLog({
        log_date: selectedCell.isoDate,
        project_no: selectedCell.item.project_no,
        item_description: selectedCell.item.item_description,
        work_done_today: newWork.trim(),
        status: newStatus,
        actual_completion_date: '',
        remarks: newRemarks.trim(),
      })
      onNotify(
        `Logged "${newStatus}" on ${formatShortDate(selectedCell.isoDate)} for ${selectedCell.item.item_description}`
      )
      setNewWork('')
      setNewRemarks('')
      setSelectedCell(null)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to log daily work.', true)
    } finally {
      setSavingCell(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Month Controls + Monthly Summary KPIs */}
      <div className="kpi-grid">
        <div className="kpi-tile" style={{ gridColumn: 'span 2' }}>
          <span className="kpi-label">Select Schedule Month</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMonthKey(addMonths(monthKey, -1))}
            >
              <ChevronLeft size={14} />
            </button>
            <input
              id="gantt-month-picker"
              type="month"
              className="input-control input-editable-yellow mono"
              style={{ width: 150, fontWeight: 700 }}
              value={monthKey}
              onChange={(e) => {
                if (e.target.value) setMonthKey(e.target.value)
              }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setMonthKey(addMonths(monthKey, 1))}
            >
              <ChevronRight size={14} />
            </button>

            <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
              {['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn-sm ${monthKey === m ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setMonthKey(m)}
                >
                  {formatMonthLabel(m).split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="kpi-tile">
          <span className="kpi-label">Items This Month</span>
          <span className="kpi-value">{gantt.summary.itemsThisMonth}</span>
          <span className="kpi-foot">{formatMonthLabel(monthKey)} active schedule</span>
        </div>

        <div className="kpi-tile">
          <span className="kpi-label">Wt Planned to Finish</span>
          <span className="kpi-value">{gantt.summary.wtPlannedToFinish.toFixed(3)} T</span>
          <span className="kpi-foot">Plan End in {formatMonthLabel(monthKey)}</span>
        </div>

        <div className="kpi-tile">
          <span className="kpi-label">Wt Completed</span>
          <span className="kpi-value success">{gantt.summary.wtCompletedInMonth.toFixed(3)} T</span>
          <span className="kpi-foot">Finished in {formatMonthLabel(monthKey)}</span>
        </div>

        <div className="kpi-tile">
          <span className="kpi-label">Delayed Items</span>
          <span className={`kpi-value ${gantt.summary.delayedCount > 0 ? 'danger' : ''}`}>
            {gantt.summary.delayedCount}
          </span>
          <span className="kpi-foot">Carryover / past Plan End</span>
        </div>
      </div>

      <div className="surface-card">
        <div className="card-header">
          <div>
            <div className="card-title">
              Monthly Plan · Interactive Gantt ({formatMonthLabel(monthKey)})
            </div>
            <div className="card-subtitle">
              Click any day cell in the matrix to inspect shop-floor work or log daily execution
            </div>
          </div>

          <div className="gantt-legend">
            <span>
              <span
                className="legend-swatch"
                style={{ background: 'hsl(152, 62%, 82%)', color: 'hsl(155, 78%, 20%)' }}
              >
                ✓
              </span>
              Done
            </span>
            <span>
              <span
                className="legend-swatch"
                style={{ background: 'hsl(40, 96%, 84%)', color: 'hsl(31, 85%, 26%)' }}
              >
                ○
              </span>
              Logged, not done
            </span>
            <span>
              <span className="legend-swatch" style={{ background: 'hsl(209, 82%, 86%)' }} />
              Planned
            </span>
            <span>
              <span className="legend-swatch" style={{ background: 'hsl(356, 82%, 89%)' }} />
              Planned - missed
            </span>
            <span>
              <span
                className="legend-swatch"
                style={{ background: 'hsl(34, 92%, 44%)', color: '#fff' }}
              >
                T
              </span>
              As-of Date
            </span>
          </div>
        </div>

        <div className="filter-bar">
          <div className="search-box">
            <Search size={14} />
            <input
              type="text"
              className="input-control"
              placeholder="Filter project, customer, or item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select-control"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            {['Completed', 'In Progress', 'Delayed', 'Not Started'].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            <input
              type="checkbox"
              checked={includeCarryover}
              onChange={(e) => setIncludeCarryover(e.target.checked)}
            />
            Include unfinished carryover items from prior months (Excel default)
          </label>
        </div>

        <div className="table-scroll">
          <table className="data-table gantt-table">
            <thead>
              <tr>
                <th title="Row number in active month schedule">Sr</th>
                <th title="Veda Project No">Project No</th>
                <th title="Customer name from Masters">Customer</th>
                <th title="Deliverable equipment item">Item</th>
                <th className="text-right" title="Final fabrication weight in Metric Tons">
                  Wt (T)
                </th>
                <th title="Scheduled fabrication start date">Plan Start</th>
                <th title="Scheduled fabrication completion date">Plan End</th>
                <th title="Overall item completion percentage">%</th>
                <th title="Current production status">Status</th>
                {gantt.bounds.dates.map((d) => {
                  const isToday = d.iso === asOfDate
                  return (
                    <th
                      key={d.iso}
                      className={`gantt-day-th ${d.isSunday ? 'sunday' : ''} ${
                        isToday ? 'today' : ''
                      }`}
                      title={isToday ? `${d.iso} (Reference Date)` : d.iso}
                    >
                      <div>{d.weekdayShort}</div>
                      <div style={{ fontWeight: 800, fontSize: 11 }}>{d.day}</div>
                    </th>
                  )
                })}
                <th
                  className="text-right"
                  title="Count of days logged as Done or Item Completed within this calendar month"
                >
                  Done (mo)
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10 + gantt.bounds.dates.length}
                    style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}
                  >
                    No scheduled items match {formatMonthLabel(monthKey)}. Try switching to Jul,
                    Aug, Sep, or Oct 2026.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.item.id}>
                    <td className="mono">{row.gantt_sr}</td>
                    <td className="mono nowrap" style={{ fontWeight: 700 }}>
                      {row.item.project_no}
                    </td>
                    <td
                      style={{
                        maxWidth: 130,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={row.item.customer_name}
                    >
                      {row.item.customer_name}
                    </td>
                    <td className="nowrap" style={{ fontWeight: 600 }}>
                      {row.item.item_description}
                    </td>
                    <td className="mono text-right">
                      {row.item.final_wt_tons > 0 ? row.item.final_wt_tons.toFixed(2) : '—'}
                    </td>
                    <td className="mono nowrap">{formatShortDate(row.item.plan_start)}</td>
                    <td className="mono nowrap">{formatShortDate(row.item.plan_end)}</td>
                    <td>
                      <ProgressDataBar
                        pct={row.item.pct_complete}
                        status={row.item.production_status}
                      />
                    </td>
                    <td>
                      <ProductionStatusBadge status={row.item.production_status} />
                    </td>

                    {row.cells.map((c, idx) => {
                      const dMeta = gantt.bounds.dates[idx]
                      const stateCls =
                        c.cellState !== 'empty'
                          ? `state-${c.cellState}`
                          : dMeta.isSunday
                            ? 'sunday-bg'
                            : ''
                      const tip =
                        c.logs.length > 0
                          ? `${dMeta.iso}: ${c.logs.map((l) => `[${l.status}] ${l.work_done_today}`).join(' | ')}`
                          : `${dMeta.iso} — Click to log work`
                      return (
                        <td
                          key={c.iso}
                          className={`gantt-cell ${stateCls}`}
                          title={tip}
                          onClick={() =>
                            setSelectedCell({
                              item: row.item,
                              isoDate: c.iso,
                              logs: c.logs,
                            })
                          }
                        >
                          {c.symbol}
                        </td>
                      )
                    })}

                    <td className="mono text-right" style={{ fontWeight: 700 }}>
                      {row.daysDoneInMonth}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive Gantt Cell Inspector & Logger Modal */}
      {selectedCell && (
        <div className="backdrop" onClick={() => setSelectedCell(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                  {selectedCell.item.project_no} · {selectedCell.item.item_description}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Date: <strong className="mono">{formatShortDate(selectedCell.isoDate)}</strong> ·
                  Customer: {selectedCell.item.customer_name}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedCell(null)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="panel-body">
              <div>
                <div className="form-section-title">
                  Logged Shop-Floor Entries ({selectedCell.logs.length})
                </div>
                {selectedCell.logs.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    No daily log recorded on {formatShortDate(selectedCell.isoDate)}.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedCell.logs.map((l) => (
                      <div
                        key={l.id}
                        style={{
                          padding: '10px 12px',
                          background: 'var(--bg-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 6,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: 4,
                          }}
                        >
                          <ProductionStatusBadge status={l.status} />
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Logged {formatShortDate(l.log_date)}
                          </span>
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{l.work_done_today}</div>
                        {l.remarks && (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                            Remarks: {l.remarks}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleLogFromGantt} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-section-title">Log Work for {formatShortDate(selectedCell.isoDate)}</div>
                <div className="field-group">
                  <label className="field-label">Work Done *</label>
                  <input
                    type="text"
                    className="input-control input-editable-yellow"
                    placeholder="Describe fabrication / welding / testing activity..."
                    value={newWork}
                    onChange={(e) => setNewWork(e.target.value)}
                    required
                  />
                </div>
                <div className="form-grid-2">
                  <div className="field-group">
                    <label className="field-label">Status</label>
                    <select
                      className="select-control input-editable-yellow"
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                    >
                      {dropdowns.daily_status.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Remarks</label>
                    <input
                      type="text"
                      className="input-control input-editable-yellow"
                      value={newRemarks}
                      onChange={(e) => setNewRemarks(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button type="submit" className="btn btn-accent" disabled={savingCell}>
                    <Plus size={14} />
                    {savingCell ? 'Saving...' : 'Add Daily Log'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
