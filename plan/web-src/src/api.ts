import type {
  MisMonthlyCostRecord,
  UserPublic,
  UserRole,
  WorkspacePayload,
} from './shared/types.ts'

const TOKEN_KEY = 'forgeplan_jwt_token'

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken()
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(path, { ...init, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data as T
}

export interface AuditEntry {
  id: number
  created_at: string
  user_name: string
  user_role: string
  action: string
  details: string
}

export interface FullWorkspaceResponse extends WorkspacePayload {
  auditLogs: AuditEntry[]
}

export const api = {
  requestOtpCode: (email: string) =>
    request<{ challenge: string; expiresIn: number; resendAfter: number }>(
      '/api/auth/request-code',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    ),

  verifyOtpCode: (email: string, challenge: string, code: string) =>
    request<{ token: string; user: UserPublic }>('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, challenge, code }),
    }),

  me: () => request<{ user: UserPublic }>('/api/auth/me'),

  getWorkspace: () => request<FullWorkspaceResponse>('/api/workspace'),

  // Users (Admin — @vedaengg.com Email OTP accounts)
  getUsers: () => request<{ users: UserPublic[] }>('/api/users'),
  createUser: (payload: {
    name: string
    email: string
    role: UserRole
    department: string
  }) =>
    request<{ user: UserPublic }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUserRole: (id: number, role: UserRole) =>
    request<{ user: UserPublic }>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  deleteUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  // Masters
  createProject: (payload: {
    project_no: string
    customer_name: string
    project_status: string
  }) =>
    request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProject: (
    id: number,
    payload: { project_no: string; customer_name: string; project_status: string }
  ) =>
    request(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteProject: (id: number) => request(`/api/projects/${id}`, { method: 'DELETE' }),

  createSubVendor: (name: string) =>
    request('/api/subvendors', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteSubVendor: (id: number) => request(`/api/subvendors/${id}`, { method: 'DELETE' }),

  // OTM
  createOtmItem: (payload: Record<string, unknown>) =>
    request<{ id: number }>('/api/otm', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOtmItem: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/otm/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteOtmItem: (id: number) => request<{ ok: boolean }>(`/api/otm/${id}`, { method: 'DELETE' }),

  // Daily Plan
  createDailyLog: (payload: Record<string, unknown>) =>
    request<{ id: number }>('/api/daily-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDailyLog: (id: number, payload: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/daily-logs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteDailyLog: (id: number) =>
    request<{ ok: boolean }>(`/api/daily-logs/${id}`, { method: 'DELETE' }),

  // MIS & Settings
  saveMisCost: (monthKey: string, payload: MisMonthlyCostRecord) =>
    request<{ ok: boolean }>(`/api/mis/costs/${monthKey}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateSettings: (payload: { mis_start_month?: string; default_gantt_month?: string }) =>
    request<{ ok: boolean }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Excel Sync
  importExcel: async (file: File, mode: 'replace' | 'merge') => {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    const fileBase64 = btoa(binary)
    return request<{
      ok: boolean
      summary: {
        mode: string
        projects: number
        otmItems: number
        dailyLogs: number
        misMonths: number
      }
    }>('/api/excel/import', {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, fileBase64, mode }),
    })
  },

  resetToSeedWorkbook: () =>
    request<{ ok: boolean; summary: { projects: number; otmItems: number; dailyLogs: number } }>(
      '/api/excel/reset-seed',
      { method: 'POST' }
    ),

  downloadExcelFile: async (asOfDate: string) => {
    const token = getStoredToken() || ''
    const res = await fetch(`/api/excel/export?asOfDate=${encodeURIComponent(asOfDate)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`)
    }
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `Manufacturing_Monthly_Plan_${asOfDate}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
  },
}
