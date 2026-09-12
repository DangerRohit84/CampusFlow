/**
 * Forms logic-lite (#9) — frontend mirror of `packages/backend/src/utils/formLogic.ts`.
 * Keep in sync (duplicated to avoid a cross-package dep for a lite feature).
 * DOM-free pure helpers: conditional visibility, scoring, validation, analytics.
 */

export const JUMP_END = '__END__'

export type FormLogicCondition = {
  field?: string
  fieldId?: string
  equals?: string | number
  notEquals?: string | number
  in?: Array<string | number>
  notIn?: Array<string | number>
  contains?: string
  notEmpty?: boolean
  empty?: boolean
}

export type FormJumpRule = {
  to: string
  equals?: string | number
  notEquals?: string | number
  in?: Array<string | number>
  notIn?: Array<string | number>
  contains?: string
  notEmpty?: boolean
  empty?: boolean
  if?: FormLogicCondition
}

export type FormFieldLogic = {
  showIf?: FormLogicCondition | FormLogicCondition[]
  hideIf?: FormLogicCondition | FormLogicCondition[]
  requireIf?: FormLogicCondition | FormLogicCondition[]
  jumpTo?: FormJumpRule | FormJumpRule[]
}

export type LogicFieldLike = {
  id: string
  label?: string
  type?: string
  required?: boolean
  options?: unknown
  logic?: unknown
  scoreMap?: unknown
  order?: number
}

export type AnswersMap = Record<string, unknown>

function parseJsonSafe<T>(value: unknown, fallback: T): T {
  try {
    if (value === null || value === undefined) return fallback
    if (typeof value === 'object') return value as T
    if (typeof value === 'string') {
      const t = value.trim()
      if (!t) return fallback
      return JSON.parse(t) as T
    }
    return fallback
  } catch {
    return fallback
  }
}

export function parseFieldLogic(field: LogicFieldLike): FormFieldLogic {
  const parsed = parseJsonSafe<FormFieldLogic>((field as any)?.logic, {} as FormFieldLogic)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return parsed
}

export function parseScoreMap(field: LogicFieldLike): Record<string, number> {
  const raw = parseJsonSafe<unknown>((field as any)?.scoreMap, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v)
    if (Number.isFinite(n)) out[String(k)] = n
  }
  return out
}

export function parseFieldOptions(field: LogicFieldLike): string[] {
  const raw = parseJsonSafe<unknown>((field as any)?.options, [])
  if (!raw) return []
  if (Array.isArray(raw)) {
    const out: string[] = []
    for (const o of raw) {
      if (typeof o === 'string') out.push(o)
      else if (o && typeof o === 'object') {
        const label = (o as any).label ?? (o as any).value ?? (o as any).text
        if (label !== undefined && label !== null) out.push(String(label))
      } else if (o !== null && o !== undefined) out.push(String(o))
    }
    return out
  }
  return []
}

export function resolveOptionPoints(field: LogicFieldLike): Record<string, number> {
  const merged: Record<string, number> = {}
  try {
    const raw = parseJsonSafe<unknown>((field as any)?.options, [])
    if (Array.isArray(raw)) {
      for (const o of raw) {
        if (o && typeof o === 'object' && !Array.isArray(o)) {
          const label = (o as any).label ?? (o as any).value
          const pts = Number((o as any).points ?? (o as any).score)
          if (label !== undefined && label !== null && Number.isFinite(pts)) {
            merged[String(label)] = pts
          }
        }
      }
    }
  } catch { /* ignore */ }
  const explicit = parseScoreMap(field)
  for (const [k, v] of Object.entries(explicit)) merged[k] = v
  return merged
}

export function answerToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value)
}

function isAnswerEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0 || value.every((v) => String(v).trim() === '')
  return false
}

export function splitAnswerTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  const s = answerToString(value)
  if (!s) return []
  return s.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean)
}

