/**
 * Order 10 (V-13-full/V-14/V-18/V-17 → P9): pure helpers for the 4NF child
 * tables (FormFieldOption, FormAnswer, HackathonTeamMember,
 * AssignmentAttachment).
 *
 * Dual-write contract (expand phase of P5):
 *  - Writers fill BOTH the legacy blob AND the child rows.
 *  - Readers prefer child rows, falling back to the blob when no child rows
 *    exist yet (pre-backfill / pre-migration deploys).
 *  - Blobs are NEVER dropped in this order (contract phase is later).
 *
 * No DB / no I/O here — fully unit-testable. Mirrors the SQL backfill
 * semantics in migration 20260923000000_order10_child_tables so app and
 * migration agree on canonical values (caps, trimming, checkbox joining).
 */

export const CHILD_MAX_OPTIONS = 100
export const CHILD_MAX_LABEL = 200
export const CHILD_MAX_VALUE = 5000
export const CHILD_MAX_POINTS = 10000
export const CHILD_MAX_TEAM = 50
export const CHILD_MAX_NAME = 200
export const CHILD_MAX_ATTACHMENTS = 20
export const CHILD_MAX_URL = 2000

export type ParsedFieldOption = {
  value: string
  label: string
  points: number
  order: number
}

function clampStr(v: unknown, max: number): string {
  const s = String(v ?? '').trim()
  return s.length > max ? s.slice(0, max) : s
}

function clampPoints(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(-CHILD_MAX_POINTS, Math.min(CHILD_MAX_POINTS, Math.trunc(n)))
}

function parseJsonLoose(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'string') return raw
  const t = raw.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

/**
 * Normalize a FormField.options blob (string[] | {label,value,text,points,
 * score}[] | JSON string) into canonical option rows. Never throws.
 * Mirrors the SQL backfill (object → value/label/points, string → self).
 */
export function parseFieldOptionsInput(raw: unknown): ParsedFieldOption[] {
  const arr = parseJsonLoose(raw)
  if (!Array.isArray(arr)) return []
  const out: ParsedFieldOption[] = []
  const seen = new Set<string>()
  for (let i = 0; i < arr.length && out.length < CHILD_MAX_OPTIONS; i += 1) {
    const o = arr[i]
    let value = ''
    let label = ''
    let points = 0
    if (typeof o === 'string') {
      value = clampStr(o, CHILD_MAX_LABEL)
      label = value
    } else if (o && typeof o === 'object' && !Array.isArray(o)) {
      const rec = o as Record<string, unknown>
      // value = the option's key (value-first); label = display (label-first).
      // NOTE: submitted answers historically carry the *label* (see
      // optionsToLabels/resolveOptionPoints), so answers↔options joins match
      // when label == value (always true for plain string options). Points
      // stay authoritative in FormField.scoreMap until the contract phase.
      value = clampStr(rec.value ?? rec.label ?? rec.text, CHILD_MAX_LABEL)
      label = clampStr(rec.label ?? rec.value ?? rec.text, CHILD_MAX_LABEL)
      points = clampPoints(rec.points ?? rec.score)
    } else if (o !== null && o !== undefined) {
      value = clampStr(o, CHILD_MAX_LABEL)
      label = value
    }
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push({ value, label: label || value, points, order: out.length })
  }
  return out
}

/**
 * Canonical stored string for one answer value. Checkbox arrays join with
 * ", " (same convention as the blob + formLogic.answerToString); objects
 * degrade to compact JSON. Capped at CHILD_MAX_VALUE. Never throws.
 */
export function answerToStoredValue(value: unknown): string {
  try {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) {
      const s = value
        .map((v) => {
          if (v === null || v === undefined) return ''
          if (typeof v === 'string') return v.trim()
          if (typeof v === 'object') {
            try {
              return JSON.stringify(v)
            } catch {
              return ''
            }
          }
          return String(v)
        })
        .filter((s) => s !== '')
        .join(', ')
      return s.length > CHILD_MAX_VALUE ? s.slice(0, CHILD_MAX_VALUE) : s
    }
    if (typeof value === 'string') {
      const t = value.trim()
      return t.length > CHILD_MAX_VALUE ? t.slice(0, CHILD_MAX_VALUE) : t
    }
    if (typeof value === 'object') {
      const s = JSON.stringify(value)
      return s.length > CHILD_MAX_VALUE ? s.slice(0, CHILD_MAX_VALUE) : s
    }
    const s = String(value)
    return s.length > CHILD_MAX_VALUE ? s.slice(0, CHILD_MAX_VALUE) : s
  } catch {
    return ''
  }
}

/** Build FormAnswer rows from a stored-answers map (fieldId → value). */
export function buildFormAnswerRows(
  storedAnswers: Record<string, unknown>,
): Array<{ fieldId: string; value: string }> {
  if (!storedAnswers || typeof storedAnswers !== 'object' || Array.isArray(storedAnswers)) return []
  const out: Array<{ fieldId: string; value: string }> = []
  for (const [fieldId, v] of Object.entries(storedAnswers)) {
    const fid = String(fieldId).trim()
    if (!fid) continue
    out.push({ fieldId: fid, value: answerToStoredValue(v) })
  }
  return out
}

