import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import Modal from '../ui/Modal'
import {
  toEditFields,
  validateEditFields,
  buildEditFieldsPayload,
  type EditFieldDraft,
} from './formFieldsEdit'

interface Props {
  open: boolean
  initialFields: any[]
  saving: boolean
  onClose: () => void
  onSave: (payload: any[]) => void
}

function blankField(): EditFieldDraft {
  return {
    label: '',
    type: 'TEXT',
    required: false,
    options: [],
    optionPoints: {},
    showIfField: '',
    showIfValue: '',
    hideIfField: '',
    hideIfValue: '',
    requireIfField: '',
    requireIfValue: '',
    jumpRules: [],
  }
}

function getFieldIcon(type: string) {
  switch (type) {
    case 'TEXT':
      return '📝'
    case 'TEXTAREA':
      return '📄'
    case 'SELECT':
      return '📋'
    case 'RADIO':
      return '🔘'
    case 'CHECKBOX':
      return '☑️'
    case 'NUMBER':
      return '🔢'
    case 'EMAIL':
      return '📧'
    case 'DATE':
      return '📅'
    case 'RATING':
      return '⭐'
    default:
      return '📝'
  }
}

/**
 * Form Fields Edit popup — replaces the old inline sidebar editor.
 * WHY modal: user asked Edit opens a popup, not inline; single source via
 * formFieldsEdit.ts keeps validation/payload identical to the old inline.
 * Focus trap comes from the shared Modal (useFocusTrap) + Esc/backdrop close.
 */
