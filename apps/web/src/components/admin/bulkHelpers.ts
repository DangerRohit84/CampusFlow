// components/admin/bulkHelpers.ts — pure helpers for bulk import/delete/password.
// WHY split out: AdminPage + 3 modals share confirm gating, selection math,
// strength meter, and template/parse logic. Pure (no DOM/RQ) = hermetic vitest.
// Mirrors backend utils/sharedPassword.ts (strength 0–4, RESET/DELETE confirm).

export interface StrengthChecks {
  length: boolean
  mixed: boolean
  digit: boolean
  symbol: boolean
}

/** Strength meter 0–4 (length≥12, mixed case, digit, symbol). Mirrors BE. */
export function passwordStrengthScore(pw: string): { score: number; checks: StrengthChecks } {
  const s = String(pw || '')
  const checks: StrengthChecks = {
    length: s.length >= 12,
    mixed: /[a-z]/.test(s) && /[A-Z]/.test(s),
    digit: /\d/.test(s),
    symbol: /[^A-Za-z0-9]/.test(s),
  }
  const score = (checks.length ? 1 : 0) + (checks.mixed ? 1 : 0) + (checks.digit ? 1 : 0) + (checks.symbol ? 1 : 0)
  return { score, checks }
}

const LOCAL_COMMON = new Set([
  'password123', 'password', '12345678', '123456789', 'qwerty123', 'letmein123',
  'welcome123', 'admin123', 'campus123', 'college123', 'student123', 'teacher123',
  'password1', '1234567890', 'abc123456',
])

/**
 * Client-side format check (fast inline feedback). Backend is authoritative
 * (ADMIN-SET format-only 8-72 + common via dry-run/confirm, HIBP skipped —
 * see backend accepted-risk note) — this never green-lights alone.
 */
export function validateSharedPasswordLocal(pw: unknown): string[] {
  const s = pw == null ? '' : String(pw)
  if (!s || s.length < 8 || s.length > 72) return ['Password must be 8-72 characters']
  const low = s.toLowerCase().trim()
  if (LOCAL_COMMON.has(low) || /^(.)\1{7,}$/.test(low) || /^(12345678|abcdefgh|qwertyui|password)/.test(low)) {
    return ['Password is too common, choose a stronger password']
  }
  return []
}

