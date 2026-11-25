// server/excelService.ts
import * as XLSX from "xlsx";

// src/shared/calculations.ts
function isIsoDate(val) {
  if (!val) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
}
function diffDays(laterIso, earlierIso) {
  const [y1, m1, d1] = laterIso.split("-").map(Number);
  const [y2, m2, d2] = earlierIso.split("-").map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc1 - utc2) / 864e5);
}
function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m) return monthKey;
  return `${months[m - 1]} ${y}`;
}
function getMonthBounds(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wd = dt.getUTCDay();
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    dates.push({
      iso,
      day: d,
      weekdayShort: weekdays[wd],
      isSunday: wd === 0
    });
  }
  return {
    startIso: `${y}-${String(m).padStart(2, "0")}-01`,
    endIso: `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
    daysInMonth,
    dates
  };
}
function addMonths(monthKey, offset) {
  const [y, m] = monthKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
function emptyMisCost(monthKey) {
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
    remark: ""
  };
}
function computeWorkspaceAnalytics(params) {
  const { projects, otmItems, dailyLogs, misCosts, misStartMonth, asOfDate } = params;
  const projectMap = /* @__PURE__ */ new Map();
  for (const p of projects) {
    projectMap.set(p.project_no.trim(), p);
  }
  const otmPairCount = /* @__PURE__ */ new Map();
  for (const item of otmItems) {
    if (!item.project_no.trim()) continue;
    const key = `${item.project_no.trim()}||${item.item_description.trim()}`;
    otmPairCount.set(key, (otmPairCount.get(key) || 0) + 1);
  }
  const logsByItemKey = /* @__PURE__ */ new Map();
  const computedDailyLogs = dailyLogs.map((log) => {
    const pNo = log.project_no.trim();
    const iDesc = log.item_description.trim();
    const proj = projectMap.get(pNo);
    const customer_name = proj ? proj.customer_name : "";
    const effective_date = isIsoDate(log.actual_completion_date) ? log.actual_completion_date.trim() : isIsoDate(log.log_date) ? log.log_date.trim() : "";
    let entry_check = "OK";
    if (!pNo && !iDesc && !log.work_done_today.trim()) {
      entry_check = "";
    } else if (!isIsoDate(log.log_date)) {
      entry_check = "Enter date";
    } else if (!pNo) {
      entry_check = "Enter Project No";
    } else if (!iDesc) {
      entry_check = "Select Item";
    } else if (!otmPairCount.has(`${pNo}||${iDesc}`)) {
      entry_check = "Item not in OTM - fix name";
    } else if (!log.status.trim()) {
      entry_check = "Select Status";
    }
    const computedLog = {
      ...log,
      customer_name,
      effective_date,
      entry_check
    };
    const itemKey = `${pNo}||${iDesc}`;
    const arr = logsByItemKey.get(itemKey);
    if (arr) arr.push(computedLog);
    else logsByItemKey.set(itemKey, [computedLog]);
    return computedLog;
  });
  let srCounter = 0;
  const computedOtmItems = otmItems.filter((item) => item.project_no.trim() !== "").map((item) => {
    srCounter += 1;
    const pNo = item.project_no.trim();
    const iDesc = item.item_description.trim();
    const proj = projectMap.get(pNo);
    const customer_name = proj ? proj.customer_name : "(not in Masters)";
    const wtDraw = item.wt_drawing_kg && item.wt_drawing_kg > 0 ? item.wt_drawing_kg : 0;
    const wtCost = item.wt_cost_sheet_kg && item.wt_cost_sheet_kg > 0 ? item.wt_cost_sheet_kg : 0;
    const rawKg = wtDraw > 0 ? wtDraw : wtCost;
    const final_wt_tons = Math.round(rawKg / 1e3 * 1e3) / 1e3;
    const hasStart = isIsoDate(item.plan_start);
    const hasEnd = isIsoDate(item.plan_end);
    const plan_days = hasStart && hasEnd ? diffDays(item.plan_end.trim(), item.plan_start.trim()) + 1 : null;
    const itemLogs = logsByItemKey.get(`${pNo}||${iDesc}`) || [];
    const days_logged = itemLogs.length;
    let days_done = 0;
    let hasItemCompletedLog = false;
    let minNonNotDoneDate = null;
    let maxDoneDate = null;
    for (const l of itemLogs) {
      const st = l.status.trim();
      if (st === "Done" || st === "Item Completed") {
        days_done += 1;
        if (st === "Item Completed") hasItemCompletedLog = true;
        if (isIsoDate(l.effective_date)) {
          if (!maxDoneDate || l.effective_date > maxDoneDate) {
            maxDoneDate = l.effective_date;
          }
        }
      }
      if (st !== "Not Done" && isIsoDate(l.effective_date)) {
        if (!minNonNotDoneDate || l.effective_date < minNonNotDoneDate) {
          minNonNotDoneDate = l.effective_date;
        }
      }
    }
    const actual_start = days_done === 0 ? null : minNonNotDoneDate;
    const last_done_date = days_done === 0 ? null : maxDoneDate;
    const hasDispatch = isIsoDate(item.actual_dispatch_date);
    let production_status;
    if (hasDispatch || hasItemCompletedLog || plan_days !== null && plan_days > 0 && days_done >= plan_days) {
      production_status = "Completed";
    } else if (proj?.project_status === "Hold") {
      production_status = "On Hold";
    } else if (!hasStart && !hasEnd && days_logged === 0) {
      production_status = "Not Planned";
    } else if (hasEnd && item.plan_end.trim() < asOfDate) {
      production_status = "Delayed";
    } else if (days_done > 0) {
      production_status = "In Progress";
    } else {
      production_status = "Not Started";
    }
    const pct_complete = production_status === "Completed" ? 1 : plan_days !== null && plan_days > 0 ? Math.min(1, days_done / plan_days) : 0;
    const completion_date = production_status === "Completed" ? hasDispatch ? item.actual_dispatch_date.trim() : last_done_date ? last_done_date : hasEnd ? item.plan_end.trim() : null : null;
    const committed_delivery_date = isIsoDate(item.revised_agreed_date) ? item.revised_agreed_date.trim() : isIsoDate(item.customer_delivery_date) ? item.customer_delivery_date.trim() : hasEnd ? item.plan_end.trim() : null;
    let delivery_status;
    if (hasDispatch) {
      const disp = item.actual_dispatch_date.trim();
      if (!committed_delivery_date) {
        delivery_status = "Dispatched";
      } else if (disp <= committed_delivery_date) {
        delivery_status = "Dispatched On Time";
      } else {
        delivery_status = "Dispatched Late";
      }
    } else {
      if (!committed_delivery_date) {
        delivery_status = "No Date";
      } else if (committed_delivery_date < asOfDate) {
        delivery_status = "Overdue";
      } else if (diffDays(committed_delivery_date, asOfDate) <= 15) {
        delivery_status = "Due in 15 days";
      } else {
        delivery_status = "Pending";
      }
    }
    let production_late_days = null;
    if (production_status === "Delayed" && hasEnd) {
      production_late_days = diffDays(asOfDate, item.plan_end.trim());
    } else if (production_status === "Completed" && completion_date && hasEnd) {
      production_late_days = Math.max(0, diffDays(completion_date, item.plan_end.trim()));
    }
    let dispatch_late_days = null;
    if (committed_delivery_date) {
      if (hasDispatch) {
        dispatch_late_days = Math.max(
          0,
          diffDays(item.actual_dispatch_date.trim(), committed_delivery_date)
        );
      } else if (committed_delivery_date < asOfDate) {
        dispatch_late_days = diffDays(asOfDate, committed_delivery_date);
      }
    }
    const issues_list = [];
    if (customer_name === "(not in Masters)") issues_list.push("Project No not in Masters");
    if (!iDesc) {
      issues_list.push("Item missing");
    } else if ((otmPairCount.get(`${pNo}||${iDesc}`) || 0) > 1) {
      issues_list.push("Duplicate item");
    }
    if (item.remarks.toLowerCase().includes("[check project no]")) {
      issues_list.push("Check Project No (see Remarks)");
    }
    if (item.remarks.toLowerCase().includes("possible duplicate")) {
      issues_list.push("Possible duplicate (see Remarks)");
    }
    if (final_wt_tons === 0) issues_list.push("Weight missing");
    if (!item.fabrication_location.trim()) {
      issues_list.push("Fab. location missing");
    } else if (item.fabrication_location.trim() === "Subvendor" && (!item.sub_vendor.trim() || item.sub_vendor.trim() === "NA")) {
      issues_list.push("Sub-vendor missing");
    }
    if (!hasStart || !hasEnd) {
      issues_list.push("Plan dates missing");
    } else if (item.plan_end.trim() < item.plan_start.trim()) {
      issues_list.push("Plan End before Start");
    }
    const data_check = issues_list.length === 0 ? "OK" : issues_list.join("; ");
    const is_attention = production_status === "Delayed" || delivery_status === "Overdue";
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
      is_attention
    };
  });
  const enrichedProjects = projects.map((p) => {
    const pItems = computedOtmItems.filter((i) => i.project_no.trim() === p.project_no.trim());
    const total_wt_tons = Math.round(pItems.reduce((acc, cur) => acc + cur.final_wt_tons, 0) * 1e3) / 1e3;
    return {
      ...p,
      items_in_otm: pItems.length,
      total_wt_tons
    };
  });
  const uniqueOtmProjectNos = Array.from(
    new Set(computedOtmItems.map((i) => i.project_no.trim()))
  ).sort((a, b) => a.localeCompare(b));
  const projectWiseSummary = uniqueOtmProjectNos.map((pNo) => {
    const pItems = computedOtmItems.filter((i) => i.project_no.trim() === pNo);
    const proj = projectMap.get(pNo);
    const items = pItems.length;
    const wt_tons = Math.round(pItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1e3) / 1e3;
    const completed = pItems.filter((i) => i.production_status === "Completed").length;
    const in_progress = pItems.filter((i) => i.production_status === "In Progress").length;
    const delayed = pItems.filter((i) => i.production_status === "Delayed").length;
    const not_started = pItems.filter((i) => i.production_status === "Not Started").length;
    const on_hold = pItems.filter((i) => i.production_status === "On Hold").length;
    const avg_pct = items > 0 ? pItems.reduce((s, i) => s + i.pct_complete, 0) / items : 0;
    const wt_done_tons = Math.round(
      pItems.filter((i) => i.production_status === "Completed").reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
    ) / 1e3;
    const undispatchedDates = pItems.filter((i) => !isIsoDate(i.actual_dispatch_date) && isIsoDate(i.committed_delivery_date)).map((i) => i.committed_delivery_date).sort();
    const next_committed_delivery = undispatchedDates.length > 0 ? undispatchedDates[0] : null;
    let overall_status;
    if (completed === items && items > 0) overall_status = "Completed";
    else if (on_hold > 0) overall_status = "On Hold";
    else if (delayed > 0) overall_status = "Delayed";
    else if (in_progress + completed > 0) overall_status = "In Progress";
    else if (not_started > 0) overall_status = "Not Started";
    else overall_status = "Not Planned";
    return {
      project_no: pNo,
      customer_name: proj?.customer_name || "(not in Masters)",
      items,
      wt_tons,
      completed,
      in_progress,
      delayed,
      not_started,
      avg_pct,
      wt_done_tons,
      next_committed_delivery,
      overall_status
    };
  });
  const costMap = /* @__PURE__ */ new Map();
  for (const c of misCosts) costMap.set(c.month_key, c);
  const misMonths = [];
  for (let idx = 0; idx < 12; idx++) {
    const mKey = addMonths(misStartMonth, idx);
    const { startIso, endIso } = getMonthBounds(mKey);
    const plannedItems = computedOtmItems.filter(
      (i) => isIsoDate(i.plan_end) && i.plan_end >= startIso && i.plan_end <= endIso
    );
    const completedItems = computedOtmItems.filter(
      (i) => isIsoDate(i.completion_date) && i.completion_date >= startIso && i.completion_date <= endIso
    );
    const dispatchedItems = computedOtmItems.filter(
      (i) => isIsoDate(i.actual_dispatch_date) && i.actual_dispatch_date >= startIso && i.actual_dispatch_date <= endIso
    );
    const dispatchedOnTimeItems = dispatchedItems.filter(
      (i) => i.delivery_status === "Dispatched On Time"
    );
    const planned_tonnage = Math.round(plannedItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1e3) / 1e3;
    const achieved_tonnage = Math.round(completedItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1e3) / 1e3;
    const variance_tonnage = Math.round((achieved_tonnage - planned_tonnage) * 1e3) / 1e3;
    const costs = costMap.get(mKey) || emptyMisCost(mKey);
    const fixed_total = costs.rent + costs.electricity + costs.water_bill + costs.tea_snacks + costs.security;
    const subcontract_total = costs.rolling_cost + costs.balekar_crane + costs.local_transport + costs.painting;
    const labour_total = costs.vepl + costs.royal + costs.chaitanya;
    const consumables_total = costs.paint + costs.industrial_gas + costs.consumables;
    const total_expenses_rs = fixed_total + subcontract_total + labour_total + consumables_total + costs.food_local_purchase + costs.repair_maintenance;
    const output_completed_tons = achieved_tonnage;
    const cost_per_kg_rs = output_completed_tons > 0 ? total_expenses_rs / (output_completed_tons * 1e3) : null;
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
      on_time_dispatch_pct: dispatchedItems.length > 0 ? dispatchedOnTimeItems.length / dispatchedItems.length : null,
      costs,
      fixed_total,
      subcontract_total,
      labour_total,
      consumables_total,
      total_expenses_rs,
      output_completed_tons,
      cost_per_kg_rs
    });
  }
  const total_items = computedOtmItems.length;
  const total_weight_tons = Math.round(computedOtmItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1e3) / 1e3;
  const countByStatus = (st) => computedOtmItems.filter((i) => i.production_status === st).length;
  const wtByStatus = (st) => Math.round(
    computedOtmItems.filter((i) => i.production_status === st).reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
  ) / 1e3;
  const kpis = {
    total_items,
    total_weight_tons,
    completed: countByStatus("Completed"),
    in_progress: countByStatus("In Progress"),
    delayed: countByStatus("Delayed"),
    not_started: countByStatus("Not Started"),
    on_hold: countByStatus("On Hold"),
    not_planned: countByStatus("Not Planned"),
    wt_completed_tons: wtByStatus("Completed"),
    delivery_overdue: computedOtmItems.filter((i) => i.delivery_status === "Overdue").length,
    due_in_15_days: computedOtmItems.filter((i) => i.delivery_status === "Due in 15 days").length,
    data_issues: computedOtmItems.filter((i) => i.data_check !== "OK").length,
    with_committed_date: computedOtmItems.filter((i) => isIsoDate(i.committed_delivery_date)).length,
    dispatched_on_time: computedOtmItems.filter(
      (i) => i.delivery_status === "Dispatched On Time"
    ).length,
    dispatched_late: computedOtmItems.filter((i) => i.delivery_status === "Dispatched Late").length,
    delivery_pending: computedOtmItems.filter((i) => i.delivery_status === "Pending").length
  };
  const statusSummary = ["Completed", "In Progress", "Delayed", "Not Started", "On Hold", "Not Planned"].map((st) => ({
    status: st,
    items: countByStatus(st),
    wt_tons: wtByStatus(st)
  }));
  const locationSummary = [
    {
      location: "Shop",
      items: computedOtmItems.filter((i) => i.fabrication_location === "Shop").length,
      wt_tons: Math.round(
        computedOtmItems.filter((i) => i.fabrication_location === "Shop").reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
      ) / 1e3
    },
    {
      location: "Subvendor",
      items: computedOtmItems.filter((i) => i.fabrication_location === "Subvendor").length,
      wt_tons: Math.round(
        computedOtmItems.filter((i) => i.fabrication_location === "Subvendor").reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
      ) / 1e3
    },
    {
      location: "Not set",
      items: computedOtmItems.filter((i) => !i.fabrication_location.trim()).length,
      wt_tons: Math.round(
        computedOtmItems.filter((i) => !i.fabrication_location.trim()).reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
      ) / 1e3
    }
  ];
  const attentionList = computedOtmItems.filter((i) => i.is_attention);
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
    misMonths
  };
}
function computeMonthlyGantt(params) {
  const { monthKey, computedOtmItems, logsByItemKey, asOfDate, includeCarryover = true } = params;
  const bounds = getMonthBounds(monthKey);
  const itemsInMonth = computedOtmItems.filter((item) => {
    if (!isIsoDate(item.plan_start) || !isIsoDate(item.plan_end)) return false;
    if (item.plan_start > bounds.endIso) return false;
    if (item.plan_end >= bounds.startIso) return true;
    if (includeCarryover && item.production_status !== "Completed" && item.production_status !== "On Hold") {
      return true;
    }
    return false;
  });
  const wtPlannedToFinish = Math.round(
    computedOtmItems.filter(
      (i) => isIsoDate(i.plan_end) && i.plan_end >= bounds.startIso && i.plan_end <= bounds.endIso
    ).reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
  ) / 1e3;
  const wtCompletedInMonth = Math.round(
    computedOtmItems.filter(
      (i) => isIsoDate(i.completion_date) && i.completion_date >= bounds.startIso && i.completion_date <= bounds.endIso
    ).reduce((s, i) => s + i.final_wt_tons, 0) * 1e3
  ) / 1e3;
  const delayedCount = itemsInMonth.filter((i) => i.production_status === "Delayed").length;
  const rows = itemsInMonth.map((item, idx) => {
    const itemLogs = logsByItemKey.get(`${item.project_no.trim()}||${item.item_description.trim()}`) || [];
    const byDate = /* @__PURE__ */ new Map();
    for (const l of itemLogs) {
      if (!l.effective_date) continue;
      const existing = byDate.get(l.effective_date);
      if (existing) existing.push(l);
      else byDate.set(l.effective_date, [l]);
    }
    let daysDoneInMonth = 0;
    const cells = bounds.dates.map((d) => {
      const dayLogs = byDate.get(d.iso) || [];
      const hasDone = dayLogs.some(
        (l) => l.status === "Done" || l.status === "Item Completed"
      );
      const hasLogged = dayLogs.length > 0;
      if (hasDone) daysDoneInMonth += 1;
      const symbol = hasDone ? "\u2713" : hasLogged ? "\u25CB" : "";
      const inPlannedWindow = d.iso >= item.plan_start && d.iso <= item.plan_end;
      const isMissed = d.iso < asOfDate && item.production_status !== "Completed" && (inPlannedWindow || item.production_status === "Delayed" && d.iso > item.plan_end);
      let cellState = "empty";
      if (symbol === "\u2713") cellState = "done";
      else if (symbol === "\u25CB") cellState = "logged";
      else if (isMissed) cellState = "missed";
      else if (inPlannedWindow) cellState = "planned";
      return {
        iso: d.iso,
        symbol,
        cellState,
        inPlannedWindow,
        logs: dayLogs
      };
    });
    return {
      gantt_sr: idx + 1,
      item,
      daysDoneInMonth,
      cells
    };
  });
  return {
    bounds,
    summary: {
      itemsThisMonth: itemsInMonth.length,
      wtPlannedToFinish,
      wtCompletedInMonth,
      delayedCount
    },
    rows
  };
}

// server/excelService.ts
function excelSerialToIso(val) {
  if (val === null || val === void 0 || val === "") return "";
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "number") {
    if (val > 25e3 && val < 8e4) {
      const ms = Date.UTC(1899, 11, 30) + Math.round(val) * 864e5;
      return new Date(ms).toISOString().slice(0, 10);
    }
    return String(val);
  }
  const str = String(val).trim();
  if (!str) return "";
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const num = Math.round(Number(str));
    if (num > 25e3 && num < 8e4) {
      const ms = Date.UTC(1899, 11, 30) + num * 864e5;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed) && str.length >= 6 && !/^na$/i.test(str)) {
    const dt = new Date(parsed);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    if (y >= 2e3 && y <= 2100) return `${y}-${m}-${d}`;
  }
  return str;
}
function toMonthKey(val, fallback) {
  const iso = excelSerialToIso(val);
  if (isIsoDate(iso)) return iso.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(String(val || "").trim())) return String(val).trim();
  return fallback;
}
function cleanStr(val) {
  if (val === null || val === void 0) return "";
  return String(val).trim();
}
function cleanNumOrNull(val) {
  if (val === null || val === void 0 || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const num = Number(String(val).replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : null;
}
function cleanNumZero(val) {
  const n = cleanNumOrNull(val);
  return n !== null ? n : 0;
}
function getCellVal(sheet, addr) {
  if (!sheet) return void 0;
  const cell = sheet[addr];
  return cell ? cell.v : void 0;
}
function parseManufacturingWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false, cellFormula: false });
  const mastersSheet = wb.Sheets["Masters"];
  const projects = [];
  const subVendors = [];
  const dropdowns = {
    material_status: [],
    fabrication_location: [],
    drawing_status: [],
    daily_status: [],
    project_status: []
  };
  if (mastersSheet) {
    const seenProjs = /* @__PURE__ */ new Set();
    for (let r = 5; r <= 300; r++) {
      const pNo = cleanStr(getCellVal(mastersSheet, `A${r}`));
      const cust = cleanStr(getCellVal(mastersSheet, `B${r}`));
      const stRaw = cleanStr(getCellVal(mastersSheet, `C${r}`));
      if (pNo && !seenProjs.has(pNo)) {
        seenProjs.add(pNo);
        const project_status = stRaw === "Hold" || stRaw === "Closed" ? stRaw : "Active";
        projects.push({
          project_no: pNo,
          customer_name: cust,
          project_status
        });
      }
      const sv = cleanStr(getCellVal(mastersSheet, `G${r}`));
      if (sv && sv.toUpperCase() !== "NA" && !subVendors.includes(sv)) {
        subVendors.push(sv);
      }
      const mat = cleanStr(getCellVal(mastersSheet, `I${r}`));
      if (mat && !dropdowns.material_status.includes(mat)) dropdowns.material_status.push(mat);
      const loc = cleanStr(getCellVal(mastersSheet, `J${r}`));
      if (loc && !dropdowns.fabrication_location.includes(loc))
        dropdowns.fabrication_location.push(loc);
      const drw = cleanStr(getCellVal(mastersSheet, `K${r}`));
      if (drw && !dropdowns.drawing_status.includes(drw)) dropdowns.drawing_status.push(drw);
      const dSt = cleanStr(getCellVal(mastersSheet, `L${r}`));
      if (dSt && !dropdowns.daily_status.includes(dSt)) dropdowns.daily_status.push(dSt);
      const pSt = cleanStr(getCellVal(mastersSheet, `M${r}`));
      if (pSt && !dropdowns.project_status.includes(pSt)) dropdowns.project_status.push(pSt);
    }
  }
  if (dropdowns.material_status.length === 0) {
    dropdowns.material_status = [
      "Available",
      "Partially Available",
      "Not Available",
      "Ordered / Awaited",
      "NA"
    ];
  }
  if (dropdowns.fabrication_location.length === 0) {
    dropdowns.fabrication_location = ["Shop", "Subvendor"];
  }
  if (dropdowns.drawing_status.length === 0) {
    dropdowns.drawing_status = ["Yes", "No"];
  }
  if (dropdowns.daily_status.length === 0) {
    dropdowns.daily_status = ["Done", "In Progress", "Not Done", "Item Completed"];
  }
  if (dropdowns.project_status.length === 0) {
    dropdowns.project_status = ["Active", "Hold", "Closed"];
  }
  const otmSheet = wb.Sheets["OTM - PROD"];
  const otmItems = [];
  if (otmSheet) {
    const range = XLSX.utils.decode_range(otmSheet["!ref"] || "A1:AO305");
    const maxRow = Math.max(range.e.r + 1, 305);
    let sortIdx = 1;
    for (let r = 5; r <= maxRow; r++) {
      const project_no = cleanStr(getCellVal(otmSheet, `B${r}`));
      const item_description = cleanStr(getCellVal(otmSheet, `D${r}`));
      if (!project_no && !item_description) continue;
      otmItems.push({
        sort_order: sortIdx++,
        project_no,
        item_description,
        wt_cost_sheet_kg: cleanNumOrNull(getCellVal(otmSheet, `E${r}`)),
        wt_drawing_kg: cleanNumOrNull(getCellVal(otmSheet, `F${r}`)),
        drawing_released: cleanStr(getCellVal(otmSheet, `H${r}`)),
        material_status: cleanStr(getCellVal(otmSheet, `I${r}`)),
        material_req_at_shop: excelSerialToIso(getCellVal(otmSheet, `J${r}`)),
        fabrication_location: cleanStr(getCellVal(otmSheet, `K${r}`)),
        sub_vendor: cleanStr(getCellVal(otmSheet, `L${r}`)),
        po_no: cleanStr(getCellVal(otmSheet, `M${r}`)),
        po_date: excelSerialToIso(getCellVal(otmSheet, `N${r}`)),
        po_value_rs: cleanNumOrNull(getCellVal(otmSheet, `O${r}`)),
        subvendor_delivery_date: excelSerialToIso(getCellVal(otmSheet, `P${r}`)),
        advance_amount_rs: cleanNumOrNull(getCellVal(otmSheet, `Q${r}`)),
        advance_date: excelSerialToIso(getCellVal(otmSheet, `R${r}`)),
        customer_delivery_date: excelSerialToIso(getCellVal(otmSheet, `S${r}`)),
        revised_agreed_date: excelSerialToIso(getCellVal(otmSheet, `T${r}`)),
        plan_start: excelSerialToIso(getCellVal(otmSheet, `U${r}`)),
        plan_end: excelSerialToIso(getCellVal(otmSheet, `V${r}`)),
        actual_dispatch_date: excelSerialToIso(getCellVal(otmSheet, `W${r}`)),
        remarks: cleanStr(getCellVal(otmSheet, `X${r}`))
      });
    }
  }
  const dailySheet = wb.Sheets["Daily Plan"];
  const dailyLogs = [];
  if (dailySheet) {
    const range = XLSX.utils.decode_range(dailySheet["!ref"] || "A1:J3005");
    const maxRow = Math.max(range.e.r + 1, 3005);
    for (let r = 5; r <= maxRow; r++) {
      const log_date = excelSerialToIso(getCellVal(dailySheet, `A${r}`));
      const project_no = cleanStr(getCellVal(dailySheet, `B${r}`));
      const item_description = cleanStr(getCellVal(dailySheet, `D${r}`));
      const work_done_today = cleanStr(getCellVal(dailySheet, `E${r}`));
      const status = cleanStr(getCellVal(dailySheet, `F${r}`));
      const actual_completion_date = excelSerialToIso(getCellVal(dailySheet, `G${r}`));
      const remarks = cleanStr(getCellVal(dailySheet, `H${r}`));
      if (!project_no && !item_description && !work_done_today) continue;
      dailyLogs.push({
        log_date,
        project_no,
        item_description,
        work_done_today,
        status,
        actual_completion_date,
        remarks
      });
    }
  }
  const monthlySheet = wb.Sheets["Monthly Plan"];
  const defaultGanttMonth = monthlySheet ? toMonthKey(getCellVal(monthlySheet, "C2"), "2026-10") : "2026-10";
  const misSheet = wb.Sheets["MIS"];
  const misStartMonth = misSheet ? toMonthKey(getCellVal(misSheet, "B4"), "2026-07") : "2026-07";
  const misCosts = [];
  if (misSheet) {
    for (let r = 34; r <= 45; r++) {
      const mKey = toMonthKey(getCellVal(misSheet, `B${r}`), "");
      if (!mKey) continue;
      const rowCost = {
        ...emptyMisCost(mKey),
        rent: cleanNumZero(getCellVal(misSheet, `C${r}`)),
        electricity: cleanNumZero(getCellVal(misSheet, `D${r}`)),
        water_bill: cleanNumZero(getCellVal(misSheet, `E${r}`)),
        tea_snacks: cleanNumZero(getCellVal(misSheet, `F${r}`)),
        security: cleanNumZero(getCellVal(misSheet, `G${r}`)),
        rolling_cost: cleanNumZero(getCellVal(misSheet, `H${r}`)),
        balekar_crane: cleanNumZero(getCellVal(misSheet, `I${r}`)),
        local_transport: cleanNumZero(getCellVal(misSheet, `J${r}`)),
        painting: cleanNumZero(getCellVal(misSheet, `K${r}`)),
        vepl: cleanNumZero(getCellVal(misSheet, `L${r}`)),
        royal: cleanNumZero(getCellVal(misSheet, `M${r}`)),
        chaitanya: cleanNumZero(getCellVal(misSheet, `N${r}`)),
        paint: cleanNumZero(getCellVal(misSheet, `O${r}`)),
        industrial_gas: cleanNumZero(getCellVal(misSheet, `P${r}`)),
        consumables: cleanNumZero(getCellVal(misSheet, `Q${r}`)),
        food_local_purchase: cleanNumZero(getCellVal(misSheet, `R${r}`)),
        repair_maintenance: cleanNumZero(getCellVal(misSheet, `S${r}`)),
        wip_tons: cleanNumZero(getCellVal(misSheet, `V${r}`)),
        remark: cleanStr(getCellVal(misSheet, `X${r}`))
      };
      misCosts.push(rowCost);
    }
  }
  return {
    projects,
    subVendors,
    dropdowns,
    otmItems,
    dailyLogs,
    misCosts,
    misStartMonth,
    defaultGanttMonth
  };
}
function buildExportWorkbook(payload, asOfDate) {
  const wb = XLSX.utils.book_new();
  const analytics = computeWorkspaceAnalytics({
    projects: payload.projects,
    otmItems: payload.otmItems,
    dailyLogs: payload.dailyLogs,
    misCosts: payload.misCosts,
    misStartMonth: payload.settings.mis_start_month,
    asOfDate
  });
  const dashAoA = [
    ["PRODUCTION DASHBOARD"],
    [`As on ${asOfDate} | Generated by ForgePlan MES`],
    [],
    [
      "",
      "Total Items",
      "Total Weight (T)",
      "Completed",
      "In Progress",
      "Delayed",
      "Not Started",
      "On Hold",
      "Not Planned",
      "Wt Completed (T)",
      "Delivery Overdue",
      "Due in 15 Days",
      "Data Issues"
    ],
    [
      "",
      analytics.kpis.total_items,
      analytics.kpis.total_weight_tons,
      analytics.kpis.completed,
      analytics.kpis.in_progress,
      analytics.kpis.delayed,
      analytics.kpis.not_started,
      analytics.kpis.on_hold,
      analytics.kpis.not_planned,
      analytics.kpis.wt_completed_tons,
      analytics.kpis.delivery_overdue,
      analytics.kpis.due_in_15_days,
      analytics.kpis.data_issues
    ],
    [],
    ["", "Status Summary"],
    ["", "Status", "Items", "Wt (T)"],
    ...analytics.statusSummary.map((s) => ["", s.status, s.items, s.wt_tons]),
    [],
    ["", "Project-wise Summary"],
    [
      "",
      "Project No",
      "Customer",
      "Items",
      "Wt (T)",
      "Completed",
      "In Progress",
      "Delayed",
      "Not Started",
      "Avg % Complete",
      "Wt Done (T)",
      "Next Committed Delivery",
      "Overall Status"
    ],
    ...analytics.projectWiseSummary.map((p) => [
      "",
      p.project_no,
      p.customer_name,
      p.items,
      p.wt_tons,
      p.completed,
      p.in_progress,
      p.delayed,
      p.not_started,
      Math.round(p.avg_pct * 1e3) / 10 + "%",
      p.wt_done_tons,
      p.next_committed_delivery || "",
      p.overall_status
    ])
  ];
  const dashSheet = XLSX.utils.aoa_to_sheet(dashAoA);
  XLSX.utils.book_append_sheet(wb, dashSheet, "Dashboard");
  const otmAoA = [
    ["OTM - PROD  |  Master Item Register"],
    ["One row = one item."],
    ["ITEM", "", "", "", "WEIGHT", "", "", "DRAWING & MATERIAL", "", "", "FABRICATION / SUB-VENDOR / PO", "", "", "", "", "", "", "", "SCHEDULE & DISPATCH", "", "", "", "", "", "AUTOMATIC - PROGRESS, STATUS & DELIVERY"],
    [
      "Sr No",
      // A
      "Project No",
      // B
      "Customer Name",
      // C
      "Item Description",
      // D
      "Wt (Kg) as per Cost Sheet",
      // E
      "Wt (Kg) as per Drawing",
      // F
      "Final Wt (Tons)",
      // G
      "Drawing Released?",
      // H
      "Material Status",
      // I
      "Material Req. at Shop",
      // J
      "Fabrication Location",
      // K
      "Sub-Vendor",
      // L
      "PO No",
      // M
      "PO Date",
      // N
      "PO Value (Rs.)",
      // O
      "Sub-Vendor Delivery Date",
      // P
      "Advance Amount (Rs.)",
      // Q
      "Advance Date",
      // R
      "Customer Delivery Date",
      // S
      "Revised Agreed Date",
      // T
      "Plan Start (Production)",
      // U
      "Plan End (Production)",
      // V
      "Actual Dispatch Date",
      // W
      "Remarks",
      // X
      "Plan Days",
      // Y
      "Days Logged",
      // Z
      "Days Done",
      // AA
      "Actual Start",
      // AB
      "Last Done Date",
      // AC
      "% Complete",
      // AD
      "Production Status",
      // AE
      "Completion Date",
      // AF
      "Committed Delivery Date",
      // AG
      "Delivery Status",
      // AH
      "Production Late (Days)",
      // AI
      "Dispatch Late (Days)",
      // AJ
      "Data Check"
      // AK
    ],
    ...analytics.computedOtmItems.map((i) => [
      i.sr_no,
      i.project_no,
      i.customer_name,
      i.item_description,
      i.wt_cost_sheet_kg,
      i.wt_drawing_kg,
      i.final_wt_tons,
      i.drawing_released,
      i.material_status,
      i.material_req_at_shop,
      i.fabrication_location,
      i.sub_vendor,
      i.po_no,
      i.po_date,
      i.po_value_rs,
      i.subvendor_delivery_date,
      i.advance_amount_rs,
      i.advance_date,
      i.customer_delivery_date,
      i.revised_agreed_date,
      i.plan_start,
      i.plan_end,
      i.actual_dispatch_date,
      i.remarks,
      i.plan_days,
      i.days_logged,
      i.days_done,
      i.actual_start || "",
      i.last_done_date || "",
      Math.round(i.pct_complete * 1e3) / 1e3,
      i.production_status,
      i.completion_date || "",
      i.committed_delivery_date || "",
      i.delivery_status,
      i.production_late_days,
      i.dispatch_late_days,
      i.data_check
    ])
  ];
  const otmSheet = XLSX.utils.aoa_to_sheet(otmAoA);
  XLSX.utils.book_append_sheet(wb, otmSheet, "OTM - PROD");
  const dailyAoA = [
    ["DAILY PLAN  |  Shop-floor Daily Log"],
    ["One row per item worked on per day."],
    ["Type here", "", "Automatic"],
    [
      "Date",
      // A
      "Project No",
      // B
      "Customer (auto)",
      // C
      "Item (dropdown)",
      // D
      "Work Done Today",
      // E
      "Status",
      // F
      "Actual Completion Date",
      // G
      "Remarks",
      // H
      "Effective Date (auto)",
      // I
      "Entry Check (auto)"
      // J
    ],
    ...analytics.computedDailyLogs.map((l) => [
      l.log_date,
      l.project_no,
      l.customer_name,
      l.item_description,
      l.work_done_today,
      l.status,
      l.actual_completion_date,
      l.remarks,
      l.effective_date,
      l.entry_check
    ])
  ];
  const dailySheet = XLSX.utils.aoa_to_sheet(dailyAoA);
  XLSX.utils.book_append_sheet(wb, dailySheet, "Daily Plan");
  const gantt = computeMonthlyGantt({
    monthKey: payload.settings.default_gantt_month,
    computedOtmItems: analytics.computedOtmItems,
    logsByItemKey: analytics.logsByItemKey,
    asOfDate
  });
  const ganttAoA = [
    ["MONTHLY PLAN  |  Gantt View"],
    [
      "",
      "Select Month \u25B6",
      `${payload.settings.default_gantt_month}-01`,
      "Items this month",
      gantt.summary.itemsThisMonth,
      "",
      "Wt planned to finish (T)",
      "",
      gantt.summary.wtPlannedToFinish,
      "",
      "Wt completed (T)",
      "",
      gantt.summary.wtCompletedInMonth,
      "Delayed items",
      gantt.summary.delayedCount
    ],
    ["Lists every item whose plan falls in the selected month, plus unfinished carryover items."],
    [
      "Sr",
      "Project No",
      "Customer",
      "Item",
      "Wt (T)",
      "Location",
      "Plan Start",
      "Plan End",
      "Committed Delivery",
      "Actual Start",
      "Last Done",
      "%",
      "Status",
      ...gantt.bounds.dates.map((d) => d.weekdayShort),
      "Days Done (month)"
    ],
    [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ...gantt.bounds.dates.map((d) => d.iso),
      ""
    ],
    ...gantt.rows.map((r) => [
      r.gantt_sr,
      r.item.project_no,
      r.item.customer_name,
      r.item.item_description,
      r.item.final_wt_tons,
      r.item.fabrication_location,
      r.item.plan_start,
      r.item.plan_end,
      r.item.committed_delivery_date || "",
      r.item.actual_start || "",
      r.item.last_done_date || "",
      Math.round(r.item.pct_complete * 100) + "%",
      r.item.production_status,
      ...r.cells.map((c) => c.symbol || (c.cellState === "missed" ? "!" : c.cellState === "planned" ? "\u25AA" : "")),
      r.daysDoneInMonth
    ])
  ];
  const ganttSheet = XLSX.utils.aoa_to_sheet(ganttAoA);
  XLSX.utils.book_append_sheet(wb, ganttSheet, "Monthly Plan");
  const misAoA = Array.from({ length: 46 }, () => []);
  misAoA[0] = ["MIS  |  Plan vs Actual, Delivery Performance & Monthly Cost"];
  misAoA[1] = ["Sections A and B are automatic. Section C stores monthly costs (Rs.)."];
  misAoA[3] = ["Start Month \u25B6", `${payload.settings.mis_start_month}-01`, "(12 months shown)"];
  misAoA[5] = ["A.  MONTHLY PLAN vs ACTUAL (Items & Tonnage)"];
  misAoA[6] = [
    "Month",
    "Items Planned to Finish",
    "Items Completed",
    "Planned Tonnage (T)",
    "Achieved Tonnage (T)",
    "Variance (T)",
    "Achievement %",
    "Items Dispatched",
    "Dispatched On Time",
    "On-Time Dispatch %"
  ];
  analytics.misMonths.forEach((m, idx) => {
    misAoA[7 + idx] = [
      `${m.month_key}-01`,
      m.items_planned,
      m.items_completed,
      m.planned_tonnage,
      m.achieved_tonnage,
      m.variance_tonnage,
      m.achievement_pct !== null ? Math.round(m.achievement_pct * 1e3) / 10 + "%" : "",
      m.items_dispatched,
      m.dispatched_on_time,
      m.on_time_dispatch_pct !== null ? Math.round(m.on_time_dispatch_pct * 1e3) / 10 + "%" : ""
    ];
  });
  misAoA[21] = ["B.  DELIVERY PERFORMANCE (all items, as on today)"];
  misAoA[22] = ["Items with a committed delivery date", "", analytics.kpis.with_committed_date];
  misAoA[23] = ["Dispatched on time", "", analytics.kpis.dispatched_on_time];
  misAoA[24] = ["Dispatched late", "", analytics.kpis.dispatched_late];
  misAoA[25] = ["Overdue - not yet dispatched", "", analytics.kpis.delivery_overdue];
  misAoA[26] = ["Due in next 15 days", "", analytics.kpis.due_in_15_days];
  misAoA[27] = ["Pending (later)", "", analytics.kpis.delivery_pending];
  misAoA[30] = ["C.  MONTHLY COST & OUTPUT MIS (Rs.)"];
  misAoA[32] = [
    "Sr",
    "Month",
    "Rent",
    "Electricity",
    "Water Bill",
    "Tea / Snacks",
    "Security",
    "Rolling Cost",
    "Balekar Crane",
    "Local Transport",
    "Painting",
    "VEPL",
    "Royal",
    "Chaitanya",
    "Paint",
    "Industrial Gas",
    "Consumables",
    "Food & Local Purchase",
    "Repairing & Maintenance",
    "Total Expenses (Rs.)",
    "Output - Completed (T)",
    "WIP (T)",
    "Cost per Kg (Rs.)",
    "Remark"
  ];
  analytics.misMonths.forEach((m, idx) => {
    misAoA[33 + idx] = [
      idx + 1,
      `${m.month_key}-01`,
      m.costs.rent,
      m.costs.electricity,
      m.costs.water_bill,
      m.costs.tea_snacks,
      m.costs.security,
      m.costs.rolling_cost,
      m.costs.balekar_crane,
      m.costs.local_transport,
      m.costs.painting,
      m.costs.vepl,
      m.costs.royal,
      m.costs.chaitanya,
      m.costs.paint,
      m.costs.industrial_gas,
      m.costs.consumables,
      m.costs.food_local_purchase,
      m.costs.repair_maintenance,
      m.total_expenses_rs,
      m.output_completed_tons,
      m.costs.wip_tons,
      m.cost_per_kg_rs !== null ? Math.round(m.cost_per_kg_rs * 100) / 100 : "",
      m.costs.remark
    ];
  });
  const misSheet = XLSX.utils.aoa_to_sheet(misAoA);
  XLSX.utils.book_append_sheet(wb, misSheet, "MIS");
  const maxMasterLen = Math.max(
    analytics.enrichedProjects.length,
    payload.subVendors.length,
    payload.dropdowns.material_status.length,
    payload.dropdowns.fabrication_location.length,
    payload.dropdowns.drawing_status.length,
    payload.dropdowns.daily_status.length,
    payload.dropdowns.project_status.length
  );
  const mastersAoA = [
    ["MASTERS - Projects, Sub-Vendors & Dropdown Lists"],
    ["Add a new Project No + Customer here FIRST."],
    ["Type here", "", "Automatic"],
    [
      "Project No",
      // A
      "Customer Name",
      // B
      "Project Status",
      // C
      "Items in OTM",
      // D
      "Total Wt (T)",
      // E
      "",
      // F
      "Sub-Vendor Name",
      // G
      "",
      // H
      "Material Status",
      // I
      "Fabrication Location",
      // J
      "Drawing Status",
      // K
      "Daily Status",
      // L
      "Project Status"
      // M
    ]
  ];
  for (let i = 0; i < maxMasterLen; i++) {
    const p = analytics.enrichedProjects[i];
    const sv = payload.subVendors[i];
    mastersAoA.push([
      p ? p.project_no : "",
      p ? p.customer_name : "",
      p ? p.project_status : "",
      p ? p.items_in_otm : "",
      p ? p.total_wt_tons : "",
      "",
      sv ? sv.name : "",
      "",
      payload.dropdowns.material_status[i] || "",
      payload.dropdowns.fabrication_location[i] || "",
      payload.dropdowns.drawing_status[i] || "",
      payload.dropdowns.daily_status[i] || "",
      payload.dropdowns.project_status[i] || ""
    ]);
  }
  const mastersSheet = XLSX.utils.aoa_to_sheet(mastersAoA);
  XLSX.utils.book_append_sheet(wb, mastersSheet, "Masters");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(out);
}
export {
  buildExportWorkbook,
  parseManufacturingWorkbook
};
