import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Edit3, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { api } from '../api.ts'
import { formatShortDate } from '../shared/calculations.ts'
import type {
  ComputedDailyLog,
  ComputedOtmItem,
  DropdownLists,
  UserRole,
} from '../shared/types.ts'
import { ProductionStatusBadge } from './StatusBadge.tsx'

interface DailyPlanProps {
  userRole: UserRole
  asOfDate: string
  logs: ComputedDailyLog[]
  otmItems: ComputedOtmItem[]
  dropdowns: DropdownLists
  prefillItem: { projectNo: string; itemDesc: string } | null
  onClearPrefill: () => void
  onRefresh: () => Promise<void>
  onNotify: (msg: string, isError?: boolean) => void
}

export function DailyPlanView({
  asOfDate,
  logs,
  otmItems,
  dropdowns,
  prefillItem,
  onClearPrefill,
  onRefresh,
  onNotify,
}: DailyPlanProps) {
  // All 3 roles (admin, planner, supervisor) can log shop-floor work in Daily Plan
  const [logDate, setLogDate] = useState(asOfDate)
  const [projectNo, setProjectNo] = useState('')
  const [itemDesc, setItemDesc] = useState('')
  const [workDone, setWorkDone] = useState('')
  const [status, setStatus] = useState('Done')
  const [actualCompDate, setActualCompDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDate, setFilterDate] = useState('')

  // Edit modal
  const [editingLog, setEditingLog] = useState<ComputedDailyLog | null>(null)

  const uniqueProjectsInOtm = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of otmItems) {
      if (!map.has(item.project_no)) map.set(item.project_no, item.customer_name)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [otmItems])

  const itemsForSelectedProject = useMemo(() => {
    if (!projectNo) return []
    return Array.from(
      new Set(
        otmItems
          .filter((i) => i.project_no === projectNo)
          .map((i) => i.item_description)
      )
    )
  }, [otmItems, projectNo])

  useEffect(() => {
    if (prefillItem) {
      setProjectNo(prefillItem.projectNo)
      setItemDesc(prefillItem.itemDesc)
      setFilterProject(prefillItem.projectNo)
      onClearPrefill()
    }
  }, [prefillItem, onClearPrefill])

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!logDate || !projectNo || !itemDesc) {
      onNotify('Please select Date, Project No, and Item.', true)
      return
    }
    setSubmitting(true)
    try {
      await api.createDailyLog({
        log_date: logDate,
        project_no: projectNo,
        item_description: itemDesc,
        work_done_today: workDone,
        status,
        actual_completion_date: actualCompDate,
        remarks,
      })
      onNotify(`Logged "${status}" for ${projectNo} — ${itemDesc}`)
      setWorkDone('')
      setRemarks('')
      setActualCompDate('')
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to log daily entry.', true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingLog) return
    try {
      await api.updateDailyLog(editingLog.id, {
        log_date: editingLog.log_date,
        project_no: editingLog.project_no,
        item_description: editingLog.item_description,
        work_done_today: editingLog.work_done_today,
        status: editingLog.status,
        actual_completion_date: editingLog.actual_completion_date,
        remarks: editingLog.remarks,
      })
      onNotify('Updated daily shop-floor entry')
      setEditingLog(null)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed.', true)
    }
  }

  const handleDelete = async (log: ComputedDailyLog) => {
    if (!window.confirm(`Delete daily log for ${log.project_no} - ${log.item_description}?`)) return
    try {
      await api.deleteDailyLog(log.id)
      onNotify('Deleted daily log entry')
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', true)
    }
  }

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (filterProject && l.project_no !== filterProject) return false
      if (filterStatus && l.status !== filterStatus) return false
      if (filterDate && l.log_date !== filterDate) return false
      const q = search.trim().toLowerCase()
      if (q) {
        const hay = `${l.project_no} ${l.customer_name} ${l.item_description} ${l.work_done_today} ${l.remarks}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [logs, filterProject, filterStatus, filterDate, search])

  const counts = useMemo(() => {
    let done = 0
    let notDone = 0
    let inProg = 0
    let itemComp = 0
    for (const l of filteredLogs) {
      if (l.status === 'Done') done++
      else if (l.status === 'Not Done') notDone++
      else if (l.status === 'In Progress') inProg++
      else if (l.status === 'Item Completed') itemComp++
    }
    return { done, notDone, inProg, itemComp }
  }, [filteredLogs])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Quick Shop-Floor Logger */}
      <form className="quick-entry-bar" onSubmit={handleQuickAdd}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Log Shop-Floor Daily Work
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
              Pick Project No → Item dropdown filters automatically. Choose &ldquo;Item Completed&rdquo; when fabrication finishes.
            </span>
          </div>
        </div>

        <div className="quick-entry-grid">
          <div className="field-group">
            <label className="field-label">Date *</label>
            <input
              type="date"
              className="input-control input-editable-yellow mono"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label className="field-label">Project No *</label>
            <select
              id="daily-project-select"
              className="select-control input-editable-yellow"
              value={projectNo}
              onChange={(e) => {
                const nextProj = e.target.value
                setProjectNo(nextProj)
                const firstItem = otmItems.find((i) => i.project_no === nextProj)
                setItemDesc(firstItem ? firstItem.item_description : '')
              }}
              required
            >
              <option value="">Select Project...</option>
              {uniqueProjectsInOtm.map(([pNo, cust]) => (
                <option key={pNo} value={pNo}>
                  {pNo} ({cust})
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">Item (from OTM) *</label>
            <select
              id="daily-item-select"
              className="select-control input-editable-yellow"
              value={itemDesc}
              onChange={(e) => setItemDesc(e.target.value)}
              disabled={!projectNo}
              required
            >
              <option value="">
                {projectNo ? 'Select Item...' : 'Pick Project first'}
              </option>
              {itemsForSelectedProject.map((desc) => (
                <option key={desc} value={desc}>
                  {desc}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">Work Done Today *</label>
            <input
              id="daily-work-input"
              type="text"
              className="input-control input-editable-yellow"
              placeholder='e.g., Shell "L" Seam Welding & Flange Fitting'
              value={workDone}
              onChange={(e) => setWorkDone(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label className="field-label">Status *</label>
            <select
              id="daily-status-select"
              className="select-control input-editable-yellow"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {dropdowns.daily_status.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">Remarks (Optional)</label>
            <input
              type="text"
              className="input-control input-editable-yellow"
              placeholder="Any blocker / note"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          <button
            id="daily-log-submit-btn"
            type="submit"
            className="btn btn-accent"
            style={{ height: 35 }}
            disabled={submitting}
          >
            <Plus size={15} />
            Log Entry
          </button>
        </div>
      </form>

      {/* Log Register Card */}
      <div className="surface-card">
        <div className="card-header">
          <div>
            <div className="card-title">Shop-Floor Daily Log ({filteredLogs.length} entries)</div>
            <div className="card-subtitle">
              Done: <strong className="mono">{counts.done}</strong> · Item Completed:{' '}
              <strong className="mono">{counts.itemComp}</strong> · In Progress:{' '}
              <strong className="mono">{counts.inProg}</strong> · Not Done:{' '}
              <strong className="mono">{counts.notDone}</strong>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <div className="search-box">
            <Search size={14} />
            <input
              type="text"
              className="input-control"
              placeholder="Search work description, item, remarks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select-control"
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
          >
            <option value="">All Projects</option>
            {uniqueProjectsInOtm.map(([pNo, cust]) => (
              <option key={pNo} value={pNo}>
                {pNo} — {cust}
              </option>
            ))}
          </select>

          <select
            className="select-control"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            {dropdowns.daily_status.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="input-control mono"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            title="Filter by log date"
          />

          {(search || filterProject || filterStatus || filterDate) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearch('')
                setFilterProject('')
                setFilterStatus('')
                setFilterDate('')
              }}
            >
              <RotateCcw size={13} /> Clear
            </button>
          )}
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="th-editable">Date</th>
                <th className="th-editable">Project No</th>
                <th>Customer (Auto)</th>
                <th className="th-editable">Item</th>
                <th className="th-editable">Work Done Today</th>
                <th className="th-editable">Status</th>
                <th className="th-editable">Actual Comp. Date</th>
                <th className="th-editable">Remarks</th>
                <th>Effective Date</th>
                <th>Entry Check</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((l) => (
                <tr key={l.id}>
                  <td className="td-yellow mono nowrap">{formatShortDate(l.log_date)}</td>
                  <td className="td-yellow mono nowrap" style={{ fontWeight: 700 }}>
                    {l.project_no}
                  </td>
                  <td
                    className="td-auto"
                    style={{
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {l.customer_name || '—'}
                  </td>
                  <td className="td-yellow" style={{ fontWeight: 600 }}>
                    {l.item_description}
                  </td>
                  <td className="td-yellow" style={{ minWidth: 230 }}>
                    {l.work_done_today}
                  </td>
                  <td className="td-yellow">
                    <ProductionStatusBadge status={l.status} />
                  </td>
                  <td className="td-yellow mono nowrap">
                    {formatShortDate(l.actual_completion_date)}
                  </td>
                  <td className="td-yellow" style={{ fontSize: 12 }}>
                    {l.remarks || '—'}
                  </td>
                  <td className="td-auto mono nowrap">{formatShortDate(l.effective_date)}</td>
                  <td className="td-auto nowrap">
                    {l.entry_check === 'OK' ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: 'var(--st-completed-fg)',
                          fontWeight: 600,
                          fontSize: 11.5,
                        }}
                      >
                        <CheckCircle2 size={13} /> OK
                      </span>
                    ) : (
                      <span style={{ color: 'var(--st-delayed-fg)', fontWeight: 600, fontSize: 11.5 }}>
                        {l.entry_check}
                      </span>
                    )}
                  </td>
                  <td className="nowrap">
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingLog(l)}
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-ghost btn-sm"
                        onClick={() => handleDelete(l)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Daily Log Modal */}
      {editingLog && (
        <div className="backdrop" onClick={() => setEditingLog(null)}>
          <form
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEdit}
          >
            <div className="panel-header">
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Edit Daily Plan Entry</h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditingLog(null)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="panel-body">
              <div className="form-grid-2">
                <div className="field-group">
                  <label className="field-label">Date</label>
                  <input
                    type="date"
                    className="input-control input-editable-yellow mono"
                    value={editingLog.log_date}
                    onChange={(e) => setEditingLog({ ...editingLog, log_date: e.target.value })}
                    required
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Status</label>
                  <select
                    className="select-control input-editable-yellow"
                    value={editingLog.status}
                    onChange={(e) => setEditingLog({ ...editingLog, status: e.target.value })}
                  >
                    {dropdowns.daily_status.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="field-group">
                  <label className="field-label">Project No</label>
                  <input
                    type="text"
                    className="input-control mono"
                    value={editingLog.project_no}
                    onChange={(e) => setEditingLog({ ...editingLog, project_no: e.target.value })}
                    required
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Item Description</label>
                  <input
                    type="text"
                    className="input-control"
                    value={editingLog.item_description}
                    onChange={(e) =>
                      setEditingLog({ ...editingLog, item_description: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Work Done Today</label>
                <textarea
                  rows={2}
                  className="input-control input-editable-yellow"
                  value={editingLog.work_done_today}
                  onChange={(e) =>
                    setEditingLog({ ...editingLog, work_done_today: e.target.value })
                  }
                />
              </div>

              <div className="form-grid-2">
                <div className="field-group">
                  <label className="field-label">
                    Actual Completion Date (only if different day)
                  </label>
                  <input
                    type="date"
                    className="input-control input-editable-yellow mono"
                    value={editingLog.actual_completion_date}
                    onChange={(e) =>
                      setEditingLog({ ...editingLog, actual_completion_date: e.target.value })
                    }
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Remarks</label>
                  <input
                    type="text"
                    className="input-control input-editable-yellow"
                    value={editingLog.remarks}
                    onChange={(e) => setEditingLog({ ...editingLog, remarks: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="panel-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingLog(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
