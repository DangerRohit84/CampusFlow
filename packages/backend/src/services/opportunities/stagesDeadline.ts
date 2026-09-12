// opportunities/stagesDeadline.ts — deadline grounding helpers (SRP extract from stages.ts).
// WHY: stages.ts mixed deadline-variant grounding + AI-trust + enrich orchestration
// in one 865-line god. These pure helpers are independently unit-testable (no DB/AI).
// Moved verbatim from stages.ts; no behavior change.
import { isEnded } from './dates'

export function generateDeadlineVariants(iso: string): string[] {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return [iso.toLowerCase()]
    const y = String(d.getFullYear())
    const yy = y.slice(-2)
    const m = d.getMonth()
    const day = String(d.getDate())
    const dayPad = day.padStart(2, '0')
    const monthNum = String(m + 1).padStart(2, '0')
    const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const monthsLong = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    const ms = monthsShort[m]
    const ml = monthsLong[m]
    return [
      iso.toLowerCase(),
      `${y}-${monthNum}-${dayPad}`,
      `${dayPad}-${monthNum}-${y}`,
      `${dayPad}/${monthNum}/${y}`,
      `${dayPad}-${monthNum}-${yy}`,
      `${dayPad}/${monthNum}/${yy}`,
      `${day} ${ms} ${y}`,
      `${dayPad} ${ms} ${y}`,
      `${day} ${ms} ${yy}`,
      `${day} ${ml} ${y}`,
      `${dayPad} ${ml} ${y}`,
      `${ms} ${day} ${y}`,
      `${ms} ${day}, ${y}`,
      `${ml} ${day} ${y}`,
      `${ml} ${day}, ${y}`,
      `${ms} ${dayPad} ${y}`,
      `${ms} ${dayPad}, ${y}`,
      `${day} ${ms}`,
      `${ms} ${day}`,
      `${dayPad} ${ms}`,
    ].map(s => s.toLowerCase())
  } catch { return [iso.toLowerCase()] }
}

export function findDeadlineVariantIndex(contentLower: string, iso: string): number {
  const variants = generateDeadlineVariants(iso)
  let bestIdx = -1
  for (const v of variants) {
    const idx = contentLower.indexOf(v)
    if (idx !== -1) {
      if (bestIdx === -1 || idx < bestIdx) bestIdx = idx
    }
  }
  return bestIdx
}

export function findAllDeadlineIndices(contentLower: string, iso: string): number[] {
  const variants = generateDeadlineVariants(iso)
  const indices: number[] = []
  for (const v of variants) {
    let from = 0
    while (true) {
      const idx = contentLower.indexOf(v, from)
      if (idx === -1) break
      indices.push(idx)
      from = idx + v.length
      if (indices.length > 10) break
    }
  }
  return indices
}

export function isDeadlineLikelyBeginDate(content: string, deadlineIso: string): boolean {
  if (!content || !deadlineIso) return false
  const lower = content.toLowerCase()
  const indices = findAllDeadlineIndices(lower, deadlineIso)
  for (const idx of indices) {
    const winStart = Math.max(0, idx - 80)
    const winEnd = Math.min(lower.length, idx + 80)
    const win = lower.slice(winStart, winEnd)
    const hasBegin = /registrations?\s+(begin|start|open)|registration\s+(begins|starts|opens)|begins\s+on|starts\s+on|opens\s+on/i.test(win)
    const hasEnd = /last\s+date|deadline|closes?\s+on|ends?\s+on|apply\s+by|submission\s+deadline|registration\s+ends?|registration\s+closes?|registrations?\s+end|registrations?\s+close/i.test(win)
    if (hasBegin && !hasEnd) return true
    if (hasBegin && hasEnd) {
      const beginIdx = win.search(/registrations?\s+(begin|start|open)|registration\s+(begins|starts|opens)/i)
      const endIdx = win.search(/last\s+date|deadline|closes?\s+on|ends?\s+on|apply\s+by|registration\s+ends?|registrations?\s+end/i)
      if (beginIdx !== -1 && endIdx !== -1 && beginIdx < endIdx) {
        continue
      }
      if (hasBegin) return true
    }
    if (/registrations?\s+begin|registration\s+begins/i.test(win)) return true
  }
  try {
    const d = new Date(deadlineIso)
    if (!isNaN(d.getTime())) {
      const lowerNoExtra = lower.replace(/\s+/g, ' ')
      const hasDashRange = /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\s*[-–]\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i.test(lowerNoExtra)
      if (hasDashRange) {
        const dashIdx = lowerNoExtra.search(/[-–]/)
        const idxFirst = findDeadlineVariantIndex(lowerNoExtra, deadlineIso)
        if (idxFirst !== -1 && dashIdx !== -1 && idxFirst < dashIdx) {
          const afterDash = lowerNoExtra.slice(dashIdx, dashIdx + 120)
          if (/regist/i.test(afterDash) || /deadline|last\s+date/i.test(lowerNoExtra.slice(dashIdx))) return true
        }
      }
    }
  } catch { /* never fail grounding on heuristic throw */ }
  return false
}

export function isAiDeadlineGrounded(content: string, deadlineIso: string): boolean {
  if (!content || !deadlineIso) return false
  const lower = content.toLowerCase()
  const idx = findDeadlineVariantIndex(lower, deadlineIso)
  if (idx !== -1) return true
  try {
    const d = new Date(deadlineIso)
    if (!isNaN(d.getTime())) {
      const y = String(d.getFullYear())
      const mShort = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][d.getMonth()]
      const day = String(d.getDate())
      if (lower.includes(mShort) && lower.includes(day) && lower.includes(y)) return true
    }
  } catch { /* ignore */ }
  return false
}

export function isAiDeadlineHighTrust(content: string, aiIso: string, title?: string): boolean {
  if (!aiIso) return false
  const d = new Date(aiIso)
  if (isNaN(d.getTime())) return false
  if (isEnded(aiIso, title)) return false
  const y = d.getFullYear()
  if (y < 2024 || y > 2030) return false
  if (d.getTime() < Date.now()) return false
  return isAiDeadlineGrounded(content, aiIso)
}

/** Treat YYYY-MM-DD as 23:59 IST (registrations end = end of day). */
export function toIstDeadline(dateStr: string): Date | null {
  if (!dateStr) return null
  if (/T/.test(dateStr)) {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) return d
  }
  const d = new Date(`${dateStr}T23:59:00+05:30`)
  if (!isNaN(d.getTime())) return d
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) return d2
  return null
}