function norm(s: unknown): string {
  return String(s ?? '').trim()
}

function conditionSourceId(cond: FormLogicCondition): string {
  return String(cond.fieldId ?? cond.field ?? '')
}

export function evaluateCondition(answers: AnswersMap, cond: FormLogicCondition | null | undefined): boolean {
  if (!cond || typeof cond !== 'object') return false
  const srcId = conditionSourceId(cond)
  if (!srcId) return false
  const raw = (answers as any)?.[srcId]
  const val = norm(raw)
  const empty = isAnswerEmpty(raw)
  if (cond.empty === true) return empty
  if (cond.notEmpty === true) return !empty
  if (cond.equals !== undefined && cond.equals !== null) {
    const tokens = splitAnswerTokens(raw)
    if (tokens.length > 1) return tokens.some((t) => t === norm(cond.equals))
    return val === norm(cond.equals)
  }
  if (cond.notEquals !== undefined && cond.notEquals !== null) {
    const tokens = splitAnswerTokens(raw)
    if (tokens.length > 1) return !tokens.some((t) => t === norm(cond.notEquals))
    return val !== norm(cond.notEquals)
  }
  if (Array.isArray(cond.in)) {
    const set = cond.in.map(norm)
    const tokens = splitAnswerTokens(raw)
    if (tokens.length > 1) return tokens.some((t) => set.includes(t))
    return set.includes(val)
  }
  if (Array.isArray(cond.notIn)) {
    const set = cond.notIn.map(norm)
    const tokens = splitAnswerTokens(raw)
    if (tokens.length > 1) return !tokens.some((t) => set.includes(t))
    return !set.includes(val)
  }
  if (typeof cond.contains === 'string' && cond.contains !== '') {
    return val.toLowerCase().includes(cond.contains.toLowerCase())
  }
  return !empty
}

function asConditionArray(v: FormLogicCondition | FormLogicCondition[] | undefined): FormLogicCondition[] {
  if (!v) return []
  return Array.isArray(v) ? v.filter(Boolean) : [v]
}

export function evaluateConditions(
  answers: AnswersMap,
  conds: FormLogicCondition | FormLogicCondition[] | undefined,
): boolean {
  const list = asConditionArray(conds)
  if (list.length === 0) return true
  return list.every((c) => evaluateCondition(answers, c))
}

export function isFieldHiddenByRules(field: LogicFieldLike, answers: AnswersMap): boolean {
  const logic = parseFieldLogic(field)
  const hasShow = logic.showIf !== undefined && asConditionArray(logic.showIf).length > 0
  const hasHide = logic.hideIf !== undefined && asConditionArray(logic.hideIf).length > 0
  if (hasHide && evaluateConditions(answers, logic.hideIf)) return true
  if (hasShow && !evaluateConditions(answers, logic.showIf)) return true
  return false
}

export function isFieldRequiredLive(field: LogicFieldLike, answers: AnswersMap): boolean {
  if (isFieldHiddenByRules(field, answers)) return false
  if ((field as any)?.required === true) return true
  const logic = parseFieldLogic(field)
  const req = asConditionArray(logic.requireIf)
  if (req.length === 0) return false
  return evaluateConditions(answers, logic.requireIf)
}

function asJumpArray(v: FormJumpRule | FormJumpRule[] | undefined): FormJumpRule[] {
  if (!v) return []
  return Array.isArray(v) ? v.filter(Boolean) : [v]
}

