import { useEffect, useState } from 'react'
import { Lock, Plus, Search, Trash2, UserPlus } from 'lucide-react'
import { api } from '../api.ts'
import type {
  DropdownLists,
  EnrichedProject,
  ProjectStatus,
  SubVendor,
  UserPublic,
  UserRole,
} from '../shared/types.ts'
import { ProductionStatusBadge } from './StatusBadge.tsx'

interface MastersProps {
  userRole: UserRole
  currentUserId: number
  projects: EnrichedProject[]
  subVendors: SubVendor[]
  dropdowns: DropdownLists
  onRefresh: () => Promise<void>
  onNotify: (msg: string, isError?: boolean) => void
}

export function MastersView({
  userRole,
  currentUserId,
  projects,
  subVendors,
  dropdowns,
  onRefresh,
  onNotify,
}: MastersProps) {
  const isAdmin = userRole === 'admin'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // New project form
  const [projNo, setProjNo] = useState('')
  const [custName, setCustName] = useState('')
  const [projStatus, setProjStatus] = useState<ProjectStatus>('Active')

  // New subvendor
  const [svName, setSvName] = useState('')

  // Users management (Admin — @vedaengg.com Email OTP)
  const [users, setUsers] = useState<UserPublic[]>([])
  const [uName, setUName] = useState('')
  const [uEmail, setUEmail] = useState('')
  const [uRole, setURole] = useState<UserRole>('supervisor')
  const [uDept, setUDept] = useState('')

  useEffect(() => {
    if (isAdmin) {
      api
        .getUsers()
        .then((r) => setUsers(r.users))
        .catch(() => {})
    }
  }, [isAdmin])

  const filteredProjects = projects.filter((p) => {
    if (statusFilter && p.project_status !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (q) {
      return (
        p.project_no.toLowerCase().includes(q) || p.customer_name.toLowerCase().includes(q)
      )
    }
    return true
  })

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdmin || !projNo.trim()) return
    try {
      await api.createProject({
        project_no: projNo.trim(),
        customer_name: custName.trim(),
        project_status: projStatus,
      })
      onNotify(`Added project ${projNo.trim()} to Masters`)
      setProjNo('')
      setCustName('')
      setProjStatus('Active')
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not add project.', true)
    }
  }

  const handleProjectStatusChange = async (proj: EnrichedProject, nextStatus: string) => {
    if (!isAdmin) return
    try {
      await api.updateProject(proj.id, {
        project_no: proj.project_no,
        customer_name: proj.customer_name,
        project_status: nextStatus,
      })
      onNotify(`Updated ${proj.project_no} status to ${nextStatus}`)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed.', true)
    }
  }

  const handleDeleteProject = async (proj: EnrichedProject) => {
    if (!isAdmin) return
    if (!window.confirm(`Remove project ${proj.project_no} (${proj.customer_name}) from Masters?`))
      return
    try {
      await api.deleteProject(proj.id)
      onNotify(`Removed project ${proj.project_no}`)
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', true)
    }
  }

  const handleAddSubVendor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdmin || !svName.trim()) return
    try {
      await api.createSubVendor(svName.trim())
      onNotify(`Added sub-vendor "${svName.trim()}"`)
      setSvName('')
      await onRefresh()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add sub-vendor.', true)
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAdmin) return
    const cleanEmail = uEmail.trim().toLowerCase()
    if (!cleanEmail.endsWith('@vedaengg.com')) {
      onNotify('Please enter a valid @vedaengg.com work email address.', true)
      return
    }
    try {
      const res = await api.createUser({
        name: uName,
        email: cleanEmail,
        role: uRole,
        department: uDept,
      })
      setUsers((prev) => {
        const exists = prev.some((x) => x.id === res.user.id)
        return exists ? prev.map((x) => (x.id === res.user.id ? res.user : x)) : [...prev, res.user]
      })
      setUName('')
      setUEmail('')
      setUDept('')
      onNotify(`Saved ${uRole} access for ${res.user.name} (${res.user.email})`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save user.', true)
    }
  }

  const handleRoleChange = async (u: UserPublic, nextRole: UserRole) => {
    if (!isAdmin) return
    try {
      const res = await api.updateUserRole(u.id, nextRole)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)))
      onNotify(`Updated ${u.name}'s role to ${nextRole}`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update role.', true)
    }
  }

  const handleDeleteUser = async (u: UserPublic) => {
    if (!window.confirm(`Remove user ${u.name} (${u.email})?`)) return
    try {
      await api.deleteUser(u.id)
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
      onNotify(`Removed user ${u.name}`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not remove user.', true)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {!isAdmin && (
        <div
          className="surface-card"
          style={{
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-secondary)',
          }}
        >
          <Lock size={15} />
          <span>
            Viewing Masters in <strong>Read-Only</strong> mode. Switch to{' '}
            <strong>Admin / Management</strong> to add projects, sub-vendors, or manage user roles.
          </span>
        </div>
      )}

      <div className="split-grid-2" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
        {/* Projects Register */}
        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">
                Projects &amp; Customers Register ({filteredProjects.length})
              </div>
              <div className="card-subtitle">
                Add new Project No + Customer here first; customer &amp; Hold status cascade to OTM
                &amp; Daily Plan automatically
              </div>
            </div>
          </div>

          {isAdmin && (
            <form
              onSubmit={handleAddProject}
              style={{
                padding: '12px 16px',
                background: 'var(--bg-input-yellow)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'grid',
                gridTemplateColumns: '140px 1fr 130px auto',
                gap: 8,
                alignItems: 'end',
              }}
            >
              <div className="field-group">
                <label className="field-label">Project No *</label>
                <input
                  id="new-project-no"
                  type="text"
                  className="input-control mono"
                  placeholder="e.g. A27 1028"
                  value={projNo}
                  onChange={(e) => setProjNo(e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label">Customer Name *</label>
                <input
                  id="new-customer-name"
                  type="text"
                  className="input-control"
                  placeholder="Customer organization name"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label">Status</label>
                <select
                  className="select-control"
                  value={projStatus}
                  onChange={(e) => setProjStatus(e.target.value as ProjectStatus)}
                >
                  <option value="Active">Active</option>
                  <option value="Hold">Hold</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>
              <button type="submit" className="btn btn-accent" style={{ height: 35 }}>
                <Plus size={14} /> Add Project
              </button>
            </form>
          )}

          <div className="filter-bar">
            <div className="search-box">
              <Search size={14} />
              <input
                type="text"
                className="input-control"
                placeholder="Search Project No or Customer..."
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
              <option value="Active">Active</option>
              <option value="Hold">Hold</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div className="table-scroll" style={{ maxHeight: 500 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="th-editable">Project No</th>
                  <th className="th-editable">Customer Name</th>
                  <th className="th-editable">Project Status</th>
                  <th className="text-right">Items in OTM</th>
                  <th className="text-right">Total Wt (T)</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((p) => (
                  <tr key={p.id}>
                    <td className="td-yellow mono nowrap" style={{ fontWeight: 700 }}>
                      {p.project_no}
                    </td>
                    <td className="td-yellow" style={{ fontWeight: 500 }}>
                      {p.customer_name}
                    </td>
                    <td className="td-yellow">
                      {isAdmin ? (
                        <select
                          className="select-control input-editable-yellow"
                          style={{ height: 28, fontSize: 12 }}
                          value={p.project_status}
                          onChange={(e) => handleProjectStatusChange(p, e.target.value)}
                        >
                          <option value="Active">Active</option>
                          <option value="Hold">Hold</option>
                          <option value="Closed">Closed</option>
                        </select>
                      ) : (
                        <ProductionStatusBadge status={p.project_status} />
                      )}
                    </td>
                    <td className="td-auto mono text-right">{p.items_in_otm}</td>
                    <td className="td-auto mono text-right">
                      {p.total_wt_tons > 0 ? p.total_wt_tons.toFixed(3) : '0'}
                    </td>
                    {isAdmin && (
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => handleDeleteProject(p)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right Column: Sub-Vendors & Standard Dropdowns */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="surface-card">
            <div className="card-header">
              <div>
                <div className="card-title">Approved Sub-Vendors ({subVendors.length})</div>
                <div className="card-subtitle">
                  Available in OTM when Fabrication Location = Subvendor
                </div>
              </div>
            </div>

            {isAdmin && (
              <form
                onSubmit={handleAddSubVendor}
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  gap: 8,
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <input
                  type="text"
                  className="input-control input-editable-yellow"
                  style={{ flex: 1 }}
                  placeholder="New sub-vendor name..."
                  value={svName}
                  onChange={(e) => setSvName(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  <Plus size={14} /> Add
                </button>
              </form>
            )}

            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {subVendors.map((sv) => (
                <div
                  key={sv.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'var(--bg-subtle)',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{sv.name}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-danger-ghost btn-sm"
                      onClick={async () => {
                        await api.deleteSubVendor(sv.id)
                        await onRefresh()
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="surface-card">
            <div className="card-header">
              <div>
                <div className="card-title">Workbook Dropdown Lists</div>
                <div className="card-subtitle">Controlled vocabulary enforced across forms</div>
              </div>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Material Status', dropdowns.material_status],
                ['Fabrication Location', dropdowns.fabrication_location],
                ['Daily Plan Status', dropdowns.daily_status],
                ['Project Status', dropdowns.project_status],
              ].map(([title, opts]) => (
                <div key={title as string}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {title as string}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(opts as string[]).map((o) => (
                      <span
                        key={o}
                        style={{
                          padding: '2px 8px',
                          background: 'var(--bg-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 500,
                        }}
                      >
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Admin Role-Based User Management */}
      {isAdmin && (
        <section className="surface-card">
          <div className="card-header">
            <div>
              <div className="card-title">Veda Team Access &amp; Roles ({users.length})</div>
              <div className="card-subtitle">
                Staff sign in via @vedaengg.com email OTP. Pre-assign or change roles for Management
                (Admin), Production Planners, and Shop-Floor Supervisors.
              </div>
            </div>
          </div>

          <form
            onSubmit={handleAddUser}
            style={{
              padding: '12px 16px',
              background: 'var(--bg-subtle)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'grid',
              gridTemplateColumns: '1fr 1.2fr 170px 1fr auto',
              gap: 8,
              alignItems: 'end',
            }}
          >
            <div className="field-group">
              <label className="field-label">Full Name *</label>
              <input
                type="text"
                className="input-control"
                placeholder="Employee name"
                value={uName}
                onChange={(e) => setUName(e.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">Veda Email (@vedaengg.com) *</label>
              <input
                type="email"
                className="input-control"
                placeholder="name@vedaengg.com"
                value={uEmail}
                onChange={(e) => setUEmail(e.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">Role *</label>
              <select
                className="select-control"
                value={uRole}
                onChange={(e) => setURole(e.target.value as UserRole)}
              >
                <option value="admin">Admin / Management</option>
                <option value="planner">Production Planner</option>
                <option value="supervisor">Shop-Floor Supervisor</option>
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Department</label>
              <input
                type="text"
                className="input-control"
                placeholder="e.g. Heavy Bay 2"
                value={uDept}
                onChange={(e) => setUDept(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ height: 35 }}>
              <UserPlus size={14} /> Add / Update Staff
            </button>
          </form>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Veda Work Email</th>
                  <th>Assigned Role</th>
                  <th>Department</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td className="mono">{u.email}</td>
                    <td>
                      {u.id !== currentUserId ? (
                        <select
                          className="select-control input-editable-yellow"
                          style={{ height: 28, fontSize: 12, width: 170 }}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                        >
                          <option value="admin">Admin / Management</option>
                          <option value="planner">Production Planner</option>
                          <option value="supervisor">Shop-Floor Supervisor</option>
                        </select>
                      ) : (
                        <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                          {u.role} (You)
                        </span>
                      )}
                    </td>
                    <td>{u.department || '—'}</td>
                    <td>
                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => handleDeleteUser(u)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
