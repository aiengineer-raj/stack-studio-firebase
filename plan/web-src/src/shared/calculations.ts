import type {
  ComputedDailyLog,
  ComputedMisMonthRow,
  ComputedOtmItem,
  DailyLogRecord,
  DeliveryStatus,
  EnrichedProject,
  MasterProject,
  MisMonthlyCostRecord,
  OtmItemRecord,
  ProductionStatus,
} from './types.ts'

export function isIsoDate(val: string | null | undefined): val is string {
  if (!val) return false
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim())
}

export function diffDays(laterIso: string, earlierIso: string): number {
  const [y1, m1, d1] = laterIso.split('-').map(Number)
  const [y2, m2, d2] = earlierIso.split('-').map(Number)
  const utc1 = Date.UTC(y1, m1 - 1, d1)
  const utc2 = Date.UTC(y2, m2 - 1, d2)
  return Math.round((utc1 - utc2) / 86400000)
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return iso || '—'
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(d).padStart(2, '0')}-${months[m - 1]}-${String(y).slice(2)}`
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (!y || !m) return monthKey
  return `${months[m - 1]} ${y}`
}

export function getMonthBounds(monthKey: string): {
  startIso: string
  endIso: string
  daysInMonth: number
  dates: { iso: string; day: number; weekdayShort: string; isSunday: boolean }[]
} {
  const [y, m] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const dates: { iso: string; day: number; weekdayShort: string; isSunday: boolean }[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d))
    const wd = dt.getUTCDay()
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    dates.push({
      iso,
      day: d,
      weekdayShort: weekdays[wd],
      isSunday: wd === 0,
    })
  }
  return {
    startIso: `${y}-${String(m).padStart(2, '0')}-01`,
    endIso: `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
    daysInMonth,
    dates,
  }
}