/**
 * Resolve the answers map for a response row: child rows win when present,
 * otherwise parse the blob. Never throws. `response` may carry `answerRows`
 * (FormAnswer[]) and/or `answers` (JSON string / object).
 */
export function resolveAnswersMap(response: {
  answers?: unknown
  answerRows?: Array<{ fieldId: string; value: string }> | null
}): Record<string, unknown> {
  try {
    const rows = (response as any)?.answerRows
    if (Array.isArray(rows) && rows.length > 0) {
      const out: Record<string, unknown> = {}
      for (const r of rows) {
        const fid = String((r as any)?.fieldId ?? '').trim()
        if (fid) out[fid] = (r as any)?.value ?? ''
      }
      return out
    }
    const blob = parseJsonLoose((response as any)?.answers)
    if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
      return blob as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

/** True when the response has queryable child rows (read-new path active). */
export function hasChildAnswers(response: {
  answerRows?: Array<unknown> | null
}): boolean {
  return Array.isArray((response as any)?.answerRows) && (response as any).answerRows.length > 0
}

/**
 * Normalize a HackathonRegistration.teamMembers blob (string[] | JSON-string
 * array | CSV string | single name) into member names. Capped at
 * CHILD_MAX_TEAM names × CHILD_MAX_NAME chars. Never throws. Mirrors the SQL
 * backfill (JSON array → unnest; else string_to_array(csv, ',')).
 */
export function parseTeamMembersInput(raw: unknown): string[] {
  try {
    if (raw === null || raw === undefined) return []
    if (Array.isArray(raw)) {
      return raw
        .map((v) => {
          if (typeof v === 'string') return v.trim()
          if (v && typeof v === 'object') {
            const rec = v as Record<string, unknown>
            const n = rec.name ?? rec.value ?? rec.text ?? rec.email
            return typeof n === 'string' ? n.trim() : ''
          }
          return String(v ?? '').trim()
        })
        .filter(Boolean)
        .map((s) => (s.length > CHILD_MAX_NAME ? s.slice(0, CHILD_MAX_NAME) : s))
        .slice(0, CHILD_MAX_TEAM)
    }
    if (typeof raw === 'string') {
      const t = raw.trim()
      if (!t) return []
      const parsed = parseJsonLoose(t)
      if (Array.isArray(parsed)) return parseTeamMembersInput(parsed)
      return t
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.length > CHILD_MAX_NAME ? s.slice(0, CHILD_MAX_NAME) : s))
        .slice(0, CHILD_MAX_TEAM)
    }
    return []
  } catch {
    return []
  }
}

/** Resolve display team-members string: child rows win, else blob. */
export function resolveTeamMembersDisplay(reg: {
  teamMembers?: unknown
  teamRows?: Array<{ name: string }> | null
}): string {
  try {
    const rows = (reg as any)?.teamRows
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((r: any) => String(r?.name ?? '').trim()).filter(Boolean).join(', ')
    }
    const blob = (reg as any)?.teamMembers
    if (Array.isArray(blob)) return blob.map((v) => String(v).trim()).filter(Boolean).join(', ')
    if (typeof blob === 'string') return blob
    return ''
  } catch {
    return ''
  }
}

/**
 * Normalize an AssignmentHub.attachments blob (URL string[] | JSON string |
 * {url}[]) into URLs. Capped at CHILD_MAX_ATTACHMENTS × CHILD_MAX_URL.
 * Never throws. Mirrors the SQL backfill (array unnest, objects → .url).
 */
export function parseAttachmentUrls(raw: unknown): string[] {
  try {
    const arr = parseJsonLoose(raw)
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    for (const item of arr) {
      if (out.length >= CHILD_MAX_ATTACHMENTS) break
      let url = ''
      if (typeof item === 'string') url = item.trim()
      else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const u = (item as Record<string, unknown>).url
        url = typeof u === 'string' ? u.trim() : ''
      }
      if (!url) continue
      out.push(url.length > CHILD_MAX_URL ? url.slice(0, CHILD_MAX_URL) : url)
    }
    return out
  } catch {
    return []
  }
}

/** Resolve attachment URL list: child rows win, else blob. */
export function resolveAttachmentUrls(hub: {
  attachments?: unknown
  attachmentRows?: Array<{ url: string; order?: number }> | null
}): string[] {
  try {
    const rows = (hub as any)?.attachmentRows
    if (Array.isArray(rows) && rows.length > 0) {
      return [...rows]
        .sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0))
        .map((r: any) => String(r?.url ?? '').trim())
        .filter(Boolean)
    }
    return parseAttachmentUrls((hub as any)?.attachments)
  } catch {
    return []
  }
}
