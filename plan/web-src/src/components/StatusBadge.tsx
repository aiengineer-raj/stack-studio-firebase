export function ProductionStatusBadge({ status }: { status: string }) {
  let cls = 'st-notplanned'
  if (status === 'Completed' || status === 'Done' || status === 'Item Completed' || status === 'Active') {
    cls = 'st-completed'
  } else if (status === 'In Progress') {
    cls = 'st-progress'
  } else if (status === 'Delayed' || status === 'Overdue' || status === 'Dispatched Late' || status === 'Not Done') {
    cls = 'st-delayed'
  } else if (status === 'On Hold' || status === 'Hold' || status === 'Due in 15 days') {
    cls = 'st-hold'
  } else if (status === 'Not Started' || status === 'Pending' || status === 'Dispatched On Time' || status === 'Dispatched') {
    cls = status === 'Dispatched On Time' ? 'st-completed' : 'st-notstarted'
  }

  return (
    <span className={`status-badge ${cls}`}>
      <span className="status-dot" />
      {status || '—'}
    </span>
  )
}

export function ProgressDataBar({
  pct,
  status,
}: {
  pct: number
  status?: string
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct * 100)))
  const barCls =
    status === 'Completed' || clamped >= 100
      ? 'done'
      : status === 'Delayed'
        ? 'late'
        : ''
  return (
    <div className="databar-wrap">
      <div className="databar-track">
        <div className={`databar-fill ${barCls}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="databar-pct">{clamped}%</span>
    </div>
  )
}
