// resume/vector/custom.ts — Custom editable template (SRP extract).
// WHY: 150-250 line template with nested closures was inline in the god.
// Moved verbatim; shared helpers via ./shared. Behavior identical.
import type { ResumeData } from '../../../types/resume';
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume';
import type { JsPDFInstance } from './shared';
import { createBaseHelpers, parseSkillRows, drawBulletWithBold, safeName } from './shared';

export async function renderCustom(doc: JsPDFInstance, data: ResumeData) {
  const cfg: any = (data as any).customConfig || DEFAULT_CUSTOM_CONFIG
  const accent: string = cfg.accentColor || DEFAULT_CUSTOM_CONFIG.accentColor
  const fontFamily: string = cfg.fontFamily || 'sans'
  const density: string = cfg.density || 'comfortable'
  const hidden: Set<string> = new Set(cfg.hiddenSections || [])
  const order: string[] = Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : [...DEFAULT_CUSTOM_CONFIG.sectionOrder]
  const showDividers: boolean = cfg.showDividers !== false
  const headingStyle: string = cfg.headingStyle || 'uppercase'

  // jsPDF font mapping — built-ins only: helvetica≈sans, times≈serif, courier≈mono, helveticaBold for display
  const baseFont: 'helvetica' | 'times' | 'courier' = fontFamily === 'serif' ? 'times' : fontFamily === 'mono' ? 'courier' : 'helvetica'
  const headingTransform = (t: string) => headingStyle === 'uppercase' ? t.toUpperCase() : headingStyle === 'capitalize' ? t.replace(/\b\w/g, c=>c.toUpperCase()) : t

  // density affects sizes and spacing
  const isCompact = density === 'compact'
  const isSpacious = density === 'spacious'
  const margin = isCompact ? 32 : isSpacious ? 42 : 36
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - margin * 2
  const bottomLimit = pageH - margin
  let y = margin
  const colText = '#1f2937'
  const colMuted = '#6b7280'
  const colAccent = accent

  function ensureSpace(need: number) { if (y + need > bottomLimit) { doc.addPage(); y = margin } }
  function hairline() {
    if (!showDividers) return
    doc.setDrawColor(colAccent); doc.setLineWidth(0.6); doc.line(margin, y, pageW - margin, y); y += 4
  }
  function sectionHead(title: string) {
    const t = headingTransform(title)
    const sz = isCompact ? 10.2 : isSpacious ? 12 : 11
    ensureSpace(16)
    doc.setFont(baseFont, 'bold'); doc.setFontSize(sz); doc.setTextColor(colAccent)
    // simple letter-spacing via charSpace not needed
    doc.text(t, margin, y); y = doc.y + 2
    if (showDividers) {
      doc.setDrawColor(colAccent); doc.setLineWidth(0.6); doc.line(margin, y, pageW - margin, y); y += 6
    } else {
      y += 3
    }
  }

  const p: any = data.personalInfo || {}
  // Header — gradient not reproduced in PDF — use white with accent underline
  // Name
  const nameSize = isCompact ? 22 : isSpacious ? 26 : 24
  doc.setFont(baseFont, 'bold'); doc.setFontSize(nameSize); doc.setTextColor('#0f172a')
  const fullName = String(p.fullName || 'Your Name').trim() || 'Your Name'
  const nameLines = doc.splitTextToSize(fullName, contentW - 110)
  doc.text(fullName, margin, y, { maxWidth: contentW - 110 } as any)
  if (p.location?.trim()) {
    doc.setFont(baseFont, 'normal'); doc.setFontSize(9); doc.setTextColor(colAccent)
    doc.text(String(p.location).trim(), pageW - margin, y, { align: 'right' } as any)
  }
  y += Math.max((nameLines as string[]).length * nameSize * 1.05, 12) + 2
  // headline pill-like — render as bold uppercase accent
  const headline = String(p.headline || 'FULL STACK DEVELOPER').trim().toUpperCase() || 'FULL STACK DEVELOPER'
  doc.setFont(baseFont, 'bold'); doc.setFontSize(isCompact ? 8.8 : 9.5); doc.setTextColor(colAccent)
  doc.text(headline, margin, y); y += 8
  // Contact pills row
  const contactParts: string[] = []
  if (p.email?.trim()) contactParts.push(String(p.email).trim())
  if (p.phone?.trim()) contactParts.push(String(p.phone).trim())
  const links = (p.links || []).filter((l: any) => l.url?.trim())
  const linkLine = links.map((l: any) => `${l.label}: ${l.url}`).join(' | ')
  const contactLine = contactParts.join(' | ') + (linkLine ? (contactParts.length ? ' | ' + linkLine : linkLine) : '')
  if (contactLine) {
    doc.setFont(baseFont, 'normal'); doc.setFontSize(isCompact ? 7.2 : 7.8); doc.setTextColor(colMuted)
    const clines = doc.splitTextToSize(contactLine, contentW)
    doc.text(contactLine, margin, y, { maxWidth: contentW, lineHeightFactor: 1.25 } as any)
    y += (clines as string[]).length * 7.8 * 1.25 + 2
    // hyperlink email + links (best effort)
    try {
      if (p.email?.trim() && contactLine.includes(String(p.email).trim())) {
        const email = String(p.email).trim()
        const w = doc.widthOfString(contactLine)
        const lineW = Math.min(w, contentW)
        const startX = margin + (contactLine.includes(' | ') ? 0 : 0) // left aligned, so start at margin
        const idx = contactLine.indexOf(email)
        if (idx >= 0) {
          const prefixW = doc.widthOfString(contactLine.slice(0, idx))
          doc.link(startX + prefixW, y - ((clines as string[]).length * 7.8 * 1.25) - 2, doc.widthOfString(email), 8, `mailto:${email}`)
        }
      }
      for (const l of links) {
        const seg = `${l.label}: ${l.url}`
        const idx = contactLine.indexOf(seg)
        if (idx >= 0) {
          const prefixW = doc.widthOfString(contactLine.slice(0, idx))
          doc.link(margin + prefixW, y - ((clines as string[]).length * 7.8 * 1.25) - 2, doc.widthOfString(seg), 8, String(l.url))
        }
      }
    } catch {}
  }
  hairline()
  y += 2

  // Helper to render each section based on id
  const renderers: Record<string, () => void> = {
    summary: () => {
      if (hidden.has('summary')) return
      const summary = String(p.summary || '').trim()
      if (!summary) return
      sectionHead('Summary')
      doc.setFont(baseFont, 'normal'); doc.setFontSize(isCompact ? 9 : 9.5); doc.setTextColor(colText)
      const lines = doc.splitTextToSize(summary, contentW)
      doc.text(summary, margin, y, { maxWidth: contentW, lineHeightFactor: 1.45 } as any)
      y += (lines as string[]).length * 9.5 * 1.45 + 4
    },
    skills: () => {
      if (hidden.has('skills') || !data.skills?.length) return
      sectionHead('Technical Skills')
      const rows = parseSkillRows(data.skills || [])
      const labelW = 110
      const gap = 6
      const valueW = contentW - labelW - gap
      for (const row of rows) {
        const value = row.value
        const vLines = doc.splitTextToSize(value, valueW)
        const vH = (vLines as string[]).length * 9.2 * 1.45
        ensureSpace(Math.max(vH, 9.2 * 1.45) + 2)
        doc.setFont(baseFont, 'bold'); doc.setFontSize(9); doc.setTextColor(colAccent)
        doc.text(row.label + ':', margin, y, { maxWidth: labelW } as any)
        doc.setFont(baseFont, 'normal'); doc.setFontSize(9); doc.setTextColor(colText)
        doc.text(value, margin + labelW + gap, y, { maxWidth: valueW, lineHeightFactor: 1.45 } as any)
        y += vH + 2
      }
    },
    experience: () => {
      if (hidden.has('experience') || !data.experience?.length) return
      sectionHead('Experience')
      for (const exp of data.experience) {
        const role = String(exp.role || 'Role').trim() || 'Role'
        const company = String(exp.company || 'Company').trim() || 'Company'
        const loc = exp.location?.trim() ? ` · ${String(exp.location).trim()}` : ''
        const dateRange = [String(exp.startDate || '').trim(), String(exp.endDate || '').trim()].filter(Boolean).join(' – ') || ''
        const titleLine = `${role} — ${company}${loc}`
        const tl = doc.splitTextToSize(titleLine, contentW - 95)
        const th = (tl as string[]).length * 9.5 * 1.2
        ensureSpace(th + 10)
        doc.setFont(baseFont, 'bold'); doc.setFontSize(9.8); doc.setTextColor('#111827')
        doc.text(titleLine, margin, y, { maxWidth: contentW - 95 } as any)
        if (dateRange) { doc.setFont(baseFont, 'normal'); doc.setFontSize(8); doc.setTextColor(colAccent); doc.text(dateRange, pageW - margin, y, { align: 'right' } as any) }
        y += Math.max(th, 9.5 * 1.2) + 1
        for (const b of (exp.bullets || []).map((x: string) => String(x).trim()).filter(Boolean)) {
          const bullet = `•  ${b}`
          const bl = doc.splitTextToSize(bullet, contentW - 12)
          const bh = (bl as string[]).length * 9 * 1.35
          ensureSpace(bh + 2)
          doc.setFont(baseFont, 'normal'); doc.setFontSize(9); doc.setTextColor(colText)
          // bold keyword if colon
          if (b.indexOf(':') > 1 && b.indexOf(':') < 80) {
            drawBulletWithBold(doc, b, margin + 8, y, contentW - 12, 9, colText)
            y += bh + 0.8
          } else {
            doc.text(bullet, margin + 8, y, { maxWidth: contentW - 12, lineHeightFactor: 1.35 } as any); y += bh + 0.8
          }
        }
        y += 2
      }
    },
    projects: () => {
      if (hidden.has('projects') || !data.projects?.length) return
      sectionHead('Projects')
      for (const proj of data.projects) {
        const title = String(proj.title || 'Untitled').trim() || 'Untitled'
        const dateStr = String(proj.date || '').trim()
        const tl = doc.splitTextToSize(title, contentW - 60)
        const th = (tl as string[]).length * 9.5 * 1.2
        ensureSpace(th + 8)
        doc.setFont(baseFont, 'bold'); doc.setFontSize(9.8); doc.setTextColor('#111827')
        doc.text(title, margin, y, { maxWidth: contentW - 60 } as any)
        if (dateStr) { doc.setFont(baseFont, 'normal'); doc.setFontSize(8); doc.setTextColor(colAccent); doc.text(dateStr, pageW - margin, y, { align: 'right' } as any) }
        y += Math.max(th, 9.5 * 1.2) + 1
        if (proj.tech?.length) {
          const tech = proj.tech.join(' · ')
          doc.setFont(baseFont, 'italic'); doc.setFontSize(8); doc.setTextColor(colAccent)
          doc.text(tech, margin, y, { maxWidth: contentW } as any); y += 8
        }
        if (proj.description?.trim()) {
          const d = String(proj.description).trim()
          const dl = doc.splitTextToSize(d, contentW)
          ensureSpace((dl as string[]).length * 9 * 1.35 + 2)
          doc.setFont(baseFont, 'normal'); doc.setFontSize(9); doc.setTextColor(colText)
          doc.text(d, margin, y, { maxWidth: contentW, lineHeightFactor: 1.35 } as any); y += (dl as string[]).length * 9 * 1.35 + 1
        }
        if (proj.link?.trim()) {
          const url = String(proj.link).trim()
          doc.setFont(baseFont, 'normal'); doc.setFontSize(7.5); doc.setTextColor(colAccent)
          doc.textWithLink(url, margin, y, { url } as any); try { doc.link(margin, y - 5, Math.min(doc.getTextWidth(url), contentW), 7, { url } as any) } catch {} y += 8
        }
        y += 3
      }
    },
    education: () => {
      if (hidden.has('education') || !data.education?.length) return
      sectionHead('Education')
      for (const ed of data.education) {
        const degree = String(ed.degree || 'Degree').trim() || 'Degree'
        const school = String(ed.school || 'Institution').trim() || 'Institution'
        const loc2 = ed.location?.trim() ? `, ${String(ed.location).trim()}` : ''
        const dateRange2 = [String(ed.startDate || '').trim(), String(ed.endDate || '').trim()].filter(Boolean).join(' – ') || ''
        const titleLine = `${degree} — ${school}${loc2}`
        const tl = doc.splitTextToSize(titleLine, contentW - 80)
        const th = (tl as string[]).length * 9.5 * 1.2
        ensureSpace(th + 8)
        doc.setFont(baseFont, 'bold'); doc.setFontSize(9.8); doc.setTextColor('#111827')
        doc.text(titleLine, margin, y, { maxWidth: contentW - 80 } as any)
        if (dateRange2) { doc.setFont(baseFont, 'normal'); doc.setFontSize(8); doc.setTextColor(colAccent); doc.text(dateRange2, pageW - margin, y, { align: 'right' } as any) }
        y += Math.max(th, 9.5 * 1.2) + 1
        if (ed.cgpa?.trim()) { doc.setFont(baseFont, 'normal'); doc.setFontSize(8); doc.setTextColor(colMuted); doc.text(`CGPA: ${String(ed.cgpa).trim()}`, margin, y, { maxWidth: contentW } as any); y += 8 }
        y += 1
      }
    },
    certifications: () => {
      const certs = (data as any).certifications as any[] || []
      if (hidden.has('certifications') || !certs.length) return
      sectionHead('Certifications')
      for (const c of certs) {
        const name2 = String(c.name || 'Certification').trim() || 'Certification'
        const issuer = c.issuer?.trim() ? ` — ${String(c.issuer).trim()}` : ''
        const date2 = String(c.date || '').trim()
        const titleLine = `${name2}${issuer}`
        const tl = doc.splitTextToSize(titleLine, contentW - 80)
        const th = (tl as string[]).length * 9.5 * 1.2
        ensureSpace(th + 6)
        doc.setFont(baseFont, 'bold'); doc.setFontSize(9.5); doc.setTextColor('#111827')
        doc.text(titleLine, margin, y, { maxWidth: contentW - 80 } as any)
        if (date2) { doc.setFont(baseFont, 'normal'); doc.setFontSize(8); doc.setTextColor(colAccent); doc.text(date2, pageW - margin, y, { align: 'right' } as any) }
        y += Math.max(th, 9.5 * 1.2) + 1
        if (c.url?.trim()) {
          const url = String(c.url).trim()
          doc.setFont(baseFont, 'normal'); doc.setFontSize(7.5); doc.setTextColor(colAccent)
          doc.textWithLink(url, margin, y, { url } as any); try { doc.link(margin, y - 5, Math.min(doc.getTextWidth(url), contentW), 7, { url } as any) } catch {} y += 8
        }
        y += 1
      }
    },
  }

  for (const id of order) {
    const fn = renderers[id]
    if (fn) fn()
  }

  doc.setFont(baseFont, 'normal'); doc.setFontSize(6); doc.setTextColor('#9ca3af')
  doc.text('Custom • fully editable — accent/font/density/order reflect preview', pageW / 2, pageH - margin + 6, { align: 'center' } as any)
}

/**
 * Generate selectable, hyperlinked A4 PDF (dispatch by data.template)
 */