export function resolveJumpTarget(field: LogicFieldLike, answers: AnswersMap): string | null {
  const logic = parseFieldLogic(field)
  const rules = asJumpArray(logic.jumpTo)
  if (rules.length === 0) return null
  const ownRaw = (answers as any)?.[(field as any).id]
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    const to = typeof rule.to === 'string' ? rule.to.trim() : ''
    if (!to) continue
    if (rule.if && typeof rule.if === 'object') {
      if (evaluateCondition(answers, rule.if)) return to
      continue
    }
    const ownCond: FormLogicCondition = { fieldId: (field as any).id } as FormLogicCondition
    let hasOp = false
    for (const k of ['equals', 'notEquals', 'in', 'notIn', 'contains', 'notEmpty', 'empty'] as const) {
      if ((rule as any)[k] !== undefined) {
        ;(ownCond as any)[k] = (rule as any)[k]
        hasOp = true
      }
    }
    if (!hasOp) {
      if (!isAnswerEmpty(ownRaw)) return to
      continue
    }
    if (evaluateCondition({ ...answers, [(field as any).id]: ownRaw }, ownCond)) return to
  }
  return null
}

function sortByOrder<T extends { order?: number }>(fields: T[]): T[] {
  return [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export type VisibleFieldsResult = {
  visible: LogicFieldLike[]
  hiddenIds: string[]
  visibleIds: string[]
  jumpsFired: Record<string, string>
}

export function getVisibleFields<T extends LogicFieldLike>(fields: T[], answers: AnswersMap): VisibleFieldsResult {
  const sorted = sortByOrder(fields)
  const byId = new Map<string, T>()
  for (const f of sorted) byId.set((f as any).id, f)
  const ruleHidden = new Set<string>()
  for (const f of sorted) {
    if (isFieldHiddenByRules(f, answers)) ruleHidden.add((f as any).id)
  }
  const jumpHidden = new Set<string>()
  const jumpsFired: Record<string, string> = {}
  let skipUntilId: string | null = null
  let skippingToEnd = false
  let skipping = false
  for (const f of sorted) {
    const fid = (f as any).id as string
    if (skippingToEnd) {
      jumpHidden.add(fid)
      continue
    }
    if (skipping) {
      if (skipUntilId !== null && fid === skipUntilId) {
        skipping = false
        skipUntilId = null
      } else {
        jumpHidden.add(fid)
        continue
      }
    }
    if (ruleHidden.has(fid) || jumpHidden.has(fid)) continue
    const target = resolveJumpTarget(f, answers)
    if (target) {
      jumpsFired[fid] = target
      if (target === JUMP_END) {
        skippingToEnd = true
      } else if (byId.has(target)) {
        const curIdx = sorted.findIndex((x) => (x as any).id === fid)
        const tgtIdx = sorted.findIndex((x) => (x as any).id === target)
        if (tgtIdx > curIdx) {
          skipping = true
          skipUntilId = target
        }
      }
    }
  }
  const hiddenIds: string[] = []
  const visible: T[] = []
  for (const f of sorted) {
    const fid = (f as any).id as string
    if (ruleHidden.has(fid) || jumpHidden.has(fid)) hiddenIds.push(fid)
    else visible.push(f)
  }
  return { visible, hiddenIds, visibleIds: visible.map((f) => (f as any).id), jumpsFired }
}

function pointsForAnswer(optionPoints: Record<string, number>, value: unknown): number {
  if (isAnswerEmpty(value)) return 0
  if (typeof value === 'number') {
    const key = String(value)
    return Number.isFinite(optionPoints[key]) ? optionPoints[key] : 0
  }
  const tokens = splitAnswerTokens(value)
  if (tokens.length <= 1) {
    const key = tokens.length === 1 ? tokens[0] : norm(value)
    const p = optionPoints[key]
    return Number.isFinite(p) ? (p as number) : 0
  }
  let sum = 0
  for (const t of tokens) {
    const p = optionPoints[t]
    if (Number.isFinite(p)) sum += p as number
  }
  return sum
}

export type ScoreResult = {
  total: number
  breakdown: Record<string, number>
}

export function computeScore(
  fields: LogicFieldLike[],
  answers: AnswersMap,
  opts?: { onlyVisible?: boolean },
): ScoreResult {
  const onlyVisible = opts?.onlyVisible !== false
  const safeAnswers = (answers && typeof answers === 'object' ? answers : {}) as AnswersMap
  let hidden = new Set<string>()
  if (onlyVisible) {
    hidden = new Set(getVisibleFields(fields, safeAnswers).hiddenIds)
  }
  const breakdown: Record<string, number> = {}
  let total = 0
  for (const f of fields) {
    const fid = (f as any).id as string
    if (!fid) continue
    if (hidden.has(fid)) {
      breakdown[fid] = 0
      continue
    }
    const pts = resolveOptionPoints(f)
    const v = (safeAnswers as any)[fid]
    const s = pointsForAnswer(pts, v)
    breakdown[fid] = s
    total += s
  }
  return { total, breakdown }
}

export type ValidationResult = {
  ok: boolean
  errors: Record<string, string>
  hiddenIds: string[]
  visibleIds: string[]
}

export function validateAnswers(fields: LogicFieldLike[], answers: AnswersMap): ValidationResult {
  const safeAnswers = (answers && typeof answers === 'object' ? answers : {}) as AnswersMap
  const { visible, hiddenIds, visibleIds } = getVisibleFields(fields, safeAnswers)
  const errors: Record<string, string> = {}
  for (const f of visible) {
    const fid = (f as any).id as string
    const label = (f as any).label || 'This field'
    if (isFieldRequiredLive(f, safeAnswers) && isAnswerEmpty((safeAnswers as any)[fid])) {
      errors[fid] = `"${label}" is required`
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, hiddenIds, visibleIds }
}

export function median(values: Array<number | null | undefined>): number | null {
  const nums = (values || []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  if (nums.length % 2 === 1) return nums[mid]
  return Math.round(((nums[mid - 1] + nums[mid]) / 2) * 100) / 100
}

export type DropoffRow = {
  fieldId: string
  label: string
  order: number
  views: number
  answered: number
  answerRate: number
  dropoffRate: number
}

function parseAnswersSafe(raw: unknown): AnswersMap {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as AnswersMap
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as AnswersMap
    } catch { /* fallthrough */ }
  }
  return {}
}

export function computeDropoff(
  fields: LogicFieldLike[],
  responses: Array<{ answers?: unknown }>,
  viewCounts?: Record<string, number>,
): DropoffRow[] {
  const sorted = sortByOrder(fields)
  const total = responses.length
  const parsed = responses.map((r) => parseAnswersSafe((r as any)?.answers))
  return sorted.map((f) => {
    const fid = (f as any).id as string
    let answered = 0
    for (const a of parsed) {
      const v = (a as any)[fid]
      const empty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
      if (!empty) answered += 1
    }
    const views = viewCounts && Number.isFinite((viewCounts as any)?.[fid])
      ? Math.max(Number((viewCounts as any)[fid]), answered, total === 0 ? 0 : 0)
      : total
    const denom = Math.max(views, 1)
    const answerRate = views === 0 ? 0 : Math.round((answered / denom) * 1000) / 10
    const dropoffRate = views === 0 ? 0 : Math.round(((views - answered) / denom) * 1000) / 10
    return {
      fieldId: fid,
      label: (f as any)?.label || fid,
      order: (f as any)?.order ?? 0,
      views,
      answered,
      answerRate,
      dropoffRate,
    }
  })
}

export type TimeStats = {
  count: number
  medianMs: number | null
  avgMs: number | null
  minMs: number | null
  maxMs: number | null
}

export function computeTimeStats(durations: Array<number | null | undefined>): TimeStats {
  const nums = (durations || []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  if (nums.length === 0) return { count: 0, medianMs: null, avgMs: null, minMs: null, maxMs: null }
  const sorted = [...nums].sort((a, b) => a - b)
  const sum = nums.reduce((a, b) => a + b, 0)
  return {
    count: nums.length,
    medianMs: median(nums),
    avgMs: Math.round((sum / nums.length) * 100) / 100,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  }
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}h ${mm}m` : `${h}h`
}