/** Generate one strong shared password (12 base64url chars + A1!). Mirrors BE. */
export function generateSharedPasswordLocal(): string {
  const buf = new Uint8Array(9)
  try {
    crypto.getRandomValues(buf)
  } catch {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  const b64 = btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64.slice(0, 12)}A1!`
}

/** Type-to-confirm gate: input must equal `RESET N` / `DELETE N` exact. */
export function confirmMatches(confirm: string, verb: 'RESET' | 'DELETE', n: number): boolean {
  return confirm.trim() === `${verb} ${n}`
}

/** Toggle one id in a selection array (new array, deduped). */
export function toggleSelected(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
}

/** Page-level select-all helpers (header checkbox + indeterminate). */
export function pageSelectionState(pageIds: string[], selected: string[]): { all: boolean; some: boolean } {
  if (pageIds.length === 0) return { all: false, some: false }
  const set = new Set(selected)
  const hit = pageIds.filter((id) => set.has(id)).length
  return { all: hit === pageIds.length, some: hit > 0 && hit < pageIds.length }
}

/** Year dropdown options: descending 1990..now+6 (plan range). */
export function yearOptions(): string[] {
  const nowY = new Date().getFullYear()
  const out: string[] = []
  for (let y = nowY + 6; y >= 1990; y--) out.push(String(y))
  return out
}

/** Empty-state copy per tab (plan §2.1). */
export function emptyStateCopy(tab: 'students' | 'teachers' | 'college_admins', q: string): string {
  const label = tab === 'students' ? 'students' : tab === 'teachers' ? 'teachers' : 'college admins'
  return q ? `No ${label} match “${q}” — Try adjusting filters` : `No ${label} yet`
}

/**
 * Strip deprecated per-row `password` keys from client-parsed CSV rows.
 * P1: CSV password column removed — warn + ignore (not a hard fail).
 */
export function stripPasswordColumn(rows: Record<string, string>[]): { cleaned: Record<string, string>[]; ignoredCount: number; hadColumn: boolean } {
  let ignoredCount = 0
  let hadColumn = false
  const cleaned = rows.map((r) => {
    if (r != null && Object.prototype.hasOwnProperty.call(r, 'password')) {
      hadColumn = true
      const v = (r as Record<string, unknown>).password
      if (v != null && String(v) !== '') ignoredCount++
      const { password: _drop, ...rest } = r as Record<string, string> & { password?: string }
      void _drop
      return rest
    }
    return r
  })
  return { cleaned, ignoredCount, hadColumn }
}

/** First-N emails sample for confirm modals (+M more). Never includes secrets. */
export function sampleEmails(users: Array<{ email?: string }>, n = 5): { sample: string[]; more: number } {
  const emails = users.map((u) => String(u?.email ?? '')).filter(Boolean)
  return { sample: emails.slice(0, n), more: Math.max(0, emails.length - n) }
}

/** P2 per-tab filter input (mirrors AdminPage listFilters + qk keys). */
export interface AdminTabFilters {
  q?: string
  roll?: string
  year?: string
  email?: string
}

/**
 * Sortable columns for the Users table (per-tab exposure).
 * Students: Name, Email, Roll Number (studentId). Teachers: Name, Email,
 * Emp Number (empNumber). College admins: Name, Email only (no roll control).
 * Backend whitelist is name/email/studentId/empNumber (see userFilters.ts);
 * frontend only exposes the role-appropriate subset below.
 */
export interface SortableColumn {
  field: 'name' | 'email' | 'studentId' | 'empNumber'
  label: string
}

export function getSortableColumns(role: string): SortableColumn[] {
  if (role === 'TEACHER') {
    return [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'empNumber', label: 'Emp Number' },
    ]
  }
  if (role === 'STUDENT') {
    return [
      { field: 'name', label: 'Name' },
      { field: 'email', label: 'Email' },
      { field: 'studentId', label: 'Roll Number' },
    ]
  }
  // COLLEGE_ADMIN (+ fallback): name + email only.
  return [
    { field: 'name', label: 'Name' },
    { field: 'email', label: 'Email' },
  ]
}

export interface AdminUserSort {
  field: 'name' | 'email' | 'studentId' | 'empNumber'
  order: 'asc' | 'desc'
}

const SORT_WHITELIST = ['name', 'email', 'studentId', 'empNumber'] as const

/**
 * Parse ?sort=&order= from the URL (case-insensitive, trimmed).
 * Whitelisted fields only; invalid/absent falls back to name asc (never
 * throws — additive, old links without sort keep working via backend default).
 */
export function normalizeAdminSort(sortRaw: unknown, orderRaw: unknown): AdminUserSort {
  const s = String(sortRaw ?? '').trim().toLowerCase()
  const found = (SORT_WHITELIST as readonly string[]).find((f) => f.toLowerCase() === s)
  const field = (found ?? 'name') as AdminUserSort['field']
  const o = String(orderRaw ?? '').trim().toLowerCase()
  const order = o === 'desc' ? 'desc' : 'asc'
  return { field, order }
}

/**
 * Click-header toggle: same column flips asc<->desc; new column starts asc.
 * Pure (no DOM) so header buttons + keyboard stay trivial.
 */
export function nextSortOrder(
  currentField: AdminUserSort['field'],
  currentOrder: AdminUserSort['order'],
  clickedField: AdminUserSort['field'],
): AdminUserSort['order'] {
  if (clickedField === currentField) return currentOrder === 'asc' ? 'desc' : 'asc'
  return 'asc'
}

/**
 * Cross-page selection cap (500 ids). Keeps the selected-id set bounded so a
 * 10k-user tenant cannot grow an unbounded array in memory/URL. Returns
 * {selected (deduped, capped), capped:true when truncated}. Caller shows the
 * cap message (toast/inline) when capped — pure here for hermetic tests.
 */
export const MAX_BULK_SELECTION = 500

export function mergeSelection(selected: string[], pageIds: string[]): { selected: string[]; capped: boolean } {
  const set = new Set(selected)
  let capped = false
  for (const id of pageIds) {
    if (set.has(id)) continue
    if (set.size >= MAX_BULK_SELECTION) {
      capped = true
      break
    }
    set.add(id)
  }
  return { selected: [...set], capped }
}

// WHY: single builder for the Students (name+roll+year+dept) / Teachers
// (name+emp+dept, NO year) / Admins (name+email) contract (plan §2). Hooks
// delegate here so tab switches can never leak `year` into teachers or
// `roll` into admins, and list/counts stay in parity. Absent = omitted
// (backward compat: same fetch as unfiltered).
// Sort (2026-09-14, additive): optional 7th `sort` param appends
// ?sort=&order= (whitelisted only). Omitted = backend defaults to name asc
// (old callers keep working; old backend ignores unknown sort keys during
// rolling deploys). AdminPage always passes its URL-synced sort state.
/** Build GET /admin/users params for one tab (backward compat: absent=no filter). */
export function buildAdminUserQuery(
  role: string,
  dept: string,
  page: number,
  pageSize = 50,
  filters: AdminTabFilters = {},
  collegeId?: string,
  sort?: AdminUserSort,
): Record<string, unknown> {
  const q = (filters.q ?? '').trim()
  const roll = (filters.roll ?? '').trim()
  const year = (filters.year ?? '').trim()
  const email = (filters.email ?? '').trim()
  const params: Record<string, unknown> = {
    ...(collegeId ? { collegeId } : {}),
    role,
    ...(dept && dept !== 'all' ? { departmentId: dept } : {}),
    page,
    limit: pageSize,
    ...(q ? { search: q } : {}),
    // Roll box maps to ONE role-appropriate param (backend ANDs — sending
    // both studentId+empNumber would match nothing). Admins have no roll
    // control → never send (avoids stale-URL filtering to 0).
    ...(roll ? (role === 'TEACHER' ? { empNumber: roll } : role === 'STUDENT' ? { studentId: roll } : {}) : {}),
    ...(email ? { email } : {}),
    // Teachers/admins have NO Year control — never send (backend ignores
    // silently, but omitting keeps list/counts parity exact).
    ...(year && role === 'STUDENT' ? { incomingYear: Number(year) } : {}),
    // Sortable columns (whitelisted at both ends; omitted = backend name asc).
    ...(sort ? { sort: sort.field, order: sort.order } : {}),
  }
  return params
}

/** Build GET /admin/users/role-counts params with the SAME tab gating as the list. */
export function buildAdminRoleCountsQuery(
  activeRole: string | undefined,
  dept: string,
  filters: AdminTabFilters = {},
  collegeId?: string,
): Record<string, unknown> {
  const q = (filters.q ?? '').trim()
  const roll = (filters.roll ?? '').trim()
  const year = (filters.year ?? '').trim()
  const email = (filters.email ?? '').trim()
  return {
    ...(collegeId ? { collegeId } : {}),
    ...(dept && dept !== 'all' ? { departmentId: dept } : {}),
    ...(q ? { search: q } : {}),
    ...(roll
      ? activeRole === 'TEACHER'
        ? { empNumber: roll }
        : activeRole === 'STUDENT'
          ? { studentId: roll }
          : {}
      : {}),
    ...(email ? { email } : {}),
    ...(year && activeRole === 'STUDENT' ? { incomingYear: Number(year) } : {}),
  }
}
