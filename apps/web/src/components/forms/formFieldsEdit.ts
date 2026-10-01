// components/forms/formFieldsEdit.ts — single source of truth for the
// Form Fields Edit popup draft + validation + payload.
// Extracted from FormDetailPage startEditFields/saveFields so the modal and
// any future editor share identical behavior (no inline/modal divergence).

export type EditFieldDraft = {
  id?: string
  label: string
  type: string
  required: boolean
  options: string[]
  optionPoints: Record<string, number>
  showIfField: string
  showIfValue: string
  hideIfField: string
  hideIfValue: string
  requireIfField: string
  requireIfValue: string
  jumpRules: { equals: string; to: string }[]
}

function asSingle(v: any): { field: string; value: string } {
  const c = Array.isArray(v) ? v[0] : v
  if (!c || typeof c !== 'object') return { field: '', value: '' }
  return { field: String((c as any).fieldId ?? (c as any).field ?? ''), value: String((c as any).equals ?? '') }
}

/** Modal open: convert server fields → editable draft (deep copy). */
export function toEditFields(serverFields: any[]): EditFieldDraft[] {
  return (Array.isArray(serverFields) ? serverFields : []).map((f: any) => {
    let options: string[] = []
    try {
      const raw = typeof f.options === 'string' ? JSON.parse(f.options || '[]') : f.options || []
      options = Array.isArray(raw)
        ? raw.map((o: any) => (typeof o === 'string' ? o : String(o?.label ?? o?.value ?? ''))).filter(Boolean)
        : []
    } catch {
      options = []
    }
    let logic: any = {}
    try {
      logic = typeof (f as any).logic === 'string' ? JSON.parse((f as any).logic || '{}') : (f as any).logic || {}
    } catch {
      logic = {}
    }
    const show = asSingle(logic.showIf)
    const hide = asSingle(logic.hideIf)
    const req = asSingle(logic.requireIf)
    const jumps = Array.isArray(logic.jumpTo) ? logic.jumpTo : logic.jumpTo ? [logic.jumpTo] : []
    let scoreMap: Record<string, number> = {}
    try {
      scoreMap = typeof (f as any).scoreMap === 'string' ? JSON.parse((f as any).scoreMap || '{}') : { ...(((f as any).scoreMap || {}) as Record<string, unknown>) } as any
    } catch {
      scoreMap = {}
    }
    // Merge inline {label,points} options into the points editor.
    try {
      const rawOpts = typeof f.options === 'string' ? JSON.parse(f.options || '[]') : f.options || []
      if (Array.isArray(rawOpts)) {
        for (const o of rawOpts) {
          if (o && typeof o === 'object' && (o as any).label && Number.isFinite(Number((o as any).points)) && (scoreMap as any)[(o as any).label] === undefined) {
            ;(scoreMap as any)[(o as any).label] = Number((o as any).points)
          }
        }
      }
    } catch {
      /* ignore */
    }
    return {
      id: f.id,
      label: f.label ?? '',
      type: f.type ?? 'TEXT',
      required: !!f.required,
      options: [...options],
      optionPoints: { ...(scoreMap as Record<string, number>) },
      showIfField: show.field,
      showIfValue: show.value,
      hideIfField: hide.field,
      hideIfValue: hide.value,
      requireIfField: req.field,
      requireIfValue: req.value,
      jumpRules: jumps
        .filter((r: any) => r && typeof r === 'object' && (r as any).to)
        .map((r: any) => ({
          equals: String((r as any).equals ?? (r as any).contains ?? ''),
          to: String((r as any).to ?? ''),
        })),
    }
  })
}

/** Same validation as inline: at least one non-blank label. */
export function validateEditFields(draft: EditFieldDraft[] | any[]): { ok: boolean; error?: string } {
  const count = (Array.isArray(draft) ? draft : []).filter((f: any) =>
    String((f as any)?.label ?? '').trim(),
  ).length
  if (count === 0) return { ok: false, error: 'Need at least one field' }
  return { ok: true }
}

/** Save: draft → API payload (same shape as inline saveFields). */
export function buildEditFieldsPayload(draft: EditFieldDraft[] | any[]): any[] {
  const list = Array.isArray(draft) ? draft : []
  const valid = list
    .map((f: any, i: number) => ({ f, i }))
    .filter(({ f }: any) => String(f?.label ?? '').trim())
  return valid.map(({ f, i }: any) => {
    const options: string[] = Array.isArray(f.options)
      ? f.options.map((o: any) => String(o ?? '').trim()).filter(Boolean)
      : []
    const scoreMap: Record<string, number> = {}
    const points = (f.optionPoints && typeof f.optionPoints === 'object' ? f.optionPoints : {}) as Record<string, unknown>
    for (const opt of options) {
      const n = Number((points as any)[opt])
      if (Number.isFinite(n) && n !== 0) scoreMap[opt] = Math.max(-10000, Math.min(10000, n))
    }
    const logic: any = {}
    if (f.showIfField && String(f.showIfValue ?? '').trim())
      logic.showIf = [{ field: f.showIfField, equals: String(f.showIfValue).trim() }]
    if (f.hideIfField && String(f.hideIfValue ?? '').trim())
      logic.hideIf = [{ field: f.hideIfField, equals: String(f.hideIfValue).trim() }]
    if (f.requireIfField && String(f.requireIfValue ?? '').trim())
      logic.requireIf = [{ field: f.requireIfField, equals: String(f.requireIfValue).trim() }]
    const jumps = Array.isArray(f.jumpRules) ? f.jumpRules.filter((r: any) => String(r?.equals ?? '').trim() && r?.to) : []
    if (jumps.length > 0) logic.jumpTo = jumps.map((r: any) => ({ equals: String(r.equals).trim(), to: r.to }))
    return {
      ...(f.id && !String(f.id).startsWith('tmp-') ? { id: f.id } : { clientId: `tmp-edit-${i}` }),
      label: String(f.label).trim(),
      type: f.type || 'TEXT',
      required: !!f.required,
      options,
      ...(Object.keys(scoreMap).length > 0 ? { scoreMap } : {}),
      ...(logic.showIf || logic.hideIf || logic.requireIf || logic.jumpTo ? { logic } : {}),
    }
  })
}
