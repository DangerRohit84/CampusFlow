/**
 * #9 Forms logic-lite — Logic Jump + scoring + drop-off/time analytics.
 *
 * Hermetic: pure helper behavior (src/utils/formLogic.ts) + static
 * source/migration/schema assertions (no DB).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  JUMP_END,
  evaluateCondition,
  evaluateConditions,
  isFieldHiddenByRules,
  isFieldRequiredLive,
  resolveJumpTarget,
  getVisibleFields,
  computeScore,
  validateAnswers,
  computeDropoff,
  computeTimeStats,
  computeScoreStats,
  median,
  coerceDurationMs,
  parseFieldLogic,
  parseScoreMap,
  parseFieldOptions,
  resolveOptionPoints,
} from '../src/utils/formLogic'

const BACKEND_ROOT = path.resolve(__dirname, '..')
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8')
}

const F = (over: any) => ({ id: 'f', label: 'Q', type: 'TEXT', required: false, options: '[]', logic: '{}', scoreMap: '{}', order: 0, ...over })

// ---- conditions ----

describe('evaluateCondition operators', () => {
  it('equals / notEquals on source field', () => {
    expect(evaluateCondition({ a: 'Yes' }, { field: 'a', equals: 'Yes' })).toBe(true)
    expect(evaluateCondition({ a: 'No' }, { field: 'a', equals: 'Yes' })).toBe(false)
    expect(evaluateCondition({ a: 'No' }, { field: 'a', notEquals: 'Yes' })).toBe(true)
  })
  it('in / notIn lists', () => {
    expect(evaluateCondition({ a: 'CSE' }, { field: 'a', in: ['CSE', 'IT'] })).toBe(true)
    expect(evaluateCondition({ a: 'ME' }, { field: 'a', in: ['CSE', 'IT'] })).toBe(false)
    expect(evaluateCondition({ a: 'ME' }, { field: 'a', notIn: ['CSE'] })).toBe(true)
  })
  it('contains is case-insensitive substring', () => {
    expect(evaluateCondition({ a: 'Hello World' }, { field: 'a', contains: 'hello' })).toBe(true)
    expect(evaluateCondition({ a: 'Hi' }, { field: 'a', contains: 'hello' })).toBe(false)
  })
  it('empty / notEmpty', () => {
    expect(evaluateCondition({ a: '' }, { field: 'a', empty: true })).toBe(true)
    expect(evaluateCondition({ a: 'x' }, { field: 'a', notEmpty: true })).toBe(true)
    expect(evaluateCondition({ a: '' }, { field: 'a', notEmpty: true })).toBe(false)
  })
  it('bare {field} = truthy check; missing source = false', () => {
    expect(evaluateCondition({ a: 'x' }, { field: 'a' })).toBe(true)
    expect(evaluateCondition({ a: '' }, { field: 'a' })).toBe(false)
    expect(evaluateCondition({}, { field: 'a', equals: 'x' })).toBe(false)
    expect(evaluateCondition({}, null as any)).toBe(false)
  })
  it('equals matches one checkbox token', () => {
    expect(evaluateCondition({ a: 'Red, Blue' }, { field: 'a', equals: 'Blue' })).toBe(true)
    expect(evaluateCondition({ a: 'Red, Blue' }, { field: 'a', equals: 'Green' })).toBe(false)
  })
  it('evaluateConditions ANDs the list; empty = true', () => {
    expect(evaluateConditions({ a: 'x', b: 'y' }, [{ field: 'a', equals: 'x' }, { field: 'b', equals: 'y' }])).toBe(true)
    expect(evaluateConditions({ a: 'x', b: 'z' }, [{ field: 'a', equals: 'x' }, { field: 'b', equals: 'y' }])).toBe(false)
    expect(evaluateConditions({}, undefined)).toBe(true)
  })
})

// ---- visibility ----

describe('showIf / hideIf visibility', () => {
  it('showIf gates visibility (AND)', () => {
    const f = F({ id: 'q2', logic: JSON.stringify({ showIf: { field: 'q1', equals: 'Yes' } }) })
    expect(isFieldHiddenByRules(f, { q1: 'Yes' })).toBe(false)
    expect(isFieldHiddenByRules(f, { q1: 'No' })).toBe(true)
    expect(isFieldHiddenByRules(f, {})).toBe(true)
  })
  it('hideIf hides when matching (wins over showIf)', () => {
    const f = F({ id: 'q2', logic: JSON.stringify({ showIf: { field: 'q1', equals: 'Yes' }, hideIf: { field: 'q3', equals: 'Skip' } }) })
    expect(isFieldHiddenByRules(f, { q1: 'Yes', q3: 'Skip' })).toBe(true)
    expect(isFieldHiddenByRules(f, { q1: 'Yes', q3: 'Go' })).toBe(false)
  })
  it('no rules = visible; corrupt logic = visible', () => {
    expect(isFieldHiddenByRules(F({ id: 'q' }), {})).toBe(false)
    expect(isFieldHiddenByRules(F({ id: 'q', logic: 'not-json{{{' }), {})).toBe(false)
  })
})

describe('requireIf + hidden never required', () => {
  it('requireIf makes optional required when matching', () => {
    const f = F({ id: 'q2', logic: JSON.stringify({ requireIf: { field: 'q1', equals: 'Yes' } }) })
    expect(isFieldRequiredLive(f, { q1: 'Yes' })).toBe(true)
    expect(isFieldRequiredLive(f, { q1: 'No' })).toBe(false)
  })
  it('hidden beats required + requireIf', () => {
    const f = F({ id: 'q2', required: true, logic: JSON.stringify({ hideIf: { field: 'q1', equals: 'Skip' } }) })
    expect(isFieldRequiredLive(f, { q1: 'Skip' })).toBe(false)
    expect(isFieldRequiredLive(f, { q1: 'Go' })).toBe(true)
  })
})

// ---- jumps ----

describe('resolveJumpTarget (route by answer)', () => {
  it('shortcut equals on own answer', () => {
    const f = F({ id: 'q1', logic: JSON.stringify({ jumpTo: [{ equals: 'No', to: 'q3' }] }) })
    expect(resolveJumpTarget(f, { q1: 'No' })).toBe('q3')
    expect(resolveJumpTarget(f, { q1: 'Yes' })).toBeNull()
  })
  it('__END__ target supported; first match wins', () => {
    const f = F({ id: 'q1', logic: JSON.stringify({ jumpTo: [{ equals: 'A', to: 'q2' }, { equals: 'A', to: JUMP_END }] }) })
    expect(resolveJumpTarget(f, { q1: 'A' })).toBe('q2')
    const end = F({ id: 'q1', logic: JSON.stringify({ jumpTo: [{ equals: 'Done', to: '__END__' }] }) })
    expect(resolveJumpTarget(end, { q1: 'Done' })).toBe('__END__')
  })
  it('explicit if-condition may reference another field', () => {
    const f = F({ id: 'q2', logic: JSON.stringify({ jumpTo: [{ if: { field: 'q1', equals: 'Skip' }, to: 'q4' }] }) })
    expect(resolveJumpTarget(f, { q1: 'Skip' })).toBe('q4')
    expect(resolveJumpTarget(f, { q1: 'Go' })).toBeNull()
  })
  it('no jumpTo = null; corrupt = null', () => {
    expect(resolveJumpTarget(F({ id: 'q1' }), { q1: 'x' })).toBeNull()
    expect(resolveJumpTarget(F({ id: 'q1', logic: 'bad' }), { q1: 'x' })).toBeNull()
  })
})

describe('getVisibleFields combines rules + jumps', () => {
  const fields = [
    F({ id: 'q1', order: 0 }),
    F({ id: 'q2', order: 1 }),
    F({ id: 'q3', order: 2 }),
    F({ id: 'q4', order: 3 }),
  ]
  it('jump skips strictly-between fields', () => {
    const withJump = [
      F({ id: 'q1', order: 0, logic: JSON.stringify({ jumpTo: [{ equals: 'Skip', to: 'q4' }] }) }),
      F({ id: 'q2', order: 1 }),
      F({ id: 'q3', order: 2 }),
      F({ id: 'q4', order: 3 }),
    ]
    const r = getVisibleFields(withJump, { q1: 'Skip' })
    expect(r.visibleIds).toEqual(['q1', 'q4'])
    expect(r.hiddenIds).toEqual(expect.arrayContaining(['q2', 'q3']))
    expect(r.jumpsFired).toEqual({ q1: 'q4' })
  })
  it('no jump when answer does not match', () => {
    const withJump = [
      F({ id: 'q1', order: 0, logic: JSON.stringify({ jumpTo: [{ equals: 'Skip', to: 'q4' }] }) }),
      ...fields.slice(1),
    ]
    expect(getVisibleFields(withJump, { q1: 'Go' }).visibleIds).toEqual(['q1', 'q2', 'q3', 'q4'])
  })
  it('__END__ hides everything after', () => {
    const withEnd = [
      F({ id: 'q1', order: 0, logic: JSON.stringify({ jumpTo: [{ equals: 'Done', to: '__END__' }] }) }),
      F({ id: 'q2', order: 1 }),
    ]
    expect(getVisibleFields(withEnd, { q1: 'Done' }).visibleIds).toEqual(['q1'])
  })
  it('rule-hidden + jump-hidden compose', () => {
    const combo = [
      F({ id: 'q1', order: 0 }),
      F({ id: 'q2', order: 1, logic: JSON.stringify({ showIf: { field: 'q1', equals: 'Yes' } }) }),
      F({ id: 'q3', order: 2 }),
    ]
    const r = getVisibleFields(combo, { q1: 'No' })
    expect(r.visibleIds).toEqual(['q1', 'q3'])
  })
})

// ---- scoring ----

describe('computeScore per-option points', () => {
  it('single-choice maps option to points; unknown = 0', () => {
    const fields = [F({ id: 'q1', type: 'RADIO', scoreMap: JSON.stringify({ A: 5, B: 2 }) })]
    expect(computeScore(fields, { q1: 'A' }).total).toBe(5)
    expect(computeScore(fields, { q1: 'B' }).total).toBe(2)
    expect(computeScore(fields, { q1: 'C' }).total).toBe(0)
    expect(computeScore(fields, {}).total).toBe(0)
  })
  it('checkbox sums each selected option', () => {
    const fields = [F({ id: 'q1', type: 'CHECKBOX', scoreMap: JSON.stringify({ Red: 1, Blue: 2 }) })]
    expect(computeScore(fields, { q1: 'Red, Blue' }).total).toBe(3)
    expect(computeScore(fields, { q1: 'Red' }).total).toBe(1)
  })
  it('inline {label,points} options work; explicit scoreMap wins', () => {
    const fields = [F({ id: 'q1', options: JSON.stringify([{ label: 'A', points: 4 }]) })]
    expect(computeScore(fields, { q1: 'A' }).total).toBe(4)
    const override = [F({ id: 'q1', options: JSON.stringify([{ label: 'A', points: 4 }]), scoreMap: JSON.stringify({ A: 9 }) })]
    expect(computeScore(override, { q1: 'A' }).total).toBe(9)
  })
  it('hidden fields score 0 even when answered', () => {
    const fields = [
      F({ id: 'q1', order: 0 }),
      F({ id: 'q2', order: 1, scoreMap: JSON.stringify({ Yes: 10 }), logic: JSON.stringify({ showIf: { field: 'q1', equals: 'Yes' } }) }),
    ]
    expect(computeScore(fields, { q1: 'No', q2: 'Yes' }).total).toBe(0)
    expect(computeScore(fields, { q1: 'No', q2: 'Yes' }).breakdown).toEqual({ q1: 0, q2: 0 })
    expect(computeScore(fields, { q1: 'Yes', q2: 'Yes' }).total).toBe(10)
  })
  it('breakdown per field + totals across fields', () => {
    const fields = [
      F({ id: 'q1', scoreMap: JSON.stringify({ A: 1 }) }),
      F({ id: 'q2', scoreMap: JSON.stringify({ B: 2 }) }),
    ]
    const r = computeScore(fields, { q1: 'A', q2: 'B' })
    expect(r).toEqual({ total: 3, breakdown: { q1: 1, q2: 2 } })
  })
})

// ---- validation ----

describe('validateAnswers skips hidden', () => {
  it('required hidden field does not error', () => {
    const fields = [
      F({ id: 'q1', order: 0 }),
      F({ id: 'q2', order: 1, required: true, logic: JSON.stringify({ showIf: { field: 'q1', equals: 'Yes' } }) }),
    ]
    const r = validateAnswers(fields, { q1: 'No' })
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual({})
    expect(r.hiddenIds).toContain('q2')
  })
  it('visible required still errors; jump-skipped not required', () => {
    const fields = [
      F({ id: 'q1', order: 0, logic: JSON.stringify({ jumpTo: [{ equals: 'Skip', to: 'q3' }] }) }),
      F({ id: 'q2', order: 1, required: true }),
      F({ id: 'q3', order: 2 }),
    ]
    expect(validateAnswers(fields, { q1: 'Skip' }).ok).toBe(true)
    const v = validateAnswers(fields, { q1: 'Go' })
    expect(v.ok).toBe(false)
    expect(Object.keys(v.errors)).toEqual(['q2'])
  })
})

// ---- analytics ----

describe('computeDropoff (views vs answers)', () => {
  const fields = [F({ id: 'q1', label: 'Name', order: 0 }), F({ id: 'q2', label: 'Email', order: 1 })]
  it('counts answered per question; fallback views = total', () => {
    const rows = computeDropoff(fields, [{ answers: { q1: 'a', q2: 'b' } }, { answers: { q1: 'a' } }])
    expect(rows[0]).toMatchObject({ fieldId: 'q1', views: 2, answered: 2, answerRate: 100, dropoffRate: 0 })
    expect(rows[1]).toMatchObject({ fieldId: 'q2', views: 2, answered: 1, answerRate: 50, dropoffRate: 50 })
  })
  it('explicit view counts drive rates; blank/whitespace = unanswered', () => {
    const rows = computeDropoff(fields, [{ answers: { q1: '  ', q2: 'b' } }], { q1: 10, q2: 4 })
    expect(rows[0]).toMatchObject({ views: 10, answered: 0, answerRate: 0, dropoffRate: 100 })
    expect(rows[1]).toMatchObject({ views: 4, answered: 1, answerRate: 25, dropoffRate: 75 })
  })
  it('zero responses = zeroed rows (no div0)', () => {
    expect(computeDropoff(fields, [])).toMatchObject([{ views: 0, answered: 0 }, { views: 0, answered: 0 }])
  })
})

describe('median / time / score stats', () => {
  it('median odd/even/empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(median([null, undefined, NaN] as any)).toBeNull()
  })
  it('computeTimeStats median/avg/min/max/count', () => {
    expect(computeTimeStats([1000, 2000, 3000])).toMatchObject({ count: 3, medianMs: 2000, avgMs: 2000, minMs: 1000, maxMs: 3000 })
    expect(computeTimeStats([])).toMatchObject({ count: 0, medianMs: null })
    expect(computeTimeStats([500, -5, NaN, 1500] as any).count).toBe(2)
  })
  it('computeScoreStats', () => {
    expect(computeScoreStats([10, 20, 30])).toMatchObject({ count: 3, avg: 20, median: 20, min: 10, max: 30 })
    expect(computeScoreStats([])).toMatchObject({ count: 0, avg: null })
  })
  it('coerceDurationMs prefers explicit, falls back to startedAt, clamps', () => {
    expect(coerceDurationMs(5000)).toBe(5000)
    expect(coerceDurationMs(-1, new Date(Date.now() - 3000).toISOString())).toBeGreaterThan(2000)
    expect(coerceDurationMs(undefined, undefined)).toBeNull()
    expect(coerceDurationMs(99 * 3600 * 1000)).toBeNull() // >24h corrupt
  })
})

describe('parsers are total (never throw)', () => {
  it('parseFieldLogic / parseScoreMap / parseFieldOptions', () => {
    expect(parseFieldLogic(F({ id: 'x', logic: 'bad' }))).toEqual({})
    expect(parseFieldLogic(F({ id: 'x', logic: JSON.stringify({ showIf: { field: 'a', equals: '1' } }) }))).toMatchObject({ showIf: expect.anything() })
    expect(parseScoreMap(F({ id: 'x', scoreMap: 'bad' }))).toEqual({})
    expect(parseScoreMap(F({ id: 'x', scoreMap: JSON.stringify({ A: '5', B: 'nan' }) }))).toEqual({ A: 5 })
    expect(parseFieldOptions(F({ id: 'x', options: JSON.stringify(['A', 'B']) }))).toEqual(['A', 'B'])
    expect(parseFieldOptions(F({ id: 'x', options: JSON.stringify([{ label: 'A', points: 2 }]) }))).toEqual(['A'])
    expect(resolveOptionPoints(F({ id: 'x', options: JSON.stringify([{ label: 'A', points: 2 }]) }))).toEqual({ A: 2 })
  })
})

// ---- static contracts (routes / schema / migration) ----

describe('contracts: routes + schema + migration', () => {
  const routes = readSrc('src/routes/forms.ts')
  const schema = readSrc('prisma/schema.prisma')
  const migrationPath = path.join(BACKEND_ROOT, 'prisma/migrations/20260915000000_forms_logic_scoring_analytics/migration.sql')
  it('routes persist logic/scoreMap on create + fields update', () => {
    expect(routes).toMatch('sanitizeFieldLogic')
    expect(routes).toMatch('sanitizeScoreMap')
  })
  it('routes validate hidden-aware + compute score server-side on respond', () => {
    expect(routes).toMatch('validateAnswers')
    expect(routes).toMatch('computeScore')
    expect(routes).toMatch('storedAnswers')
  })
  it('routes expose analytics + view-log endpoints', () => {
    expect(routes).toMatch("router.get('/:id/analytics'")
    expect(routes).toMatch("router.post('/:id/view'")
    expect(routes).toMatch('computeDropoff')
    expect(routes).toMatch('computeTimeStats')
  })
  it('routes remap builder tmp-* refs to real ids on create/fields-save', () => {
    expect(routes).toMatch('rewriteLogicClientRefs')
    expect(routes).toMatch('tmp-')
  })
  it('export includes Score column', () => {
    expect(routes).toMatch("header: 'Score'")
  })
  it('schema has additive columns + FormView model', () => {
    expect(schema).toMatch('model FormView')
    expect(schema).toMatch('logic')
    expect(schema).toMatch('scoreMap')
    expect(schema).toMatch('durationMs')
    expect(schema).toMatch(/score\s+Int/)
  })
  it('migration exists and is additive/idempotent', () => {
    expect(fs.existsSync(migrationPath)).toBe(true)
    const sql = fs.readFileSync(migrationPath, 'utf8')
    expect(sql).toMatch('ADD COLUMN IF NOT EXISTS "logic"')
    expect(sql).toMatch('ADD COLUMN IF NOT EXISTS "score"')
    expect(sql).toMatch('CREATE TABLE IF NOT EXISTS "FormView"')
  })
})
