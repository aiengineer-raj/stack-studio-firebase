import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { api } from '../api.ts'
import { formatShortDate } from '../shared/calculations.ts'
import type {
  ComputedOtmItem,
  DropdownLists,
  MasterProject,
  SubVendor,
  UserRole,
} from '../shared/types.ts'
import { ProductionStatusBadge, ProgressDataBar } from './StatusBadge.tsx'

export interface OtmFilterPreset {
  projectNo?: string
  prodStatus?: string
  deliveryStatus?: string
  dataCheck?: 'all' | 'issues' | 'ok'
}

interface OtmProdProps {
  userRole: UserRole
  items: ComputedOtmItem[]
  projects: MasterProject[]
  subVendors: SubVendor[]
  dropdowns: DropdownLists
  preset: OtmFilterPreset | null
  onClearPreset: () => void
  onRefresh: () => Promise<void>
  onNotify: (msg: string, isError?: boolean) => void
  onLogWorkForItem: (projectNo: string, itemDesc: string) => void
}

type ColumnGroupMode = 'overview' | 'weights' | 'subvendor' | 'all'

const EMPTY_FORM = {
  project_no: '',
  item_description: '',
  wt_cost_sheet_kg: '',
  wt_drawing_kg: '',
  drawing_released: '',
  material_status: '',
  material_req_at_shop: '',
  fabrication_location: 'Shop',
  sub_vendor: 'NA',
  po_no: '',
  po_date: '',
  po_value_rs: '',
  subvendor_delivery_date: '',
  advance_amount_rs: '',
  advance_date: '',
  customer_delivery_date: '',
  revised_agreed_date: '',
  plan_start: '',
  plan_end: '',
  actual_dispatch_date: '',
  remarks: '',
}

