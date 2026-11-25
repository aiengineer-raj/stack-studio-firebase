import { useEffect, useState } from 'react'
import { Lock, Save } from 'lucide-react'
import { api } from '../api.ts'
import type {
  ComputedMisMonthRow,
  MisMonthlyCostRecord,
  UserRole,
} from '../shared/types.ts'
import { ProgressDataBar } from './StatusBadge.tsx'

interface MisViewProps {
  userRole: UserRole
  startMonth: string
  misMonths: ComputedMisMonthRow[]
  deliveryKpis: {
    with_committed_date: number
    dispatched_on_time: number
    dispatched_late: number
    delivery_overdue: number
    due_in_15_days: number
    delivery_pending: number
  }
  onRefresh: () => Promise<void>
  onNotify: (msg: string, isError?: boolean) => void
}

const COST_FIELDS: {
  key: keyof MisMonthlyCostRecord
  label: string
  group: string
}[] = [
  { key: 'rent', label: 'Rent', group: 'Fixed' },
  { key: 'electricity', label: 'Electricity', group: 'Fixed' },
  { key: 'water_bill', label: 'Water Bill', group: 'Fixed' },
  { key: 'tea_snacks', label: 'Tea / Snacks', group: 'Fixed' },
  { key: 'security', label: 'Security', group: 'Fixed' },
  { key: 'rolling_cost', label: 'Rolling Cost', group: 'Subcontract' },
  { key: 'balekar_crane', label: 'Balekar Crane', group: 'Subcontract' },
  { key: 'local_transport', label: 'Local Transport', group: 'Subcontract' },
  { key: 'painting', label: 'Painting', group: 'Subcontract' },
  { key: 'vepl', label: 'VEPL', group: 'Labour' },
  { key: 'royal', label: 'Royal', group: 'Labour' },
  { key: 'chaitanya', label: 'Chaitanya', group: 'Labour' },
  { key: 'paint', label: 'Paint', group: 'Consumables' },
  { key: 'industrial_gas', label: 'Industrial Gas', group: 'Consumables' },
  { key: 'consumables', label: 'Consumables', group: 'Consumables' },
  { key: 'food_local_purchase', label: 'Food & Local', group: 'MISC' },
  { key: 'repair_maintenance', label: 'Repair & Maint.', group: 'R&M' },
]

