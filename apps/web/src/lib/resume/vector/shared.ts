// resume/vector/shared.ts — jsPDF shared helpers (SRP extract from resumeVectorPdf.ts).
// WHY: loadJsPDF/safeName/palette/skill-rows/bullet-draw were inline in the
// 1557-line god. Pure helpers, unit-testable, no template logic.
import type { ResumeData, ResumeTemplateId } from '../../../types/resume'
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume'

export type JsPDFInstance = any

export async function loadJsPDF(): Promise<any> {
  const mod: any = await import('jspdf')
  return mod.jsPDF || mod.default || mod
}

export function safeName(data: ResumeData): string {
  return (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_') || 'Resume'
}

// ---------- helpers shared ----------

export function createBaseHelpers(doc: JsPDFInstance, pageW: number, pageH: number, margin: number) {
  const contentW = pageW - margin * 2
  const bottomLimit = pageH - margin
  const colBlack = '#111827'
  const colGray = '#6b7280'
  const colMuted = '#9ca3af'
  const colPrimary = '#1d4ed8'
  const colText = '#1f2937'
  const colAccent = '#2D4A9A'
  return { contentW, bottomLimit, colBlack, colGray, colMuted, colPrimary, colText, colAccent }
}

export function parseSkillRows(skills: string[]): { label: string; value: string }[] {
  if (!skills || skills.length === 0) return []
  const hasColon = skills.some(s => String(s).includes(':'))
  if (!hasColon) return [{ label: 'Skills', value: skills.map(s=>String(s).trim()).filter(Boolean).join(', ') }]
  const rows: { label: string; value: string }[] = []
  for (const raw of skills) {
    const s = String(raw).trim()
    if (!s) continue
    const idx = s.indexOf(':')
    if (idx > 0) {
      rows.push({ label: s.slice(0, idx).trim(), value: s.slice(idx+1).trim() })
    } else {
      if (rows.length) rows[rows.length-1].value += `, ${s}`
      else rows.push({ label: 'Other', value: s })
    }
  }
  return rows.filter(r=>r.value)
}

export function drawBulletWithBold(doc: JsPDFInstance, text: string, x: number, y: number, maxW: number, size: number, colText: string): number {
  // Returns height used
  const full = `•  ${text}`
  const hasColon = text.indexOf(':') > 1 && text.indexOf(':') < 80
  if (!hasColon) {
    const lines = doc.splitTextToSize(full, maxW)
    doc.setFont('helvetica','normal'); doc.setFontSize(size); doc.setTextColor(colText)
    doc.text(full, x, y, { maxWidth: maxW, lineHeightFactor: 1.18 } as any)
    return (lines as string[]).length * size * 1.18
  }
  const idx = text.indexOf(':')
  const keyword = text.slice(0, idx+1)
  const rest = text.slice(idx+1).trim()
  const bulletPrefix = '•  '
  // Measure to decide wrapping: simple — draw first line with bold keyword, rest normal
  // For wrapping, we approximate by splitting rest
  const firstLine = `${bulletPrefix}${keyword} ${rest}`
  const lines = doc.splitTextToSize(firstLine, maxW)
  if ((lines as string[]).length === 1) {
    // Single line — draw with two font weights
    const bulletW = doc.getTextWidth(bulletPrefix)
    doc.setFont('helvetica','normal'); doc.setFontSize(size); doc.setTextColor(colText)
    doc.text(bulletPrefix, x, y)
    const kwX = x + bulletW
    doc.setFont('helvetica','bold'); doc.setFontSize(size)
    doc.text(keyword, kwX, y)
    const kwW = doc.getTextWidth(keyword + ' ')
    doc.setFont('helvetica','normal')
    doc.text(' ' + rest, kwX + kwW, y)
    return size * 1.18
  } else {
    // Multi-line: fallback to normal rendering but keep bold effect by drawing first line bold, rest normal with manual split
    // Simplified: just render as normal but with bold keyword prefix via separate text — jsPDF will handle wrap for the rest part only if we offset
    // For simplicity, render entire bullet normally but bold the keyword via text styling approximation: draw bullet normally
    doc.setFont('helvetica','normal'); doc.setFontSize(size); doc.setTextColor(colText)
    doc.text(full, x, y, { maxWidth: maxW, lineHeightFactor: 1.18 } as any)
    // Overdraw keyword bold on top (approximation)
    try {
      const bulletW = doc.getTextWidth(bulletPrefix)
      doc.setFont('helvetica','bold')
      doc.text(keyword, x + bulletW, y)
    } catch {}
    return (lines as string[]).length * size * 1.18
  }
}
