export type UserRole = 'admin' | 'project_manager' | 'planner' | 'supervisor'

export function isFullAccessRole(role: UserRole): boolean {
  return role === 'admin' || role === 'project_manager'
}

export function formatRoleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'project_manager':
      return 'Project Manager'
    case 'planner':
      return 'Planner'
    case 'supervisor':
      return 'Supervisor'
    default:
      return role.replace(/_/g, ' ')
  }
}

export interface UserPublic {
  id: number
  email: string
  name: string
  role: UserRole
  department: string
}

export type ProjectStatus = 'Active' | 'Hold' | 'Closed'

export interface MasterProject {
  id: number
  project_no: string
  customer_name: string
  project_status: ProjectStatus
}

export interface EnrichedProject extends MasterProject {
  items_in_otm: number
  total_wt_tons: number
}

export interface SubVendor {
  id: number
  name: string
}

export interface DropdownLists {
  material_status: string[]
  fabrication_location: string[]
  drawing_status: string[]
  daily_status: string[]
  project_status: string[]
}

export interface OtmItemRecord {
  id: number
  sort_order: number
  project_no: string
  item_description: string
  wt_cost_sheet_kg: number | null
  wt_drawing_kg: number | null
  drawing_released: string
  material_status: string
  material_req_at_shop: string
  fabrication_location: string
  sub_vendor: string
  po_no: string
  po_date: string
  po_value_rs: number | null
  subvendor_delivery_date: string
  advance_amount_rs: number | null
  advance_date: string
  customer_delivery_date: string
  revised_agreed_date: string
  plan_start: string
  plan_end: string
  actual_dispatch_date: string
  remarks: string
}

export type ProductionStatus =
  | 'Completed'
  | 'On Hold'
  | 'Delayed'
  | 'In Progress'
  | 'Not Started'
  | 'Not Planned'

export type DeliveryStatus =
  | 'Dispatched On Time'
  | 'Dispatched Late'
  | 'Dispatched'
  | 'Overdue'
  | 'Due in 15 days'
  | 'Pending'
  | 'No Date'

export interface ComputedOtmItem extends OtmItemRecord {
  sr_no: number
  customer_name: string
  final_wt_tons: number
  plan_days: number | null
  days_logged: number
  days_done: number
  actual_start: string | null
  last_done_date: string | null
  pct_complete: number
  production_status: ProductionStatus
  completion_date: string | null
  committed_delivery_date: string | null
  delivery_status: DeliveryStatus
  production_late_days: number | null
  dispatch_late_days: number | null
  data_check: string
  issues_list: string[]
  is_attention: boolean
}

export type DailyWorkStatus = 'Done' | 'In Progress' | 'Not Done' | 'Item Completed'

export interface DailyLogRecord {
  id: number
  log_date: string
  project_no: string
  item_description: string
  work_done_today: string
  status: string
  actual_completion_date: string
  remarks: string
}

export interface ComputedDailyLog extends DailyLogRecord {
  customer_name: string
  effective_date: string
  entry_check: string
}

export interface MisMonthlyCostRecord {
  month_key: string // YYYY-MM (e.g. '2026-07')
  rent: number
  electricity: number
  water_bill: number
  tea_snacks: number
  security: number
  rolling_cost: number
  balekar_crane: number
  local_transport: number
  painting: number
  vepl: number
  royal: number
  chaitanya: number
  paint: number
  industrial_gas: number
  consumables: number
  food_local_purchase: number
  repair_maintenance: number
  wip_tons: number
  remark: string
}

export interface ComputedMisMonthRow {
  month_key: string
  month_label: string
  items_planned: number
  items_completed: number
  planned_tonnage: number
  achieved_tonnage: number
  variance_tonnage: number
  achievement_pct: number | null
  items_dispatched: number
  dispatched_on_time: number
  on_time_dispatch_pct: number | null
  costs: MisMonthlyCostRecord
  fixed_total: number
  subcontract_total: number
  labour_total: number
  consumables_total: number
  total_expenses_rs: number
  output_completed_tons: number
  cost_per_kg_rs: number | null
}

export interface AppSettings {
  mis_start_month: string // YYYY-MM, defaults to '2026-07'
  default_gantt_month: string // YYYY-MM, defaults to '2026-10'
}

export interface WorkspacePayload {
  projects: MasterProject[]
  subVendors: SubVendor[]
  dropdowns: DropdownLists
  otmItems: OtmItemRecord[]
  dailyLogs: DailyLogRecord[]
  misCosts: MisMonthlyCostRecord[]
  settings: AppSettings
}