export function MisView({
  userRole,
  startMonth,
  misMonths,
  deliveryKpis,
  onRefresh,
  onNotify,
}: MisViewProps) {
  const isAdmin = userRole === 'admin'
  const canChangeMonth = userRole === 'admin' || userRole === 'planner'

  const [draftCosts, setDraftCosts] = useState<Record<string, MisMonthlyCostRecord>>({})
  const [dirtyMonths, setDirtyMonths] = useState<Set<string>>(new Set())
  const [savingCosts, setSavingCosts] = useState(false)

  useEffect(() => {
    const next: Record<string, MisMonthlyCostRecord> = {}
    for (const m of misMonths) {
      next[m.month_key] = { ...m.costs }
    }
    setDraftCosts(next)
    setDirtyMonths(new Set())
  }, [misMonths])

  const handleStartMonthChange = async (nextMonth: string) => {
    if (!nextMonth) return
    try {
      await api.updateSettings({ mis_start_month: nextMonth })
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update start month.', true)
    }
  }

  const updateCell = (
    monthKey: string,
    field: keyof MisMonthlyCostRecord,
    rawVal: string
  ) => {
    setDraftCosts((prev) => {
      const existing = prev[monthKey]
      if (!existing) return prev
      const updated = {
        ...existing,
        [field]: field === 'remark' ? rawVal : rawVal === '' ? 0 : Number(rawVal),
      }
      return { ...prev, [monthKey]: updated }
    })
    setDirtyMonths((prev) => {
      const s = new Set(prev)
      s.add(monthKey)
      return s
    })
  }

  const handleSaveAllCosts = async () => {
    if (!isAdmin || dirtyMonths.size === 0) return
    setSavingCosts(true)
    try {
      for (const mk of dirtyMonths) {
        if (draftCosts[mk]) {
          await api.saveMisCost(mk, draftCosts[mk])
        }
      }
      onNotify(`Saved MIS monthly cost ledger (${dirtyMonths.size} month(s) updated)`)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save MIS costs.', true)
    } finally {
      setSavingCosts(false)
    }
  }

  const totalsA = misMonths.reduce(
    (acc, m) => ({
      items_planned: acc.items_planned + m.items_planned,
      items_completed: acc.items_completed + m.items_completed,
      planned_tonnage: acc.planned_tonnage + m.planned_tonnage,
      achieved_tonnage: acc.achieved_tonnage + m.achieved_tonnage,
      variance_tonnage: acc.variance_tonnage + m.variance_tonnage,
      items_dispatched: acc.items_dispatched + m.items_dispatched,
      dispatched_on_time: acc.dispatched_on_time + m.dispatched_on_time,
    }),
    {
      items_planned: 0,
      items_completed: 0,
      planned_tonnage: 0,
      achieved_tonnage: 0,
      variance_tonnage: 0,
      items_dispatched: 0,
      dispatched_on_time: 0,
    }
  )

  const totalDispatchedEver = deliveryKpis.dispatched_on_time + deliveryKpis.dispatched_late
  const onTimePctOverall =
    totalDispatchedEver > 0
      ? `${Math.round((deliveryKpis.dispatched_on_time / totalDispatchedEver) * 100)}%`
      : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header Control */}
      <div
        className="surface-card"
        style={{
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>12-Month MIS Rolling Window Start:</span>
          <input
            type="month"
            className="input-control input-editable-yellow mono"
            value={startMonth}
            disabled={!canChangeMonth}
            onChange={(e) => handleStartMonthChange(e.target.value)}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Sections A &amp; B calculate automatically from OTM-PROD &amp; Daily Plan.
          </span>
        </div>

        {!isAdmin && (
          <span className="permission-pill">
            <Lock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Section C Cost Editing requires Admin / Management role
          </span>
        )}
      </div>

      {/* Section A & B Split */}
      <div className="split-grid-2" style={{ gridTemplateColumns: '1.65fr 1fr' }}>
        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">A. Monthly Plan vs Actual (Items &amp; Tonnage)</div>
              <div className="card-subtitle">
                Planned = Plan End in month · Achieved = Completion Date in month
              </div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Items Planned</th>
                  <th className="text-right">Items Done</th>
                  <th className="text-right">Planned (T)</th>
                  <th className="text-right">Achieved (T)</th>
                  <th className="text-right">Variance (T)</th>
                  <th>Achievement %</th>
                  <th className="text-right">Dispatched</th>
                  <th className="text-right">On Time</th>
                </tr>
              </thead>
              <tbody>
                {misMonths.map((m) => (
                  <tr key={m.month_key}>
                    <td className="nowrap" style={{ fontWeight: 700 }}>
                      {m.month_label}
                    </td>
                    <td className="mono text-right">{m.items_planned}</td>
                    <td className="mono text-right">{m.items_completed}</td>
                    <td className="mono text-right">{m.planned_tonnage.toFixed(3)}</td>
                    <td className="mono text-right">{m.achieved_tonnage.toFixed(3)}</td>
                    <td
                      className="mono text-right"
                      style={{
                        color:
                          m.variance_tonnage < 0
                            ? 'var(--st-delayed-fg)'
                            : m.variance_tonnage > 0
                              ? 'var(--st-completed-fg)'
                              : undefined,
                      }}
                    >
                      {m.variance_tonnage.toFixed(3)}
                    </td>
                    <td>
                      {m.achievement_pct !== null ? (
                        <ProgressDataBar pct={m.achievement_pct} />
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td className="mono text-right">{m.items_dispatched}</td>
                    <td className="mono text-right">{m.dispatched_on_time}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td className="mono text-right">{totalsA.items_planned}</td>
                  <td className="mono text-right">{totalsA.items_completed}</td>
                  <td className="mono text-right">{totalsA.planned_tonnage.toFixed(3)}</td>
                  <td className="mono text-right">{totalsA.achieved_tonnage.toFixed(3)}</td>
                  <td className="mono text-right">{totalsA.variance_tonnage.toFixed(3)}</td>
                  <td>—</td>
                  <td className="mono text-right">{totalsA.items_dispatched}</td>
                  <td className="mono text-right">{totalsA.dispatched_on_time}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">B. Delivery Performance</div>
              <div className="card-subtitle">All items in OTM register, as on selected date</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <table className="data-table" style={{ border: '1px solid var(--border-subtle)' }}>
              <tbody>
                <tr>
                  <td>Items with a committed delivery date</td>
                  <td className="mono text-right" style={{ fontWeight: 700 }}>
                    {deliveryKpis.with_committed_date}
                  </td>
                </tr>
                <tr>
                  <td>Dispatched on time</td>
                  <td className="mono text-right" style={{ color: 'var(--st-completed-fg)', fontWeight: 700 }}>
                    {deliveryKpis.dispatched_on_time}
                  </td>
                </tr>
                <tr>
                  <td>Dispatched late</td>
                  <td className="mono text-right" style={{ color: 'var(--st-delayed-fg)', fontWeight: 700 }}>
                    {deliveryKpis.dispatched_late}
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Overdue — not yet dispatched</td>
                  <td
                    className="mono text-right"
                    style={{
                      background: deliveryKpis.delivery_overdue > 0 ? 'var(--st-delayed-bg)' : undefined,
                      color: deliveryKpis.delivery_overdue > 0 ? 'var(--st-delayed-fg)' : undefined,
                      fontWeight: 700,
                    }}
                  >
                    {deliveryKpis.delivery_overdue}
                  </td>
                </tr>
                <tr>
                  <td>Due in next 15 days</td>
                  <td className="mono text-right" style={{ color: 'var(--st-hold-fg)', fontWeight: 700 }}>
                    {deliveryKpis.due_in_15_days}
                  </td>
                </tr>
                <tr>
                  <td>Pending (later than 15 days)</td>
                  <td className="mono text-right">{deliveryKpis.delivery_pending}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>On-Time Dispatch %</td>
                  <td className="mono text-right" style={{ fontWeight: 700 }}>
                    {onTimePctOverall}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Section C: Monthly Cost & Output MIS */}
      <section className="surface-card">
        <div className="card-header">
          <div>
            <div className="card-title">
              C. Monthly Cost &amp; Output MIS Ledger (Rs. &amp; Cost per Kg)
            </div>
            <div className="card-subtitle">
              {isAdmin
                ? 'Type monthly expenses in yellow cells below and click Save Cost Ledger. Cost/Kg calculates automatically against Completed Output (T).'
                : 'Read-only view of factory cost-per-kg ledger (switch to Admin role to edit monthly expenses).'}
            </div>
          </div>

          {isAdmin && (
            <button
              id="save-mis-costs-btn"
              type="button"
              className="btn btn-accent"
              disabled={dirtyMonths.size === 0 || savingCosts}
              onClick={handleSaveAllCosts}
            >
              <Save size={15} />
              {savingCosts
                ? 'Saving...'
                : dirtyMonths.size > 0
                  ? `Save Cost Ledger (${dirtyMonths.size} modified)`
                  : 'All Costs Saved'}
            </button>
          )}
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th rowSpan={2}>Sr</th>
                <th rowSpan={2}>Month</th>
                <th colSpan={5} className="th-group">
                  Fixed Charges (Rs.)
                </th>
                <th colSpan={4} className="th-group">
                  Sub-Contract Charges (Rs.)
                </th>
                <th colSpan={3} className="th-group">
                  Direct Labour (Rs.)
                </th>
                <th colSpan={3} className="th-group">
                  Consumables (Rs.)
                </th>
                <th className="th-group">MISC</th>
                <th className="th-group">R &amp; M</th>
                <th colSpan={4} className="th-group">
                  Total &amp; Output Efficiency
                </th>
                <th rowSpan={2} className="th-editable">
                  Remark
                </th>
              </tr>
              <tr>
                {COST_FIELDS.map((f) => (
                  <th key={f.key} className="th-editable text-right">
                    {f.label}
                  </th>
                ))}
                <th className="text-right">Total Expenses (Rs.)</th>
                <th className="text-right">Completed (T)</th>
                <th className="th-editable text-right">WIP (T)</th>
                <th className="text-right">Cost / Kg (Rs.)</th>
              </tr>
            </thead>

            <tbody>
              {misMonths.map((m, idx) => {
                const draft = draftCosts[m.month_key] || m.costs
                const liveTotal = COST_FIELDS.reduce(
                  (sum, f) => sum + (Number(draft[f.key]) || 0),
                  0
                )
                const liveCostPerKg =
                  m.output_completed_tons > 0
                    ? liveTotal / (m.output_completed_tons * 1000)
                    : null

                return (
                  <tr key={m.month_key}>
                    <td className="td-auto mono">{idx + 1}</td>
                    <td className="td-auto nowrap" style={{ fontWeight: 700 }}>
                      {m.month_label}
                    </td>

                    {COST_FIELDS.map((f) => (
                      <td key={f.key} className="td-yellow" style={{ padding: 4 }}>
                        {isAdmin ? (
                          <input
                            type="number"
                            step="any"
                            className="input-control input-editable-yellow mono text-right"
                            style={{ width: 92, height: 29, padding: '0 6px', fontSize: 12 }}
                            value={draft[f.key] === 0 ? '' : String(draft[f.key])}
                            placeholder="0"
                            onChange={(e) => updateCell(m.month_key, f.key, e.target.value)}
                          />
                        ) : (
                          <div className="mono text-right" style={{ width: 84 }}>
                            {Number(draft[f.key] || 0).toLocaleString('en-IN')}
                          </div>
                        )}
                      </td>
                    ))}

                    <td className="td-auto mono text-right" style={{ fontWeight: 700 }}>
                      {liveTotal.toLocaleString('en-IN')}
                    </td>
                    <td className="td-auto mono text-right">
                      {m.output_completed_tons.toFixed(3)}
                    </td>
                    <td className="td-yellow" style={{ padding: 4 }}>
                      {isAdmin ? (
                        <input
                          type="number"
                          step="any"
                          className="input-control input-editable-yellow mono text-right"
                          style={{ width: 76, height: 29, padding: '0 6px', fontSize: 12 }}
                          value={draft.wip_tons === 0 ? '' : String(draft.wip_tons)}
                          placeholder="0"
                          onChange={(e) => updateCell(m.month_key, 'wip_tons', e.target.value)}
                        />
                      ) : (
                        <div className="mono text-right">{draft.wip_tons}</div>
                      )}
                    </td>
                    <td
                      className="td-auto mono text-right"
                      style={{ fontWeight: 700, color: 'var(--brand-primary)' }}
                    >
                      {liveCostPerKg !== null ? `₹${liveCostPerKg.toFixed(2)}` : '—'}
                    </td>
                    <td className="td-yellow" style={{ padding: 4 }}>
                      {isAdmin ? (
                        <input
                          type="text"
                          className="input-control input-editable-yellow"
                          style={{ width: 150, height: 29, padding: '0 6px', fontSize: 12 }}
                          value={draft.remark}
                          placeholder="Note..."
                          onChange={(e) => updateCell(m.month_key, 'remark', e.target.value)}
                        />
                      ) : (
                        <span>{draft.remark || '—'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