export function addMonths(monthKey: string, offset: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + offset, 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

export function emptyMisCost(monthKey: string): MisMonthlyCostRecord {
  return {
    month_key: monthKey,
    rent: 0,
    electricity: 0,
    water_bill: 0,
    tea_snacks: 0,
    security: 0,
    rolling_cost: 0,
    balekar_crane: 0,
    local_transport: 0,
    painting: 0,
    vepl: 0,
    royal: 0,
    chaitanya: 0,
    paint: 0,
    industrial_gas: 0,
    consumables: 0,
    food_local_purchase: 0,
    repair_maintenance: 0,
    wip_tons: 0,
    remark: '',
  }
}

/**
 * Computes all derived columns for OTM-PROD, Daily Plan, Masters, Dashboard & MIS
 * matching 100% of the formulas in Manufacturing_Monthly_Plan_Improved.xlsx.
 */
export function computeWorkspaceAnalytics(params: {
  projects: MasterProject[]
  otmItems: OtmItemRecord[]
  dailyLogs: DailyLogRecord[]
  misCosts: MisMonthlyCostRecord[]
  misStartMonth: string
  asOfDate: string // YYYY-MM-DD (equivalent to Excel TODAY())
}) {
  const { projects, otmItems, dailyLogs, misCosts, misStartMonth, asOfDate } = params

  const projectMap = new Map<string, MasterProject>()
  for (const p of projects) {
    projectMap.set(p.project_no.trim(), p)
  }

  // Index OTM items by "project_no||item_description" for duplicate check & Daily Plan validation
  const otmPairCount = new Map<string, number>()
  for (const item of otmItems) {
    if (!item.project_no.trim()) continue
    const key = `${item.project_no.trim()}||${item.item_description.trim()}`
    otmPairCount.set(key, (otmPairCount.get(key) || 0) + 1)
  }

  // Compute Daily Logs & index them per OTM item key
  const logsByItemKey = new Map<string, ComputedDailyLog[]>()
  const computedDailyLogs: ComputedDailyLog[] = dailyLogs.map((log) => {
    const pNo = log.project_no.trim()
    const iDesc = log.item_description.trim()
    const proj = projectMap.get(pNo)
    const customer_name = proj ? proj.customer_name : ''
    const effective_date = isIsoDate(log.actual_completion_date)
      ? log.actual_completion_date.trim()
      : isIsoDate(log.log_date)
        ? log.log_date.trim()
        : ''

    let entry_check = 'OK'
    if (!pNo && !iDesc && !log.work_done_today.trim()) {
      entry_check = ''
    } else if (!isIsoDate(log.log_date)) {
      entry_check = 'Enter date'
    } else if (!pNo) {
      entry_check = 'Enter Project No'
    } else if (!iDesc) {
      entry_check = 'Select Item'
    } else if (!otmPairCount.has(`${pNo}||${iDesc}`)) {
      entry_check = 'Item not in OTM - fix name'
    } else if (!log.status.trim()) {
      entry_check = 'Select Status'
    }

    const computedLog: ComputedDailyLog = {
      ...log,
      customer_name,
      effective_date,
      entry_check,
    }

    const itemKey = `${pNo}||${iDesc}`
    const arr = logsByItemKey.get(itemKey)
    if (arr) arr.push(computedLog)
    else logsByItemKey.set(itemKey, [computedLog])

    return computedLog
  })

  // Compute OTM Items
  let srCounter = 0
  const computedOtmItems: ComputedOtmItem[] = otmItems
    .filter((item) => item.project_no.trim() !== '')
    .map((item) => {
      srCounter += 1
      const pNo = item.project_no.trim()
      const iDesc = item.item_description.trim()
      const proj = projectMap.get(pNo)
      const customer_name = proj ? proj.customer_name : '(not in Masters)'

      const wtDraw = item.wt_drawing_kg && item.wt_drawing_kg > 0 ? item.wt_drawing_kg : 0
      const wtCost = item.wt_cost_sheet_kg && item.wt_cost_sheet_kg > 0 ? item.wt_cost_sheet_kg : 0
      const rawKg = wtDraw > 0 ? wtDraw : wtCost
      const final_wt_tons = Math.round((rawKg / 1000) * 1000) / 1000

      const hasStart = isIsoDate(item.plan_start)
      const hasEnd = isIsoDate(item.plan_end)
      const plan_days =
        hasStart && hasEnd ? diffDays(item.plan_end.trim(), item.plan_start.trim()) + 1 : null

      const itemLogs = logsByItemKey.get(`${pNo}||${iDesc}`) || []
      const days_logged = itemLogs.length

      let days_done = 0
      let hasItemCompletedLog = false
      let minNonNotDoneDate: string | null = null
      let maxDoneDate: string | null = null

      for (const l of itemLogs) {
        const st = l.status.trim()
        if (st === 'Done' || st === 'Item Completed') {
          days_done += 1
          if (st === 'Item Completed') hasItemCompletedLog = true
          if (isIsoDate(l.effective_date)) {
            if (!maxDoneDate || l.effective_date > maxDoneDate) {
              maxDoneDate = l.effective_date
            }
          }
        }
        if (st !== 'Not Done' && isIsoDate(l.effective_date)) {
          if (!minNonNotDoneDate || l.effective_date < minNonNotDoneDate) {
            minNonNotDoneDate = l.effective_date
          }
        }
      }

      const actual_start = days_done === 0 ? null : minNonNotDoneDate
      const last_done_date = days_done === 0 ? null : maxDoneDate

      const hasDispatch = isIsoDate(item.actual_dispatch_date)
      let production_status: ProductionStatus
      if (
        hasDispatch ||
        hasItemCompletedLog ||
        (plan_days !== null && plan_days > 0 && days_done >= plan_days)
      ) {
        production_status = 'Completed'
      } else if (proj?.project_status === 'Hold') {
        production_status = 'On Hold'
      } else if (!hasStart && !hasEnd && days_logged === 0) {
        production_status = 'Not Planned'
      } else if (hasEnd && item.plan_end.trim() < asOfDate) {
        production_status = 'Delayed'
      } else if (days_done > 0) {
        production_status = 'In Progress'
      } else {
        production_status = 'Not Started'
      }

      const pct_complete =
        production_status === 'Completed'
          ? 1
          : plan_days !== null && plan_days > 0
            ? Math.min(1, days_done / plan_days)
            : 0

      const completion_date =
        production_status === 'Completed'
          ? hasDispatch
            ? item.actual_dispatch_date.trim()
            : last_done_date
              ? last_done_date
              : hasEnd
                ? item.plan_end.trim()
                : null
          : null

      const committed_delivery_date = isIsoDate(item.revised_agreed_date)
        ? item.revised_agreed_date.trim()
        : isIsoDate(item.customer_delivery_date)
          ? item.customer_delivery_date.trim()
          : hasEnd
            ? item.plan_end.trim()
            : null

      let delivery_status: DeliveryStatus
      if (hasDispatch) {
        const disp = item.actual_dispatch_date.trim()
        if (!committed_delivery_date) {
          delivery_status = 'Dispatched'
        } else if (disp <= committed_delivery_date) {
          delivery_status = 'Dispatched On Time'
        } else {
          delivery_status = 'Dispatched Late'
        }
      } else {
        if (!committed_delivery_date) {
          delivery_status = 'No Date'
        } else if (committed_delivery_date < asOfDate) {
          delivery_status = 'Overdue'
        } else if (diffDays(committed_delivery_date, asOfDate) <= 15) {
          delivery_status = 'Due in 15 days'
        } else {
          delivery_status = 'Pending'
        }
      }

      let production_late_days: number | null = null
      if (production_status === 'Delayed' && hasEnd) {
        production_late_days = diffDays(asOfDate, item.plan_end.trim())
      } else if (production_status === 'Completed' && completion_date && hasEnd) {
        production_late_days = Math.max(0, diffDays(completion_date, item.plan_end.trim()))
      }

      let dispatch_late_days: number | null = null
      if (committed_delivery_date) {
        if (hasDispatch) {
          dispatch_late_days = Math.max(
            0,
            diffDays(item.actual_dispatch_date.trim(), committed_delivery_date)
          )
        } else if (committed_delivery_date < asOfDate) {
          dispatch_late_days = diffDays(asOfDate, committed_delivery_date)
        }
      }

      // Data Check issues (exact order from AO5 in OTM-PROD)
      const issues_list: string[] = []
      if (customer_name === '(not in Masters)') issues_list.push('Project No not in Masters')
      if (!iDesc) {
        issues_list.push('Item missing')
      } else if ((otmPairCount.get(`${pNo}||${iDesc}`) || 0) > 1) {
        issues_list.push('Duplicate item')
      }
      if (item.remarks.toLowerCase().includes('[check project no]')) {
        issues_list.push('Check Project No (see Remarks)')
      }
      if (item.remarks.toLowerCase().includes('possible duplicate')) {
        issues_list.push('Possible duplicate (see Remarks)')
      }
      if (final_wt_tons === 0) issues_list.push('Weight missing')
      if (!item.fabrication_location.trim()) {
        issues_list.push('Fab. location missing')
      } else if (
        item.fabrication_location.trim() === 'Subvendor' &&
        (!item.sub_vendor.trim() || item.sub_vendor.trim() === 'NA')
      ) {
        issues_list.push('Sub-vendor missing')
      }
      if (!hasStart || !hasEnd) {
        issues_list.push('Plan dates missing')
      } else if (item.plan_end.trim() < item.plan_start.trim()) {
        issues_list.push('Plan End before Start')
      }

      const data_check = issues_list.length === 0 ? 'OK' : issues_list.join('; ')
      const is_attention = production_status === 'Delayed' || delivery_status === 'Overdue'

      return {
        ...item,
        sr_no: srCounter,
        customer_name,
        final_wt_tons,
        plan_days,
        days_logged,
        days_done,
        actual_start,
        last_done_date,
        pct_complete,
        production_status,
        completion_date,
        committed_delivery_date,
        delivery_status,
        production_late_days,
        dispatch_late_days,
        data_check,
        issues_list,
        is_attention,
      }
    })

  // Enriched Masters Projects
  const enrichedProjects: EnrichedProject[] = projects.map((p) => {
    const pItems = computedOtmItems.filter((i) => i.project_no.trim() === p.project_no.trim())
    const total_wt_tons =
      Math.round(pItems.reduce((acc, cur) => acc + cur.final_wt_tons, 0) * 1000) / 1000
    return {
      ...p,
      items_in_otm: pItems.length,
      total_wt_tons,
    }
  })

  // Dashboard Project-wise Summary (unique projects present in OTM, sorted A-Z)
  const uniqueOtmProjectNos = Array.from(
    new Set(computedOtmItems.map((i) => i.project_no.trim()))
  ).sort((a, b) => a.localeCompare(b))

  const projectWiseSummary = uniqueOtmProjectNos.map((pNo) => {
    const pItems = computedOtmItems.filter((i) => i.project_no.trim() === pNo)
    const proj = projectMap.get(pNo)
    const items = pItems.length
    const wt_tons = Math.round(pItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1000) / 1000
    const completed = pItems.filter((i) => i.production_status === 'Completed').length
    const in_progress = pItems.filter((i) => i.production_status === 'In Progress').length
    const delayed = pItems.filter((i) => i.production_status === 'Delayed').length
    const not_started = pItems.filter((i) => i.production_status === 'Not Started').length
    const on_hold = pItems.filter((i) => i.production_status === 'On Hold').length
    const avg_pct =
      items > 0 ? pItems.reduce((s, i) => s + i.pct_complete, 0) / items : 0
    const wt_done_tons =
      Math.round(
        pItems
          .filter((i) => i.production_status === 'Completed')
          .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
      ) / 1000

    const undispatchedDates = pItems
      .filter((i) => !isIsoDate(i.actual_dispatch_date) && isIsoDate(i.committed_delivery_date))
      .map((i) => i.committed_delivery_date as string)
      .sort()
    const next_committed_delivery = undispatchedDates.length > 0 ? undispatchedDates[0] : null

    let overall_status: ProductionStatus
    if (completed === items && items > 0) overall_status = 'Completed'
    else if (on_hold > 0) overall_status = 'On Hold'
    else if (delayed > 0) overall_status = 'Delayed'
    else if (in_progress + completed > 0) overall_status = 'In Progress'
    else if (not_started > 0) overall_status = 'Not Started'
    else overall_status = 'Not Planned'

    return {
      project_no: pNo,
      customer_name: proj?.customer_name || '(not in Masters)',
      items,
      wt_tons,
      completed,
      in_progress,
      delayed,
      not_started,
      avg_pct,
      wt_done_tons,
      next_committed_delivery,
      overall_status,
    }
  })

  // MIS 12-Month rows
  const costMap = new Map<string, MisMonthlyCostRecord>()
  for (const c of misCosts) costMap.set(c.month_key, c)

  const misMonths: ComputedMisMonthRow[] = []
  for (let idx = 0; idx < 12; idx++) {
    const mKey = addMonths(misStartMonth, idx)
    const { startIso, endIso } = getMonthBounds(mKey)
    const plannedItems = computedOtmItems.filter(
      (i) => isIsoDate(i.plan_end) && i.plan_end >= startIso && i.plan_end <= endIso
    )
    const completedItems = computedOtmItems.filter(
      (i) =>
        isIsoDate(i.completion_date) &&
        i.completion_date >= startIso &&
        i.completion_date <= endIso
    )
    const dispatchedItems = computedOtmItems.filter(
      (i) =>
        isIsoDate(i.actual_dispatch_date) &&
        i.actual_dispatch_date >= startIso &&
        i.actual_dispatch_date <= endIso
    )
    const dispatchedOnTimeItems = dispatchedItems.filter(
      (i) => i.delivery_status === 'Dispatched On Time'
    )

    const planned_tonnage =
      Math.round(plannedItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1000) / 1000
    const achieved_tonnage =
      Math.round(completedItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1000) / 1000
    const variance_tonnage = Math.round((achieved_tonnage - planned_tonnage) * 1000) / 1000

    const costs = costMap.get(mKey) || emptyMisCost(mKey)
    const fixed_total =
      costs.rent + costs.electricity + costs.water_bill + costs.tea_snacks + costs.security
    const subcontract_total =
      costs.rolling_cost + costs.balekar_crane + costs.local_transport + costs.painting
    const labour_total = costs.vepl + costs.royal + costs.chaitanya
    const consumables_total = costs.paint + costs.industrial_gas + costs.consumables
    const total_expenses_rs =
      fixed_total +
      subcontract_total +
      labour_total +
      consumables_total +
      costs.food_local_purchase +
      costs.repair_maintenance

    const output_completed_tons = achieved_tonnage
    const cost_per_kg_rs =
      output_completed_tons > 0 ? total_expenses_rs / (output_completed_tons * 1000) : null

    misMonths.push({
      month_key: mKey,
      month_label: formatMonthLabel(mKey),
      items_planned: plannedItems.length,
      items_completed: completedItems.length,
      planned_tonnage,
      achieved_tonnage,
      variance_tonnage,
      achievement_pct: planned_tonnage > 0 ? achieved_tonnage / planned_tonnage : null,
      items_dispatched: dispatchedItems.length,
      dispatched_on_time: dispatchedOnTimeItems.length,
      on_time_dispatch_pct:
        dispatchedItems.length > 0 ? dispatchedOnTimeItems.length / dispatchedItems.length : null,
      costs,
      fixed_total,
      subcontract_total,
      labour_total,
      consumables_total,
      total_expenses_rs,
      output_completed_tons,
      cost_per_kg_rs,
    })
  }

  // Dashboard KPIs
  const total_items = computedOtmItems.length
  const total_weight_tons =
    Math.round(computedOtmItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1000) / 1000
  const countByStatus = (st: ProductionStatus) =>
    computedOtmItems.filter((i) => i.production_status === st).length
  const wtByStatus = (st: ProductionStatus) =>
    Math.round(
      computedOtmItems
        .filter((i) => i.production_status === st)
        .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
    ) / 1000

  const kpis = {
    total_items,
    total_weight_tons,
    completed: countByStatus('Completed'),
    in_progress: countByStatus('In Progress'),
    delayed: countByStatus('Delayed'),
    not_started: countByStatus('Not Started'),
    on_hold: countByStatus('On Hold'),
    not_planned: countByStatus('Not Planned'),
    wt_completed_tons: wtByStatus('Completed'),
    delivery_overdue: computedOtmItems.filter((i) => i.delivery_status === 'Overdue').length,
    due_in_15_days: computedOtmItems.filter((i) => i.delivery_status === 'Due in 15 days').length,
    data_issues: computedOtmItems.filter((i) => i.data_check !== 'OK').length,
    with_committed_date: computedOtmItems.filter((i) => isIsoDate(i.committed_delivery_date))
      .length,
    dispatched_on_time: computedOtmItems.filter(
      (i) => i.delivery_status === 'Dispatched On Time'
    ).length,
    dispatched_late: computedOtmItems.filter((i) => i.delivery_status === 'Dispatched Late')
      .length,
    delivery_pending: computedOtmItems.filter((i) => i.delivery_status === 'Pending').length,
  }

  const statusSummary: { status: ProductionStatus; items: number; wt_tons: number }[] = (
    ['Completed', 'In Progress', 'Delayed', 'Not Started', 'On Hold', 'Not Planned'] as const
  ).map((st) => ({
    status: st,
    items: countByStatus(st),
    wt_tons: wtByStatus(st),
  }))

  const locationSummary = [
    {
      location: 'Shop',
      items: computedOtmItems.filter((i) => i.fabrication_location === 'Shop').length,
      wt_tons:
        Math.round(
          computedOtmItems
            .filter((i) => i.fabrication_location === 'Shop')
            .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
        ) / 1000,
    },
    {
      location: 'Subvendor',
      items: computedOtmItems.filter((i) => i.fabrication_location === 'Subvendor').length,
      wt_tons:
        Math.round(
          computedOtmItems
            .filter((i) => i.fabrication_location === 'Subvendor')
            .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
        ) / 1000,
    },
    {
      location: 'Not set',
      items: computedOtmItems.filter((i) => !i.fabrication_location.trim()).length,
      wt_tons:
        Math.round(
          computedOtmItems
            .filter((i) => !i.fabrication_location.trim())
            .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
        ) / 1000,
    },
  ]

  const attentionList = computedOtmItems.filter((i) => i.is_attention)

  return {
    computedOtmItems,
    computedDailyLogs,
    logsByItemKey,
    enrichedProjects,
    projectWiseSummary,
    attentionList,
    kpis,
    statusSummary,
    locationSummary,
    misMonths,
  }
}

/**
 * Computes Monthly Gantt rows for a given YYYY-MM month.
 * Matches Excel's AL5 formula (`carryover=true`):
 *   plan_start <= EOMONTH(SelMonth, 0) && (plan_end >= SelMonth || (status !== 'Completed' && status !== 'On Hold'))
 */
export function computeMonthlyGantt(params: {
  monthKey: string
  computedOtmItems: ComputedOtmItem[]
  logsByItemKey: Map<string, ComputedDailyLog[]>
  asOfDate: string
  includeCarryover?: boolean
}) {
  const { monthKey, computedOtmItems, logsByItemKey, asOfDate, includeCarryover = true } = params
  const bounds = getMonthBounds(monthKey)

  const itemsInMonth = computedOtmItems.filter((item) => {
    if (!isIsoDate(item.plan_start) || !isIsoDate(item.plan_end)) return false
    if (item.plan_start > bounds.endIso) return false
    if (item.plan_end >= bounds.startIso) return true
    if (
      includeCarryover &&
      item.production_status !== 'Completed' &&
      item.production_status !== 'On Hold'
    ) {
      return true
    }
    return false
  })

  const wtPlannedToFinish =
    Math.round(
      computedOtmItems
        .filter(
          (i) =>
            isIsoDate(i.plan_end) &&
            i.plan_end >= bounds.startIso &&
            i.plan_end <= bounds.endIso
        )
        .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
    ) / 1000

  const wtCompletedInMonth =
    Math.round(
      computedOtmItems
        .filter(
          (i) =>
            isIsoDate(i.completion_date) &&
            i.completion_date >= bounds.startIso &&
            i.completion_date <= bounds.endIso
        )
        .reduce((s, i) => s + i.final_wt_tons, 0) * 1000
    ) / 1000

  const delayedCount = itemsInMonth.filter((i) => i.production_status === 'Delayed').length

  const rows = itemsInMonth.map((item, idx) => {
    const itemLogs =
      logsByItemKey.get(`${item.project_no.trim()}||${item.item_description.trim()}`) || []

    // Map date -> logs on that effective_date
    const byDate = new Map<string, ComputedDailyLog[]>()
    for (const l of itemLogs) {
      if (!l.effective_date) continue
      const existing = byDate.get(l.effective_date)
      if (existing) existing.push(l)
      else byDate.set(l.effective_date, [l])
    }

    let daysDoneInMonth = 0
    const cells = bounds.dates.map((d) => {
      const dayLogs = byDate.get(d.iso) || []
      const hasDone = dayLogs.some(
        (l) => l.status === 'Done' || l.status === 'Item Completed'
      )
      const hasLogged = dayLogs.length > 0
      if (hasDone) daysDoneInMonth += 1

      const symbol: '✓' | '○' | '' = hasDone ? '✓' : hasLogged ? '○' : ''

      const inPlannedWindow = d.iso >= item.plan_start && d.iso <= item.plan_end
      const isMissed =
        d.iso < asOfDate &&
        item.production_status !== 'Completed' &&
        (inPlannedWindow || (item.production_status === 'Delayed' && d.iso > item.plan_end))

      let cellState: 'done' | 'logged' | 'missed' | 'planned' | 'empty' = 'empty'
      if (symbol === '✓') cellState = 'done'
      else if (symbol === '○') cellState = 'logged'
      else if (isMissed) cellState = 'missed'
      else if (inPlannedWindow) cellState = 'planned'

      return {
        iso: d.iso,
        symbol,
        cellState,
        inPlannedWindow,
        logs: dayLogs,
      }
    })

    return {
      gantt_sr: idx + 1,
      item,
      daysDoneInMonth,
      cells,
    }
  })

  return {
    bounds,
    summary: {
      itemsThisMonth: itemsInMonth.length,
      wtPlannedToFinish,
      wtCompletedInMonth,
      delayedCount,
    },
    rows,
  }
}