export default function FormFieldsEditModal({ open, initialFields, saving, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<EditFieldDraft[]>([])
  const [expandedLogic, setExpandedLogic] = useState<Record<number, boolean>>({})
  const [formError, setFormError] = useState('')

  // Modal open populates draft; cancel discards by resetting on next open.
  useEffect(() => {
    if (open) {
      setDraft(toEditFields(initialFields))
      setExpandedLogic({})
      setFormError('')
    }
  }, [open, initialFields])

  const updateField = (index: number, updates: Partial<EditFieldDraft>) => {
    setDraft((prev) => {
      const updated = [...prev]
      const next = { ...updated[index], ...updates } as EditFieldDraft
      if (updates.options !== undefined && (next as any).optionPoints) {
        const keep = new Set(
          (Array.isArray(updates.options) ? updates.options : []).map((o: any) => String(o ?? '').trim()).filter(Boolean),
        )
        const pruned: Record<string, number> = {}
        for (const [k, v] of Object.entries((next as any).optionPoints as Record<string, unknown>)) {
          if (keep.has(k)) pruned[k] = v as number
        }
        ;(next as any).optionPoints = pruned
      }
      updated[index] = next
      return updated
    })
  }

  const updateOptionPoints = (index: number, option: string, points: string) => {
    setDraft((prev) => {
      const updated = [...prev]
      const cur = { ...(((updated[index] as any).optionPoints || {}) as Record<string, unknown>) }
      if (points === '' || !Number.isFinite(Number(points))) delete cur[option]
      else cur[option] = Math.max(-10000, Math.min(10000, Number(points)))
      updated[index] = { ...updated[index], optionPoints: cur } as EditFieldDraft
      return updated
    })
  }

  const addField = () => setDraft((prev) => [...prev, blankField()])

  const removeField = (index: number) => {
    setDraft((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  const moveField = (index: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const j = index + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(index, 1)
      next.splice(j, 0, row)
      return next
    })
  }

  const updateJumpRule = (index: number, ruleIdx: number, patch: any) => {
    setDraft((prev) => {
      const updated = [...prev]
      const rules = [...((updated[index] as any).jumpRules || [])]
      rules[ruleIdx] = { ...rules[ruleIdx], ...patch }
      updated[index] = { ...updated[index], jumpRules: rules } as EditFieldDraft
      return updated
    })
  }

  const addJumpRule = (index: number) => {
    setDraft((prev) => {
      const updated = [...prev]
      const rules = [...((updated[index] as any).jumpRules || [])]
      if (rules.length >= 10) return prev
      rules.push({ equals: '', to: '' })
      updated[index] = { ...updated[index], jumpRules: rules } as EditFieldDraft
      return updated
    })
  }

  const removeJumpRule = (index: number, ruleIdx: number) => {
    setDraft((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        jumpRules: ((updated[index] as any).jumpRules || []).filter((_: any, i: number) => i !== ruleIdx),
      } as EditFieldDraft
      return updated
    })
  }

  const handleSave = () => {
    const v = validateEditFields(draft)
    if (!v.ok) {
      setFormError(v.error || 'Need at least one field')
      return
    }
    setFormError('')
    onSave(buildEditFieldsPayload(draft))
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Form Fields" size="lg">
      <div className="space-y-2">
        {draft.map((field: any, i: number) => (
          <div
            key={field.id || `new-${i}`}
            className="p-2.5 bg-surface-50 dark:bg-night-800 rounded-xl border border-surface-100 dark:border-night-600"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-sm" aria-hidden="true">
                {getFieldIcon(field.type)}
              </span>
              <span className="text-[11px] font-bold text-surface-400 w-6 shrink-0" aria-label={`Field ${i + 1} of ${draft.length}`}>
                Q{i + 1}
              </span>
              <input
                type="text"
                value={field.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
                className="flex-1 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs text-surface-900 dark:text-night-50"
                placeholder="Field label"
                aria-label={`Field ${i + 1} label`}
              />
              <button
                type="button"
                onClick={() => moveField(i, -1)}
                disabled={i === 0}
                aria-label={`Move field ${i + 1} up`}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveField(i, 1)}
                disabled={i === draft.length - 1}
                aria-label={`Move field ${i + 1} down`}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-surface-100 dark:hover:bg-night-700 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeField(i)}
                disabled={draft.length <= 1}
                aria-label={`Remove field ${i + 1}`}
                className="text-danger-400 hover:text-danger-600 text-xs disabled:opacity-30"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={field.type}
                onChange={(e) => updateField(i, { type: e.target.value })}
                className="px-1.5 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs text-surface-900 dark:text-night-50"
                aria-label={`Field ${i + 1} type`}
              >
                <option value="TEXT">Text</option>
                <option value="TEXTAREA">Long Text</option>
                <option value="NUMBER">Number</option>
                <option value="EMAIL">Email</option>
                <option value="DATE">Date</option>
                <option value="SELECT">Dropdown</option>
                <option value="RADIO">Radio</option>
                <option value="CHECKBOX">Checkbox</option>
                <option value="RATING">Rating</option>
              </select>
              <label className="flex items-center gap-0.5 text-xs text-surface-700 dark:text-night-200">
                <input
                  type="checkbox"
                  checked={!!field.required}
                  onChange={(e) => updateField(i, { required: e.target.checked })}
                  className="rounded"
                  aria-label={`Field ${i + 1} required`}
                />
                Req
              </label>
            </div>
            {(field.type === 'SELECT' || field.type === 'RADIO' || field.type === 'CHECKBOX') && (
              <>
                <input
                  type="text"
                  value={field.options?.join(', ') || ''}
                  onChange={(e) =>
                    updateField(i, { options: e.target.value.split(',').map((o: string) => o.trim()).filter(Boolean) })
                  }
                  className="w-full mt-1.5 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs text-surface-900 dark:text-night-50"
                  placeholder="Options (comma separated)"
                  aria-label={`Field ${i + 1} options`}
                />
                {(field.options || []).filter(Boolean).length > 0 && (
                  <div className="mt-1 space-y-1">
                    {(field.options || []).filter(Boolean).map((opt: string) => (
                      <div key={opt} className="flex items-center gap-2">
                        <span className="flex-1 truncate text-[11px] text-surface-500 dark:text-night-400">{opt}</span>
                        <input
                          type="number"
                          value={(field.optionPoints?.[opt] ?? '') as any}
                          onChange={(e) => updateOptionPoints(i, opt, e.target.value)}
                          className="w-16 px-1.5 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px] text-surface-900 dark:text-night-50"
                          placeholder="pts"
                          aria-label={`Points for ${opt}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => setExpandedLogic((prev) => ({ ...prev, [i]: !prev[i] }))}
              aria-expanded={!!expandedLogic[i]}
              className="mt-1.5 text-[11px] font-semibold text-primary-600 hover:underline"
            >
              {expandedLogic[i] ? 'Hide logic ▴' : 'Logic ▾'}
            </button>
            {expandedLogic[i] && (
              <div className="mt-1 space-y-1.5 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 p-1.5">
                {[
                  { title: 'Show if', fk: 'showIfField', vk: 'showIfValue' },
                  { title: 'Hide if', fk: 'hideIfField', vk: 'hideIfValue' },
                  { title: 'Require if', fk: 'requireIfField', vk: 'requireIfValue' },
                ].map((row: any) => (
                  <div key={row.fk} className="flex items-center gap-1">
                    <span className="text-[10px] text-surface-400 w-14 shrink-0">{row.title}</span>
                    <select
                      value={(field as any)[row.fk] || ''}
                      onChange={(e) => updateField(i, { [row.fk]: e.target.value } as any)}
                      className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px] text-surface-900 dark:text-night-50"
                      aria-label={`${row.title} source for field ${i + 1}`}
                    >
                      <option value="">Never</option>
                      {draft.slice(0, i).map((prev: any, pi: number) => (
                        <option key={pi} value={prev.id || `tmp-edit-${pi}`}>
                          {String(prev.label || `Q${pi + 1}`).slice(0, 20) || `Q${pi + 1}`}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={(field as any)[row.vk] || ''}
                      onChange={(e) => updateField(i, { [row.vk]: e.target.value } as any)}
                      disabled={!(field as any)[row.fk]}
                      className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px] disabled:opacity-40 text-surface-900 dark:text-night-50"
                      placeholder="is…"
                      aria-label={`${row.title} value for field ${i + 1}`}
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-surface-400">Jump if answer…</p>
                  {(((field as any).jumpRules || []) as any[]).map((rule: any, ri: number) => (
                    <div key={ri} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={rule.equals || ''}
                        onChange={(e) => updateJumpRule(i, ri, { equals: e.target.value })}
                        className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px] text-surface-900 dark:text-night-50"
                        placeholder="equals…"
                        aria-label={`Jump rule ${ri + 1} value for field ${i + 1}`}
                      />
                      <span className="text-[10px]">→</span>
                      <select
                        value={rule.to || ''}
                        onChange={(e) => updateJumpRule(i, ri, { to: e.target.value })}
                        className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px] text-surface-900 dark:text-night-50"
                        aria-label={`Jump rule ${ri + 1} target for field ${i + 1}`}
                      >
                        <option value="">…</option>
                        {draft.slice(i + 1).map((next: any, ni: number) => (
                          <option key={ni} value={next.id || `tmp-edit-${i + 1 + ni}`}>
                            {String(next.label || `Q${i + 2 + ni}`).slice(0, 20) || `Q${i + 2 + ni}`}
                          </option>
                        ))}
                        <option value="__END__">End</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeJumpRule(i, ri)}
                        className="text-danger-400 text-[11px]"
                        aria-label={`Remove jump rule ${ri + 1} for field ${i + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addJumpRule(i)}
                    className="text-[11px] font-semibold text-primary-600 hover:underline"
                  >
                    + Jump
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg"
        >
          <Plus size={12} /> Add Field
        </button>
        {formError && (
          <p role="alert" className="text-xs text-danger-600">
            {formError}
          </p>
        )}
      </div>

      <div className="flex gap-3 mt-5">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-600 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 dark:hover:bg-night-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 transition-colors shadow-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
