import { ArrowRight, CheckCircle2 } from 'lucide-react'
import type { AuditEntry } from '../api.ts'
import { ProductionStatusBadge } from './StatusBadge.tsx'

export function GuideAndAuditView({
  auditLogs,
  onNavigate,
}: {
  auditLogs: AuditEntry[]
  onNavigate: (tab: 'dashboard' | 'otm' | 'daily' | 'gantt' | 'mis' | 'masters') => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="split-grid-2">
        {/* Daily Routine Workflow */}
        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">Daily Shop &amp; Planning Routine</div>
              <div className="card-subtitle">
                OTM (items) → Daily Plan (daily work) → Monthly Plan, Dashboard &amp; MIS update
                automatically
              </div>
            </div>
          </div>

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              {
                step: '1. New Project',
                desc: 'Add Project No + Customer in Masters first so customer name & Hold status cascade everywhere.',
                target: 'masters' as const,
                role: 'Admin',
              },
              {
                step: '2. New Item',
                desc: 'In OTM - PROD, pick Project No, enter Item Description, Weight, Fabrication Location, Plan Start & Plan End.',
                target: 'otm' as const,
                role: 'Planner / Admin',
              },
              {
                step: '3. Every Day on Shop Floor',
                desc: 'In Daily Plan, log Date → Project No → Item → Work Done → Status. Entry Check confirms OK.',
                target: 'daily' as const,
                role: 'Supervisor / Planner / Admin',
              },
              {
                step: '4. Item Finished & Dispatched',
                desc: 'Mark last day Status as "Item Completed" in Daily Plan or enter Actual Dispatch Date in OTM - PROD.',
                target: 'otm' as const,
                role: 'Supervisor / Planner',
              },
              {
                step: '5. Monthly Schedule & Cost Review',
                desc: 'Inspect Gantt bars in Monthly Plan, Delayed Attention List on Dashboard, and Cost/Kg in MIS.',
                target: 'gantt' as const,
                role: 'All / Management',
              },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {item.step}{' '}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--brand-accent)',
                        marginLeft: 6,
                      }}
                    >
                      [{item.role}]
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {item.desc}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onNavigate(item.target)}
                >
                  Open <ArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Production & Formula Rules */}
        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">Automatic Production &amp; Delivery Rules</div>
              <div className="card-subtitle">
                Exact formula logic preserved from Manufacturing_Monthly_Plan_Improved.xlsx
              </div>
            </div>
          </div>

          <div style={{ padding: 16 }}>
            <table className="data-table" style={{ border: '1px solid var(--border-subtle)' }}>
              <thead>
                <tr>
                  <th>Status / Metric</th>
                  <th>Calculation Rule</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <ProductionStatusBadge status="Completed" />
                  </td>
                  <td>
                    Dispatch date entered, OR Daily Plan says &ldquo;Item Completed&rdquo;, OR
                    Done-days ≥ Plan days.
                  </td>
                </tr>
                <tr>
                  <td>
                    <ProductionStatusBadge status="On Hold" />
                  </td>
                  <td>Project marked &ldquo;Hold&rdquo; in Masters.</td>
                </tr>
                <tr>
                  <td>
                    <ProductionStatusBadge status="Delayed" />
                  </td>
                  <td>Plan End date has passed (before As-of Date) and item is not Completed.</td>
                </tr>
                <tr>
                  <td>
                    <ProductionStatusBadge status="In Progress" />
                  </td>
                  <td>At least one &ldquo;Done&rdquo; day logged, Plan End not yet passed.</td>
                </tr>
                <tr>
                  <td>
                    <ProductionStatusBadge status="Not Started" />
                  </td>
                  <td>Planned dates set, but nothing logged as Done yet.</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>Final Weight (T)</td>
                  <td>Wt as per Drawing (Kg) if filled, else Wt as per Cost Sheet (Kg), ÷ 1000.</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>Committed Delivery</td>
                  <td>Revised Agreed Date → else Customer Delivery Date → else Plan End.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Live Audit Log */}
      <section className="surface-card">
        <div className="card-header">
          <div>
            <div className="card-title">Recent Workspace Activity &amp; Audit Log</div>
            <div className="card-subtitle">
              Tracks changes across Management, Production Planners, Shop-Floor Supervisors &amp;
              Excel Sync
            </div>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: 300 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((a) => (
                <tr key={a.id}>
                  <td className="mono nowrap" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.user_name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{a.user_role}</td>
                  <td className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
                    <CheckCircle2
                      size={12}
                      color="var(--st-completed-fg)"
                      style={{ verticalAlign: 'middle', marginRight: 5 }}
                    />
                    {a.action}
                  </td>
                  <td>{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