export function OtmProdView({
  userRole,
  items,
  projects,
  subVendors,
  dropdowns,
  preset,
  onClearPreset,
  onRefresh,
  onNotify,
  onLogWorkForItem,
}: OtmProdProps) {
  const canEdit = userRole === 'admin' || userRole === 'planner'

  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [deliveryFilter, setDeliveryFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [dataCheckFilter, setDataCheckFilter] = useState<'all' | 'issues' | 'ok'>('all')
  const [colMode, setColMode] = useState<ColumnGroupMode>('overview')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ComputedOtmItem | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!preset) return
    setProjectFilter(preset.projectNo || '')
    setStatusFilter(preset.prodStatus || '')
    setDeliveryFilter(preset.deliveryStatus || '')
    setDataCheckFilter(preset.dataCheck || 'all')
    onClearPreset()
  }, [preset, onClearPreset])

  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      if (projectFilter && i.project_no !== projectFilter) return false
      if (statusFilter && i.production_status !== statusFilter) return false
      if (deliveryFilter && i.delivery_status !== deliveryFilter) return false
      if (locationFilter) {
        if (locationFilter === '__unset__' && i.fabrication_location.trim() !== '') return false
        if (locationFilter !== '__unset__' && i.fabrication_location !== locationFilter) return false
      }
      if (dataCheckFilter === 'issues' && i.data_check === 'OK') return false
      if (dataCheckFilter === 'ok' && i.data_check !== 'OK') return false

      const q = search.trim().toLowerCase()
      if (q) {
        const hay = `${i.project_no} ${i.customer_name} ${i.item_description} ${i.remarks} ${i.sub_vendor} ${i.po_no}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, projectFilter, statusFilter, deliveryFilter, locationFilter, dataCheckFilter, search])

  const filteredWeight = useMemo(
    () => Math.round(filteredItems.reduce((s, i) => s + i.final_wt_tons, 0) * 1000) / 1000,
    [filteredItems]
  )

  const totalWeight = useMemo(
    () => Math.round(items.reduce((s, i) => s + i.final_wt_tons, 0) * 1000) / 1000,
    [items]
  )

  const openNewDrawer = () => {
    setEditingItem(null)
    setForm({
      ...EMPTY_FORM,
      project_no: projectFilter || projects[0]?.project_no || '',
    })
    setDrawerOpen(true)
  }

  const openEditDrawer = (item: ComputedOtmItem) => {
    setEditingItem(item)
    setForm({
      project_no: item.project_no,
      item_description: item.item_description,
      wt_cost_sheet_kg: item.wt_cost_sheet_kg !== null ? String(item.wt_cost_sheet_kg) : '',
      wt_drawing_kg: item.wt_drawing_kg !== null ? String(item.wt_drawing_kg) : '',
      drawing_released: item.drawing_released,
      material_status: item.material_status,
      material_req_at_shop: item.material_req_at_shop,
      fabrication_location: item.fabrication_location,
      sub_vendor: item.sub_vendor,
      po_no: item.po_no,
      po_date: item.po_date,
      po_value_rs: item.po_value_rs !== null ? String(item.po_value_rs) : '',
      subvendor_delivery_date: item.subvendor_delivery_date,
      advance_amount_rs: item.advance_amount_rs !== null ? String(item.advance_amount_rs) : '',
      advance_date: item.advance_date,
      customer_delivery_date: item.customer_delivery_date,
      revised_agreed_date: item.revised_agreed_date,
      plan_start: item.plan_start,
      plan_end: item.plan_end,
      actual_dispatch_date: item.actual_dispatch_date,
      remarks: item.remarks,
    })
    setDrawerOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return
    if (form.plan_start && form.plan_end && form.plan_end < form.plan_start) {
      onNotify('Plan End date must be on or after Plan Start date.', true)
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        sub_vendor: form.fabrication_location === 'Shop' ? 'NA' : form.sub_vendor,
      }
      if (editingItem) {
        await api.updateOtmItem(editingItem.id, payload)
        onNotify(`Updated OTM item "${form.item_description}"`)
      } else {
        await api.createOtmItem(payload)
        onNotify(`Added "${form.item_description}" to OTM - PROD`)
      }
      setDrawerOpen(false)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Save failed.', true)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item: ComputedOtmItem) => {
    if (!canEdit) return
    if (!window.confirm(`Delete "${item.item_description}" (${item.project_no}) from OTM - PROD?`)) {
      return
    }
    try {
      await api.deleteOtmItem(item.id)
      onNotify(`Deleted "${item.item_description}"`)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', true)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setProjectFilter('')
    setStatusFilter('')
    setDeliveryFilter('')
    setLocationFilter('')
    setDataCheckFilter('all')
  }

  const selectedCustomer = useMemo(() => {
    const found = projects.find((p) => p.project_no === form.project_no)
    return found ? found.customer_name : '(not in Masters)'
  }, [projects, form.project_no])

  const previewFinalTons = useMemo(() => {
    const d = Number(form.wt_drawing_kg)
    const c = Number(form.wt_cost_sheet_kg)
    const kg = d > 0 ? d : c > 0 ? c : 0
    return (Math.round((kg / 1000) * 1000) / 1000).toFixed(3)
  }, [form.wt_cost_sheet_kg, form.wt_drawing_kg])

  return (
    <div className="surface-card">
      <div className="card-header">
        <div>
          <div className="card-title">OTM - PROD · Master Item Register</div>
          <div className="card-subtitle">
            Showing <strong className="mono">{filteredItems.length}</strong> of{' '}
            <strong className="mono">{items.length}</strong> items · Visible Wt:{' '}
            <strong className="mono">{filteredWeight.toFixed(3)} T</strong> (Total:{' '}
            <span className="mono">{totalWeight.toFixed(3)} T</span>)
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="segmented-tabs">
            <button
              type="button"
              className={`seg-btn ${colMode === 'overview' ? 'active' : ''}`}
              onClick={() => setColMode('overview')}
            >
              Schedule &amp; Status
            </button>
            <button
              type="button"
              className={`seg-btn ${colMode === 'weights' ? 'active' : ''}`}
              onClick={() => setColMode('weights')}
            >
              Weights &amp; Material
            </button>
            <button
              type="button"
              className={`seg-btn ${colMode === 'subvendor' ? 'active' : ''}`}
              onClick={() => setColMode('subvendor')}
            >
              Sub-Vendor &amp; PO
            </button>
            <button
              type="button"
              className={`seg-btn ${colMode === 'all' ? 'active' : ''}`}
              onClick={() => setColMode('all')}
            >
              All 37 Columns
            </button>
          </div>

          {canEdit && (
            <button
              id="add-otm-item-btn"
              type="button"
              className="btn btn-accent"
              onClick={openNewDrawer}
            >
              <Plus size={15} />
              Add OTM Item
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <div className="search-box">
          <Search size={14} />
          <input
            type="text"
            className="input-control"
            placeholder="Search project, customer, item, PO, remarks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="select-control"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.project_no}>
              {p.project_no} — {p.customer_name}
            </option>
          ))}
        </select>

        <select
          className="select-control"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Prod. Status</option>
          {['Completed', 'In Progress', 'Delayed', 'Not Started', 'On Hold', 'Not Planned'].map(
            (st) => (
              <option key={st} value={st}>
                {st}
              </option>
            )
          )}
        </select>

        <select
          className="select-control"
          value={deliveryFilter}
          onChange={(e) => setDeliveryFilter(e.target.value)}
        >
          <option value="">All Delivery Status</option>
          {[
            'Overdue',
            'Due in 15 days',
            'Pending',
            'Dispatched On Time',
            'Dispatched Late',
            'No Date',
          ].map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>

        <select
          className="select-control"
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
        >
          <option value="">All Locations</option>
          <option value="Shop">Shop</option>
          <option value="Subvendor">Subvendor</option>
          <option value="__unset__">Not Set</option>
        </select>

        <select
          className="select-control"
          value={dataCheckFilter}
          onChange={(e) => setDataCheckFilter(e.target.value as 'all' | 'issues' | 'ok')}
        >
          <option value="all">Data Check: All</option>
          <option value="issues">Has Data Issues</option>
          <option value="ok">Data Check OK</option>
        </select>

        {(search ||
          projectFilter ||
          statusFilter ||
          deliveryFilter ||
          locationFilter ||
          dataCheckFilter !== 'all') && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {/* Data Table */}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th title="Sequential serial number">Sr</th>
              <th className="th-editable" title="Veda Project No (must exist in Masters)">
                Project No
              </th>
              <th title="Auto-filled customer name from Masters">Customer</th>
              <th className="th-editable" title="Deliverable equipment item name (used to match Daily Plan logs)">
                Item Description
              </th>

              {(colMode === 'weights' || colMode === 'all') && (
                <>
                  <th className="th-editable text-right" title="Estimated weight in Kg from commercial cost sheet">
                    Cost Wt (Kg)
                  </th>
                  <th className="th-editable text-right" title="Released fabrication drawing weight in Kg (takes priority over Cost Sheet Wt)">
                    Drw Wt (Kg)
                  </th>
                </>
              )}
              <th
                className="text-right"
                title="Auto-calculated: Drawing Wt (Kg) if entered, otherwise Cost Sheet Wt (Kg), divided by 1,000"
              >
                Final Wt (T)
              </th>

              {(colMode === 'weights' || colMode === 'all') && (
                <>
                  <th className="th-editable" title="Whether engineering fabrication drawing is released to shop (Yes / No)">
                    Drw Rel?
                  </th>
                  <th className="th-editable" title="Raw material availability status at shop">
                    Material Status
                  </th>
                  <th className="th-editable" title="Target date raw material is required on the shop floor">
                    Mat. Req Date
                  </th>
                </>
              )}

              <th className="th-editable" title="In-house Veda Shop vs outsourced Subvendor fabrication">
                Location
              </th>

              {(colMode === 'subvendor' || colMode === 'all') && (
                <>
                  <th className="th-editable" title="Assigned approved sub-vendor (when Location = Subvendor)">
                    Sub-Vendor
                  </th>
                  <th className="th-editable" title="Sub-contract Purchase Order number">
                    PO No
                  </th>
                  <th className="th-editable" title="Purchase Order issue date">
                    PO Date
                  </th>
                  <th className="th-editable text-right" title="Sub-contract PO value in Rupees">
                    PO Value (Rs.)
                  </th>
                  <th className="th-editable" title="Agreed delivery date from sub-vendor">
                    SV Deliv.
                  </th>
                  <th className="th-editable text-right" title="Advance payment released to sub-vendor (Rs.)">
                    Advance (Rs.)
                  </th>
                  <th className="th-editable" title="Date advance payment was released">
                    Adv. Date
                  </th>
                </>
              )}

              {(colMode === 'overview' || colMode === 'all') && (
                <>
                  {colMode === 'all' && (
                    <>
                      <th className="th-editable" title="Original PO committed delivery date to customer">
                        Cust. Deliv.
                      </th>
                      <th className="th-editable" title="Mutually revised customer delivery date (overrides Cust. Deliv. if set)">
                        Rev. Agreed
                      </th>
                    </>
                  )}
                  <th className="th-editable" title="Planned shop-floor fabrication start date">
                    Plan Start
                  </th>
                  <th className="th-editable" title="Planned shop-floor fabrication completion date">
                    Plan End
                  </th>
                  <th className="th-editable" title="Actual date item was dispatched from factory (marks item Completed & Dispatched)">
                    Dispatch Date
                  </th>
                  <th className="text-right" title="Auto: Calendar days from Plan Start to Plan End inclusive">
                    Plan d
                  </th>
                  <th className="text-right" title="Auto: Days logged 'Done' / Total days logged in Daily Plan">
                    Done d
                  </th>
                  {colMode === 'all' && (
                    <>
                      <th title="Earliest working date logged in Daily Plan">Actual Start</th>
                      <th title="Most recent date logged as Done or Item Completed">Last Done</th>
                    </>
                  )}
                  <th title="Auto: 100% if Completed, otherwise Done days ÷ Plan days">% Complete</th>
                  <th title="Auto: Completed, On Hold, Delayed, In Progress, Not Started, or Not Planned">
                    Prod. Status
                  </th>
                  <th title="Auto: Revised Agreed Date → else Customer Delivery Date → else Plan End">
                    Committed Deliv.
                  </th>
                  <th title="Auto: Dispatched On Time / Late, Overdue, Due in 15 days, or Pending">
                    Delivery Status
                  </th>
                  <th className="text-right" title="Auto: Calendar days delayed past Plan End">
                    Late (d)
                  </th>
                </>
              )}

              <th title="Automatic completeness audit checking Project No, weight, location, sub-vendor & plan dates">
                Data Check
              </th>
              <th className="th-editable" title="Engineering, procurement, or dispatch notes">
                Remarks
              </th>
              <th title="Quick-log daily shop work, edit item, or delete">Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td className="td-auto mono">{item.sr_no}</td>
                <td className="td-yellow mono nowrap" style={{ fontWeight: 700 }}>
                  {item.project_no}
                </td>
                <td
                  className="td-auto"
                  style={{
                    maxWidth: 170,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={item.customer_name}
                >
                  {item.customer_name}
                </td>
                <td className="td-yellow" style={{ fontWeight: 600, minWidth: 160 }}>
                  {item.item_description}
                </td>

                {(colMode === 'weights' || colMode === 'all') && (
                  <>
                    <td className="td-yellow mono text-right">
                      {item.wt_cost_sheet_kg ?? '—'}
                    </td>
                    <td className="td-yellow mono text-right">
                      {item.wt_drawing_kg ?? '—'}
                    </td>
                  </>
                )}

                <td className="td-auto mono text-right" style={{ fontWeight: 600 }}>
                  {item.final_wt_tons > 0 ? item.final_wt_tons.toFixed(3) : '0'}
                </td>

                {(colMode === 'weights' || colMode === 'all') && (
                  <>
                    <td className="td-yellow">{item.drawing_released || '—'}</td>
                    <td className="td-yellow">{item.material_status || '—'}</td>
                    <td className="td-yellow mono nowrap">
                      {formatShortDate(item.material_req_at_shop)}
                    </td>
                  </>
                )}

                <td className="td-yellow nowrap">{item.fabrication_location || '—'}</td>

                {(colMode === 'subvendor' || colMode === 'all') && (
                  <>
                    <td className="td-yellow">{item.sub_vendor || '—'}</td>
                    <td className="td-yellow mono">{item.po_no || '—'}</td>
                    <td className="td-yellow mono nowrap">{formatShortDate(item.po_date)}</td>
                    <td className="td-yellow mono text-right">
                      {item.po_value_rs !== null ? item.po_value_rs.toLocaleString('en-IN') : '—'}
                    </td>
                    <td className="td-yellow mono nowrap">
                      {formatShortDate(item.subvendor_delivery_date)}
                    </td>
                    <td className="td-yellow mono text-right">
                      {item.advance_amount_rs !== null
                        ? item.advance_amount_rs.toLocaleString('en-IN')
                        : '—'}
                    </td>
                    <td className="td-yellow mono nowrap">{formatShortDate(item.advance_date)}</td>
                  </>
                )}

                {(colMode === 'overview' || colMode === 'all') && (
                  <>
                    {colMode === 'all' && (
                      <>
                        <td className="td-yellow mono nowrap">
                          {formatShortDate(item.customer_delivery_date)}
                        </td>
                        <td className="td-yellow mono nowrap">
                          {formatShortDate(item.revised_agreed_date)}
                        </td>
                      </>
                    )}
                    <td className="td-yellow mono nowrap">{formatShortDate(item.plan_start)}</td>
                    <td className="td-yellow mono nowrap">{formatShortDate(item.plan_end)}</td>
                    <td className="td-yellow mono nowrap">
                      {formatShortDate(item.actual_dispatch_date)}
                    </td>
                    <td className="td-auto mono text-right">{item.plan_days ?? '—'}</td>
                    <td className="td-auto mono text-right">
                      {item.days_done}/{item.days_logged}
                    </td>
                    {colMode === 'all' && (
                      <>
                        <td className="td-auto mono nowrap">
                          {formatShortDate(item.actual_start)}
                        </td>
                        <td className="td-auto mono nowrap">
                          {formatShortDate(item.last_done_date)}
                        </td>
                      </>
                    )}
                    <td className="td-auto">
                      <ProgressDataBar pct={item.pct_complete} status={item.production_status} />
                    </td>
                    <td className="td-auto">
                      <ProductionStatusBadge status={item.production_status} />
                    </td>
                    <td className="td-auto mono nowrap">
                      {formatShortDate(item.committed_delivery_date)}
                    </td>
                    <td className="td-auto">
                      <ProductionStatusBadge status={item.delivery_status} />
                    </td>
                    <td
                      className="td-auto mono text-right"
                      style={{
                        color:
                          (item.production_late_days || 0) > 0
                            ? 'var(--st-delayed-fg)'
                            : undefined,
                        fontWeight: (item.production_late_days || 0) > 0 ? 700 : 400,
                      }}
                    >
                      {item.production_late_days ?? '—'}
                    </td>
                  </>
                )}

                <td className="td-auto" style={{ minWidth: 155 }}>
                  {item.data_check === 'OK' ? (
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
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'var(--st-hold-fg)',
                        fontSize: 11.5,
                        fontWeight: 500,
                      }}
                      title={item.data_check}
                    >
                      <AlertCircle size={13} style={{ flexShrink: 0 }} />
                      <span
                        style={{
                          maxWidth: 165,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.data_check}
                      </span>
                    </span>
                  )}
                </td>

                <td
                  className="td-yellow"
                  style={{
                    maxWidth: 190,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                  }}
                  title={item.remarks}
                >
                  {item.remarks || '—'}
                </td>

                <td className="nowrap">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title="Log daily work for this item"
                      onClick={() => onLogWorkForItem(item.project_no, item.item_description)}
                    >
                      <Wrench size={13} />
                    </button>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Edit OTM item"
                          onClick={() => openEditDrawer(item)}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          title="Delete item"
                          onClick={() => handleDelete(item)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Slide-over Editor Drawer */}
      {drawerOpen && (
        <div className="backdrop drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <form
            className="drawer-panel"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSave}
          >
            <div className="panel-header">
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                  {editingItem
                    ? `Edit OTM Item #${editingItem.sr_no}`
                    : 'Add New Item to OTM - PROD'}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Yellow fields correspond to editable inputs; customer, weight (T) &amp; status
                  compute automatically.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="panel-body">
              <div>
                <div className="form-section-title">1. Project &amp; Item Identity</div>
                <div className="form-grid-2">
                  <div className="field-group">
                    <label className="field-label">Project No *</label>
                    <select
                      className="select-control input-editable-yellow"
                      value={form.project_no}
                      onChange={(e) => setForm({ ...form, project_no: e.target.value })}
                      required
                    >
                      <option value="">Select Project...</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.project_no}>
                          {p.project_no} — {p.customer_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="field-label">Customer Name (Auto from Masters)</label>
                    <input
                      type="text"
                      className="input-control"
                      style={{ background: 'var(--bg-auto-cell)' }}
                      value={selectedCustomer}
                      readOnly
                    />
                  </div>
                </div>

                <div className="field-group" style={{ marginTop: 10 }}>
                  <label className="field-label">Item Description *</label>
                  <input
                    type="text"
                    className="input-control input-editable-yellow"
                    placeholder="e.g., Chimney, Water Tank-10 KL, Structure & Ducting"
                    value={form.item_description}
                    onChange={(e) => setForm({ ...form, item_description: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <div className="form-section-title">2. Weight, Drawing &amp; Material</div>
                <div className="form-grid-3">
                  <div className="field-group">
                    <label className="field-label">Wt as per Cost Sheet (Kg)</label>
                    <input
                      type="number"
                      step="any"
                      className="input-control input-editable-yellow mono"
                      value={form.wt_cost_sheet_kg}
                      onChange={(e) => setForm({ ...form, wt_cost_sheet_kg: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Wt as per Drawing (Kg)</label>
                    <input
                      type="number"
                      step="any"
                      className="input-control input-editable-yellow mono"
                      value={form.wt_drawing_kg}
                      onChange={(e) => setForm({ ...form, wt_drawing_kg: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Final Weight (Tons, Auto)</label>
                    <input
                      type="text"
                      className="input-control mono"
                      style={{ background: 'var(--bg-auto-cell)', fontWeight: 700 }}
                      value={`${previewFinalTons} T`}
                      readOnly
                    />
                  </div>
                </div>

                <div className="form-grid-3" style={{ marginTop: 10 }}>
                  <div className="field-group">
                    <label className="field-label">Drawing Released?</label>
                    <select
                      className="select-control input-editable-yellow"
                      value={form.drawing_released}
                      onChange={(e) => setForm({ ...form, drawing_released: e.target.value })}
                    >
                      <option value="">Not Set</option>
                      {dropdowns.drawing_status.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Material Status</label>
                    <select
                      className="select-control input-editable-yellow"
                      value={form.material_status}
                      onChange={(e) => setForm({ ...form, material_status: e.target.value })}
                    >
                      <option value="">Not Set</option>
                      {dropdowns.material_status.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label">Material Req. at Shop</label>
                    <input
                      type="date"
                      className="input-control input-editable-yellow mono"
                      value={
                        /^\d{4}-\d{2}-\d{2}$/.test(form.material_req_at_shop)
                          ? form.material_req_at_shop
                          : ''
                      }
                      onChange={(e) => setForm({ ...form, material_req_at_shop: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="form-section-title">3. Fabrication Location &amp; Sub-Vendor PO</div>
                <div className="form-grid-2">
                  <div className="field-group">
                    <label className="field-label">Fabrication Location</label>
                    <select
                      className="select-control input-editable-yellow"
                      value={form.fabrication_location}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          fabrication_location: e.target.value,
                          sub_vendor: e.target.value === 'Shop' ? 'NA' : form.sub_vendor,
                        })
                      }
                    >
                      <option value="">Not Set</option>
                      {dropdowns.fabrication_location.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label className="field-label">Sub-Vendor</label>
                    {form.fabrication_location === 'Subvendor' ? (
                      <select
                        className="select-control input-editable-yellow"
                        value={form.sub_vendor}
                        onChange={(e) => setForm({ ...form, sub_vendor: e.target.value })}
                      >
                        <option value="">Select Sub-Vendor...</option>
                        {subVendors.map((sv) => (
                          <option key={sv.id} value={sv.name}>
                            {sv.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="input-control"
                        style={{ background: 'var(--bg-auto-cell)' }}
                        value="NA (Shop Fabrication)"
                        readOnly
                      />
                    )}
                  </div>
                </div>

                {form.fabrication_location === 'Subvendor' && (
                  <div className="form-grid-3" style={{ marginTop: 10 }}>
                    <div className="field-group">
                      <label className="field-label">PO No</label>
                      <input
                        type="text"
                        className="input-control input-editable-yellow mono"
                        value={form.po_no}
                        onChange={(e) => setForm({ ...form, po_no: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">PO Date</label>
                      <input
                        type="date"
                        className="input-control input-editable-yellow mono"
                        value={/^\d{4}-\d{2}-\d{2}$/.test(form.po_date) ? form.po_date : ''}
                        onChange={(e) => setForm({ ...form, po_date: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">PO Value (Rs.)</label>
                      <input
                        type="number"
                        step="any"
                        className="input-control input-editable-yellow mono"
                        value={form.po_value_rs}
                        onChange={(e) => setForm({ ...form, po_value_rs: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Sub-Vendor Delivery Date</label>
                      <input
                        type="date"
                        className="input-control input-editable-yellow mono"
                        value={
                          /^\d{4}-\d{2}-\d{2}$/.test(form.subvendor_delivery_date)
                            ? form.subvendor_delivery_date
                            : ''
                        }
                        onChange={(e) =>
                          setForm({ ...form, subvendor_delivery_date: e.target.value })
                        }
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Advance Amount (Rs.)</label>
                      <input
                        type="number"
                        step="any"
                        className="input-control input-editable-yellow mono"
                        value={form.advance_amount_rs}
                        onChange={(e) => setForm({ ...form, advance_amount_rs: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label">Advance Date</label>
                      <input
                        type="date"
                        className="input-control input-editable-yellow mono"
                        value={
                          /^\d{4}-\d{2}-\d{2}$/.test(form.advance_date) ? form.advance_date : ''
                        }
                        onChange={(e) => setForm({ ...form, advance_date: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="form-section-title">4. Production Schedule &amp; Dispatch</div>
                <div className="form-grid-3">
                  <div className="field-group">
                    <label className="field-label">Plan Start (Production)</label>
                    <input
                      type="date"
                      className="input-control input-editable-yellow mono"
                      value={form.plan_start}
                      onChange={(e) => setForm({ ...form, plan_start: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Plan End (Production)</label>
                    <input
                      type="date"
                      className="input-control input-editable-yellow mono"
                      value={form.plan_end}
                      onChange={(e) => setForm({ ...form, plan_end: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Actual Dispatch Date</label>
                    <input
                      type="date"
                      className="input-control input-editable-yellow mono"
                      value={form.actual_dispatch_date}
                      onChange={(e) => setForm({ ...form, actual_dispatch_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-grid-2" style={{ marginTop: 10 }}>
                  <div className="field-group">
                    <label className="field-label">Customer Delivery Date</label>
                    <input
                      type="date"
                      className="input-control input-editable-yellow mono"
                      value={form.customer_delivery_date}
                      onChange={(e) => setForm({ ...form, customer_delivery_date: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Revised Agreed Date</label>
                    <input
                      type="date"
                      className="input-control input-editable-yellow mono"
                      value={form.revised_agreed_date}
                      onChange={(e) => setForm({ ...form, revised_agreed_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="field-group" style={{ marginTop: 10 }}>
                  <label className="field-label">Remarks</label>
                  <textarea
                    rows={2}
                    className="input-control input-editable-yellow"
                    placeholder="Optional notes..."
                    value={form.remarks}
                    onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="panel-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDrawerOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editingItem ? 'Save Changes' : 'Create OTM Item'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
