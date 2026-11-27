import { useState } from 'react'
import { Download, FileSpreadsheet, RefreshCw, Upload, X } from 'lucide-react'
import { api } from '../api.ts'
import { isFullAccessRole, type UserRole } from '../shared/types.ts'

interface ExcelSyncModalProps {
  userRole: UserRole
  asOfDate: string
  onClose: () => void
  onRefresh: () => Promise<void>
  onNotify: (msg: string, isError?: boolean) => void
}

export function ExcelSyncModal({
  userRole,
  asOfDate,
  onClose,
  onRefresh,
  onNotify,
}: ExcelSyncModalProps) {
  const canImport = isFullAccessRole(userRole) || userRole === 'planner'
  const isAdmin = isFullAccessRole(userRole)

  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      await api.downloadExcelFile(asOfDate)
      onNotify(`Downloaded Manufacturing_Monthly_Plan_${asOfDate}.xlsx`)
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Excel export failed.', true)
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !canImport) return
    setBusy(true)
    try {
      const res = await api.importExcel(file, mode)
      onNotify(
        `Imported ${res.summary.projects} projects, ${res.summary.otmItems} OTM items & ${res.summary.dailyLogs} daily logs (${res.summary.mode})`
      )
      await onRefresh()
      onClose()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Excel import failed.', true)
    } finally {
      setBusy(false)
    }
  }

  const handleResetSeed = async () => {
    if (!isAdmin) return
    if (
      !window.confirm(
        'Replace all current database records with the original attached Manufacturing_Monthly_Plan_Improved.xlsx?'
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const res = await api.resetToSeedWorkbook()
      onNotify(
        `Restored seed workbook (${res.summary.projects} projects, ${res.summary.otmItems} OTM items, ${res.summary.dailyLogs} daily logs)`
      )
      await onRefresh()
      onClose()
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Reset failed.', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileSpreadsheet size={20} color="var(--brand-primary)" />
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                Two-Way Excel (.xlsx) Sync
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Export live data to Excel or import an updated workbook seamlessly
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="panel-body">
          {/* Export Section */}
          <div
            style={{
              padding: 16,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Export Multi-Sheet Workbook (.xlsx)</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Downloads Dashboard, OTM-PROD, Daily Plan, Monthly Gantt, MIS &amp; Masters
                compatible with re-import.
              </div>
            </div>
            <button
              id="export-xlsx-btn"
              type="button"
              className="btn btn-primary"
              onClick={handleExport}
            >
              <Download size={15} /> Download .xlsx
            </button>
          </div>

          {/* Import Section */}
          {canImport ? (
            <form
              onSubmit={handleImport}
              style={{
                padding: 16,
                border: '1px solid var(--border-strong)',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14 }}>Import Excel Workbook (.xlsx)</div>
              <div className="field-group">
                <label className="field-label">Select .xlsx File</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="input-control"
                  style={{ paddingTop: 5 }}
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  required
                />
              </div>

              <div className="field-group">
                <label className="field-label">Import Mode</label>
                <select
                  className="select-control"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}
                >
                  <option value="merge">
                    Merge / Upsert — Keep existing entries &amp; update matching OTM items / projects
                  </option>
                  <option value="replace">
                    Replace All — Overwrite database cleanly with uploaded workbook
                  </option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  className="btn btn-accent"
                  disabled={!file || busy}
                >
                  <Upload size={15} />
                  {busy ? 'Importing...' : 'Import Workbook'}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Importing Excel files requires <strong>Admin</strong> or <strong>Planner</strong> role.
            </div>
          )}

          {/* Reset to attached seed */}
          {isAdmin && (
            <div
              style={{
                paddingTop: 10,
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Need to reset back to the originally seeded{' '}
                <code>Manufacturing_Monthly_Plan_Improved.xlsx</code>?
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleResetSeed}
                disabled={busy}
              >
                <RefreshCw size={13} /> Restore Original Seed
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
