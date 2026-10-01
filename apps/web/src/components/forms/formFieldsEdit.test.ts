// components/forms/formFieldsEdit.test.ts — TDD RED for Form Fields Edit popup.
// Locks: modal open populates draft, save builds payload, cancel discards.
import { describe, it, expect } from 'vitest'
import {
  toEditFields,
  validateEditFields,
  buildEditFieldsPayload,
} from './formFieldsEdit'

const serverFields = [
  {
    id: 'f1',
    label: 'Name',
    type: 'TEXT',
    required: true,
    options: [],
    logic: '{}',
    scoreMap: '{}',
  },
  {
    id: 'f2',
    label: 'Color',
    type: 'SELECT',
    required: false,
    options: JSON.stringify(['Red', 'Blue']),
    logic: JSON.stringify({ showIf: [{ field: 'f1', equals: 'x' }] }),
    scoreMap: JSON.stringify({ Red: 5, Blue: 0 }),
  },
]

describe('toEditFields (modal open on Edit)', () => {
  it('populates editable draft from server fields', () => {
    const draft = toEditFields(serverFields as any)
    expect(draft).toHaveLength(2)
    expect(draft[0]).toMatchObject({ id: 'f1', label: 'Name', type: 'TEXT', required: true })
    expect(draft[1].options).toEqual(['Red', 'Blue'])
    expect(draft[1].optionPoints).toMatchObject({ Red: 5 })
    expect(draft[1].showIfField).toBe('f1')
    expect(draft[1].showIfValue).toBe('x')
  })

  it('returns a copy so cancel discards edits (original untouched)', () => {
    const draft = toEditFields(serverFields as any)
    draft[0].label = 'CHANGED'
    draft[1].options = ['HACKED']
    expect((serverFields[0] as any).label).toBe('Name')
    expect(draft).not.toBe(serverFields)
  })
})

describe('validateEditFields (same validation as inline)', () => {
  it('rejects when every label is blank', () => {
    const r = validateEditFields([{ label: '   ', type: 'TEXT' } as any])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/at least one field/i)
  })

  it('accepts when at least one label is non-blank', () => {
    const r = validateEditFields([
      { label: '  ', type: 'TEXT' } as any,
      { label: 'Age', type: 'NUMBER' } as any,
    ])
    expect(r.ok).toBe(true)
  })
})

describe('buildEditFieldsPayload (save updates)', () => {
  it('preserves ids, trims labels, drops blank options, keeps non-zero scores', () => {
    const draft = toEditFields(serverFields as any)
    const payload = buildEditFieldsPayload(draft)
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({ id: 'f1', label: 'Name', type: 'TEXT', required: true })
    // f2: Blue has 0 pts -> dropped from scoreMap; Red kept
    const f2 = payload[1] as any
    expect(f2.options).toEqual(['Red', 'Blue'])
    expect(f2.scoreMap).toEqual({ Red: 5 })
    expect(f2.logic).toMatchObject({ showIf: [{ field: 'f1', equals: 'x' }] })
  })

  it('mints clientId for brand-new rows without id', () => {
    const payload = buildEditFieldsPayload([
      { label: 'New Q', type: 'TEXT', required: false, options: [] } as any,
    ])
    expect((payload[0] as any).clientId).toMatch(/tmp-edit-0/)
    expect((payload[0] as any).id).toBeUndefined()
  })

  it('skips blank-label rows on save (same as inline)', () => {
    const payload = buildEditFieldsPayload([
      { id: 'f1', label: '  ', type: 'TEXT', required: false, options: [] } as any,
      { id: 'f2', label: 'Keep', type: 'TEXT', required: false, options: [] } as any,
    ])
    expect(payload).toHaveLength(1)
    expect((payload[0] as any).id).toBe('f2')
  })
})
