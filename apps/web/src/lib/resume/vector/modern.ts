// resume/vector/modern.ts — Modern 2-col template (SRP extract).
// WHY: 150-250 line template with nested closures was inline in the god.
// Moved verbatim; shared helpers via ./shared. Behavior identical.
import type { ResumeData } from '../../../types/resume';
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume';
import type { JsPDFInstance } from './shared';
import { createBaseHelpers, parseSkillRows, drawBulletWithBold, safeName } from './shared';

export async function renderModern(doc: JsPDFInstance, data: ResumeData) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 36 // 0.50in
  const gap = 16
  const contentW = pageW - margin * 2
  const leftW = Math.floor(contentW * 0.62)
  const rightW = contentW - leftW - gap
  const bottomLimit = pageH - margin
  const colAccent = '#2D4A9A'
  const colText = '#1f2937'
  const colMuted = '#6b7280'
  const colBlack = '#111827'
  let yHeaderEnd = margin

  const p = data.personalInfo
  doc.setFillColor(colAccent)
  doc.rect(margin, yHeaderEnd - 8, contentW, 2.5, 'F')
  let y = yHeaderEnd + 4
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(colAccent)
  {
    const name = (p.fullName || 'Your Name').trim() || 'Your Name'
    const lines = doc.splitTextToSize(name, contentW)
    doc.text(name, pageW / 2, y, { align: 'center', maxWidth: contentW } as any)
    y += (lines as string[]).length * 20 * 1.12 + 2
  }
  if (p.headline?.trim()) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(colMuted)
    const hl = p.headline.trim()
    doc.text(hl, pageW / 2, y, { align: 'center', maxWidth: contentW } as any)
    y += 11
  }
  {
    const parts: string[] = []
    if (p.email?.trim()) parts.push(p.email.trim())
    if (p.phone?.trim()) parts.push(p.phone.trim())
    if (p.location?.trim()) parts.push(p.location.trim())
    const linkLabels = (p.links || []).filter(l=>l.url?.trim()).map(l=> `${l.label}`)
    if (linkLabels.length) parts.push(...linkLabels)
    const contactLine = parts.join('  |  ')
    if (contactLine) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(colMuted)
      doc.text(contactLine, pageW / 2, y, { align: 'center', maxWidth: contentW } as any)
      try {
        if (p.email?.trim()) {
          const email = p.email.trim()
          const w = doc.getTextWidth(contactLine)
          const startX = pageW / 2 - w / 2
          const idx = contactLine.indexOf(email)
          if (idx >= 0) {
            const prefixW = doc.getTextWidth(contactLine.slice(0, idx))
            doc.link(startX + prefixW, y - 5, doc.getTextWidth(email), 7, { url: `mailto:${email}` } as any)
          }
        }
        let cursorX = pageW/2 - doc.getTextWidth(contactLine)/2
        for (const l of (p.links||[]).filter(x=>x.url?.trim())) {
          const seg = l.label
          const idx = contactLine.indexOf(seg)
          if (idx >= 0) {
            const prefixW = doc.getTextWidth(contactLine.slice(0, idx))
            const segW = doc.getTextWidth(seg)
            doc.link(cursorX + prefixW, y -5, segW, 7, { url: l.url } as any)
          }
        }
      } catch {}
      y += 9
    }
  }
  doc.setDrawColor(colAccent); doc.setLineWidth(0.6); doc.line(margin, y, pageW - margin, y)
  y += 6
  if (p.summary?.trim()) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(colAccent)
    doc.text('SUMMARY', margin, y)
    y += 5
    doc.setDrawColor(colAccent); doc.setLineWidth(0.5); doc.line(margin, y, pageW - margin, y); y += 4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(colText)
    const lines = doc.splitTextToSize(p.summary.trim(), contentW)
    doc.text(p.summary.trim(), margin, y, { maxWidth: contentW, lineHeightFactor: 1.18 } as any)
    y += (lines as string[]).length * 7.6 * 1.18 + 6
  }

  const y0 = y
  let yLeft = y0
  let yRight = y0

  function ensureLeft(need: number) {
    if (yLeft + need > bottomLimit) { doc.addPage(); yLeft = margin; yRight = margin; y0Ref.value = margin }
  }
  function ensureRight(need: number) {
    if (yRight + need > bottomLimit) { doc.addPage(); yRight = margin; yLeft = margin; y0Ref.value = margin }
  }
  const y0Ref = { value: y0 }

  function leftSection(title: string) {
    ensureLeft(18)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(colAccent)
    doc.text(title.toUpperCase(), margin, yLeft)
    yLeft += 5
    doc.setDrawColor(colAccent); doc.setLineWidth(0.5); doc.line(margin, yLeft, margin + leftW, yLeft); yLeft += 4
  }
  function rightSection(title: string) {
    ensureRight(18)
    const rx = margin + leftW + gap
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(colAccent)
    doc.text(title.toUpperCase(), rx, yRight)
    yRight += 5
    doc.setDrawColor(colAccent); doc.setLineWidth(0.5); doc.line(rx, yRight, rx + rightW, yRight); yRight += 4
  }

  if (data.experience?.length) {
    leftSection('Experience')
    for (const exp of data.experience) {
      const role = (exp.role || 'Role').trim() || 'Role'
      const company = (exp.company || 'Company').trim() || 'Company'
      const loc = exp.location?.trim() ? ` | ${exp.location.trim()}` : ''
      const dateRange = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' – ') || ''
      const titleLine = `${role} — ${company}${loc}`
      const tLines = doc.splitTextToSize(titleLine, leftW - 70)
      const tH = (tLines as string[]).length * 8 * 1.18
      ensureLeft(Math.max(tH, 10) + 8)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(colBlack)
      doc.text(titleLine, margin, yLeft, { maxWidth: leftW - 70 } as any)
      if (dateRange) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(colAccent)
        doc.text(dateRange, margin + leftW, yLeft, { align: 'right' } as any)
      }
      yLeft += Math.max(tH, 9) + 1
      const bullets = (exp.bullets || []).map(b=>String(b).trim()).filter(Boolean)
      for (const b of bullets) {
        const txt = `• ${b}`
        const bl = doc.splitTextToSize(txt, leftW - 8)
        const bh = (bl as string[]).length * 7.2 * 1.18
        ensureLeft(bh + 2)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(colText)
        doc.text(txt, margin + 6, yLeft, { maxWidth: leftW - 8 } as any)
        yLeft += bh + 1
      }
      yLeft += 3
    }
  }
  if (data.projects?.length) {
    leftSection('Projects')
    for (const proj of data.projects) {
      const title = (proj.title || 'Untitled').trim() || 'Untitled'
      const dateStr = (proj.date || '').trim()
      const tt = doc.splitTextToSize(title, leftW - 50)
      const th = (tt as string[]).length * 8 * 1.18
      ensureLeft(Math.max(th, 10)+8)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(colBlack)
      doc.text(title, margin, yLeft, { maxWidth: leftW - 50 } as any)
      if (dateStr) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(colMuted)
        doc.text(dateStr, margin + leftW, yLeft, { align: 'right' } as any)
      }
      yLeft += Math.max(th, 9)+1
      if (proj.tech?.length) {
        const tech = proj.tech.join(' · ')
        const tl = doc.splitTextToSize(tech, leftW)
        ensureLeft((tl as string[]).length * 6.8 *1.18 +2)
        doc.setFont('helvetica', 'italic'); doc.setFontSize(6.8); doc.setTextColor(colAccent)
        doc.text(tech, margin, yLeft, { maxWidth: leftW } as any)
        yLeft += (tl as string[]).length * 6.8 *1.18 +1
      }
      if (proj.description?.trim()) {
        const d = proj.description.trim()
        const dl = doc.splitTextToSize(d, leftW)
        ensureLeft((dl as string[]).length *7.2*1.18+2)
        doc.setFont('helvetica','normal'); doc.setFontSize(7.2); doc.setTextColor(colText)
        doc.text(d, margin, yLeft, { maxWidth: leftW } as any)
        yLeft += (dl as string[]).length *7.2*1.18 +1
      }
      if (proj.link?.trim()) {
        const url = proj.link.trim()
        ensureLeft(8)
        doc.setFont('helvetica','normal'); doc.setFontSize(6.8); doc.setTextColor(colAccent)
        doc.textWithLink(url, margin, yLeft, { url } as any)
        try{ doc.link(margin, yLeft-5, Math.min(doc.getTextWidth(url), leftW), 7, { url } as any)}catch{}
        yLeft += 7
      }
      yLeft += 3
    }
  }

  const rx = margin + leftW + gap
  if (data.skills?.length) {
    rightSection('Skills')
    doc.setFont('helvetica','normal'); doc.setFontSize(7.2); doc.setTextColor(colText)
    const skillText = data.skills.join(', ')
    const sl = doc.splitTextToSize(skillText, rightW)
    doc.text(skillText, rx, yRight, { maxWidth: rightW, lineHeightFactor:1.18 } as any)
    yRight += (sl as string[]).length *7.2*1.18 + 4
  }
  if (data.education?.length) {
    rightSection('Education')
    for (const ed of data.education) {
      const degree = (ed.degree || 'Degree').trim() || 'Degree'
      const school = (ed.school || 'Institution').trim() || 'Institution'
      const loc2 = ed.location?.trim() ? `, ${ed.location.trim()}` : ''
      const dateRange2 = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' – ') || ''
      const cgpaStr = ed.cgpa?.trim() ? `CGPA: ${ed.cgpa.trim()}` : ''
      const dl = doc.splitTextToSize(degree, rightW)
      ensureRight((dl as string[]).length *8*1.18 + 14)
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(colBlack)
      doc.text(degree, rx, yRight, { maxWidth: rightW } as any)
      yRight += (dl as string[]).length *8*1.18 +1
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colText)
      doc.text(`${school}${loc2}`, rx, yRight, { maxWidth: rightW } as any)
      yRight += 8
      if (dateRange2) {
        doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(colAccent)
        doc.text(dateRange2, rx, yRight, { maxWidth: rightW } as any)
        yRight += 7
      }
      if (cgpaStr) {
        doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(colMuted)
        doc.text(cgpaStr, rx, yRight, { maxWidth: rightW } as any)
        yRight += 7
      }
      yRight += 3
    }
  }
  if ((data as any).certifications?.length) {
    rightSection('Certifications')
    for (const c of (data as any).certifications) {
      const degree = (c.name || 'Certification').trim() || 'Certification'
      const dl = doc.splitTextToSize(degree, rightW)
      ensureRight((dl as string[]).length *8*1.18 + 14)
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(colBlack)
      doc.text(degree, rx, yRight, { maxWidth: rightW } as any)
      yRight += (dl as string[]).length *8*1.18 +1
      if (c.issuer?.trim()) {
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colText)
        doc.text(c.issuer.trim(), rx, yRight, { maxWidth: rightW } as any); yRight += 8
      }
      if (c.date?.trim()) {
        doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(colAccent)
        doc.text(c.date.trim(), rx, yRight, { maxWidth: rightW } as any); yRight += 7
      }
      if (c.url?.trim()) {
        const url = c.url.trim()
        doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(colAccent)
        doc.textWithLink(url, rx, yRight, { url } as any)
        try{ doc.link(rx, yRight-5, Math.min(doc.getTextWidth(url), rightW), 7, { url } as any)}catch{}
        yRight += 7
      }
      yRight += 3
    }
  }

  doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor('#9ca3af')
  doc.text('Generated by CampusFlow', pageW/2, pageH - margin + 8, { align: 'center' } as any)
}

// ---------- Minimal ----------
