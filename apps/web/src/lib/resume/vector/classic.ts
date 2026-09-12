// resume/vector/classic.ts — Classic (Jake) 1-col template (SRP extract).
// WHY: 150-250 line template with nested closures was inline in the god.
// Moved verbatim; shared helpers via ./shared. Behavior identical.
import type { ResumeData } from '../../../types/resume';
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume';
import type { JsPDFInstance } from './shared';
import { createBaseHelpers, parseSkillRows, drawBulletWithBold, safeName } from './shared';

// ---------- Classic (Jake) — tight 1-col ----------
export async function renderClassic(doc: JsPDFInstance, data: ResumeData) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 39.7 // 0.55in
  const { contentW, bottomLimit, colBlack, colGray, colMuted, colPrimary, colText } = createBaseHelpers(doc, pageW, pageH, margin)
  let y = margin

  function setFont(f: 'helvetica', style: 'normal' | 'bold' | 'italic' | 'bolditalic', size: number) {
    doc.setFont(f, style as any)
    doc.setFontSize(size)
  }
  function ensureSpace(need: number) {
    if (y + need > bottomLimit) {
      doc.addPage()
      y = margin
    }
  }
  function rule() {
    doc.setDrawColor(17, 24, 39)
    doc.setLineWidth(0.6)
    doc.line(margin, y, pageW - margin, y)
    y += 5
  }
  function section(title: string) {
    ensureSpace(22)
    setFont('helvetica', 'bold', 10)
    doc.setTextColor(colBlack)
    doc.text(title.toUpperCase(), margin, y)
    y += 6
    rule()
    y += 2
  }
  function addWrapped(text: string, opts: any): number {
    const x = opts.x ?? margin
    const maxW = opts.maxW ?? contentW
    const lines = doc.splitTextToSize(text, maxW)
    const h = (lines as string[]).length
    const lineH = (opts.size || 8) * 1.18
    const need = h * lineH + 2
    ensureSpace(need)
    setFont(opts.font || 'helvetica', opts.style || 'normal', opts.size || 8)
    if (opts.color) doc.setTextColor(opts.color)
    if (opts.link) {
      doc.textWithLink(text, x, y, { maxWidth: maxW, align: opts.align || 'left', lineHeightFactor: 1.18 } as any)
      try {
        const textWidth = doc.getTextWidth(text)
        doc.link(x, y - (opts.size || 8) * 0.8, Math.min(textWidth, maxW), lineH, { url: opts.link } as any)
      } catch {}
    } else if (opts.align && opts.align !== 'left') {
      ;(doc as any).text(text, x, y, { maxWidth: maxW, align: opts.align, lineHeightFactor: 1.18 })
    } else {
      doc.text(text, x, y, { maxWidth: maxW, lineHeightFactor: 1.18 })
    }
    const usedH = (lines as string[]).length * lineH
    y += usedH + (opts.lineGap ?? 1)
    return usedH
  }

  const p = data.personalInfo
  // Heading
  setFont('helvetica', 'bold', 22)
  doc.setTextColor(colBlack)
  {
    const name = (p.fullName || 'Your Name').trim() || 'Your Name'
    const lines = doc.splitTextToSize(name, contentW)
    doc.text(name, pageW / 2, y, { align: 'center', maxWidth: contentW } as any)
    const h = (lines as string[]).length * 22 * 1.15
    y += h + 2
  }
  if (p.headline?.trim()) {
    addWrapped(p.headline.trim(), { maxW: contentW, size: 8.5, style: 'italic', color: colGray, align: 'center' as any })
    y += 1
  }
  {
    const contactParts: string[] = []
    if (p.email?.trim()) contactParts.push(p.email.trim())
    if (p.phone?.trim()) contactParts.push(p.phone.trim())
    if (p.location?.trim()) contactParts.push(p.location.trim())
    const contactLine = contactParts.join('  |  ')
    if (contactLine) {
      setFont('helvetica', 'normal', 7.2)
      doc.setTextColor(colGray)
      doc.text(contactLine, pageW / 2, y, { align: 'center', maxWidth: contentW } as any)
      if (p.email?.trim()) {
        try {
          const email = p.email.trim()
          const w = doc.getTextWidth(contactLine)
          const startX = pageW / 2 - w / 2
          const emailW = doc.getTextWidth(email)
          doc.link(startX, y - 6, emailW, 9, { url: `mailto:${email}` } as any)
        } catch {}
      }
      y += 9
    }
    const links = (p.links || []).filter(l => l.url?.trim())
    if (links.length) {
      for (const l of links) {
        const label = `${l.label}: ${l.url}`
        setFont('helvetica', 'normal', 7)
        doc.setTextColor(colPrimary)
        const w = doc.getTextWidth(label)
        const x = pageW / 2 - Math.min(w, contentW) / 2
        ensureSpace(9)
        doc.textWithLink(label, x, y, { url: l.url } as any)
        try { doc.link(x, y - 5, Math.min(w, contentW), 8, { url: l.url } as any) } catch {}
        y += 9
      }
      y += 2
    }
  }
  y += 3
  if (p.summary?.trim()) {
    section('Summary')
    addWrapped(p.summary.trim(), { size: 7.8, color: colText, lineGap: 1 })
    y += 3
  }
  if (data.skills?.length) {
    section('Skills')
    addWrapped(data.skills.join(', '), { size: 7.8, color: colText })
    y += 3
  }
  if (data.experience?.length) {
    section('Experience')
    for (const exp of data.experience) {
      const role = (exp.role || 'Role').trim() || 'Role'
      const company = (exp.company || 'Company').trim() || 'Company'
      const loc = exp.location?.trim() ? ` — ${exp.location.trim()}` : ''
      const dateRange = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' – ') || ''
      const titleLine = `${role} — ${company}${loc}`
      const titleW = contentW - 110
      const tLines = doc.splitTextToSize(titleLine, titleW)
      const tH = (tLines as string[]).length * 8.2 * 1.18
      ensureSpace(Math.max(tH, 12) + 8)
      setFont('helvetica', 'bold', 8.2)
      doc.setTextColor(colBlack)
      doc.text(titleLine, margin, y, { maxWidth: titleW } as any)
      if (dateRange) {
        setFont('helvetica', 'normal', 7)
        doc.setTextColor(colMuted)
        doc.text(dateRange, pageW - margin, y, { align: 'right' } as any)
      }
      y += Math.max(tH, 9) + 2
      const bullets = (exp.bullets || []).map(b => String(b).trim()).filter(Boolean)
      for (const b of bullets) {
        const bulletText = `•  ${b}`
        const bLines = doc.splitTextToSize(bulletText, contentW - 12)
        const bH = (bLines as string[]).length * 7.6 * 1.18
        ensureSpace(bH + 2)
        setFont('helvetica', 'normal', 7.6)
        doc.setTextColor(colText)
        doc.text(bulletText, margin + 8, y, { maxWidth: contentW - 12 } as any)
        y += bH + 1.2
      }
      y += 3
    }
  }
  if (data.projects?.length) {
    section('Projects')
    for (const proj of data.projects) {
      const title = (proj.title || 'Untitled Project').trim() || 'Untitled'
      const dateStr = (proj.date || '').trim()
      const titleW = contentW - 80
      const tLines = doc.splitTextToSize(title, titleW)
      const tH = (tLines as string[]).length * 8.2 * 1.18
      ensureSpace(Math.max(tH, 12) + 10)
      setFont('helvetica', 'bold', 8.2)
      doc.setTextColor(colBlack)
      doc.text(title, margin, y, { maxWidth: titleW } as any)
      if (dateStr) {
        setFont('helvetica', 'normal', 7)
        doc.setTextColor(colMuted)
        doc.text(dateStr, pageW - margin, y, { align: 'right' } as any)
      }
      y += Math.max(tH, 9) + 2
      if (proj.tech?.length) {
        const techLine = proj.tech.join(' · ')
        addWrapped(techLine, { size: 7, style: 'italic', color: colPrimary })
      }
      if (proj.description?.trim()) {
        addWrapped(proj.description.trim(), { size: 7.6, color: colText, lineGap: 0.6 })
      }
      if (proj.link?.trim()) {
        const url = proj.link.trim()
        setFont('helvetica', 'normal', 7)
        doc.setTextColor(colPrimary)
        const urlLines = doc.splitTextToSize(url, contentW)
        const uh = (urlLines as string[]).length * 7 * 1.18
        ensureSpace(uh + 2)
        doc.textWithLink(url, margin, y, { maxWidth: contentW, url } as any)
        try { doc.link(margin, y - 5, doc.getTextWidth(url), 8, { url } as any) } catch {}
        y += uh + 1
      }
      y += 3
    }
  }
  if (data.education?.length) {
    section('Education')
    for (const ed of data.education) {
      const degree = (ed.degree || 'Degree').trim() || 'Degree'
      const school = (ed.school || 'Institution').trim() || 'Institution'
      const loc2 = ed.location?.trim() ? `, ${ed.location.trim()}` : ''
      const dateRange2 = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' – ') || ''
      const cgpaStr = ed.cgpa?.trim() ? `CGPA: ${ed.cgpa.trim()}` : ''
      const titleLine2 = `${degree} — ${school}${loc2}`
      const tW = contentW - 110
      const tLines2 = doc.splitTextToSize(titleLine2, tW)
      const tH2 = (tLines2 as string[]).length * 8.2 * 1.18
      ensureSpace(Math.max(tH2, 12) + (cgpaStr ? 10 : 4))
      setFont('helvetica', 'bold', 8.2)
      doc.setTextColor(colBlack)
      doc.text(titleLine2, margin, y, { maxWidth: tW } as any)
      if (dateRange2) {
        setFont('helvetica', 'normal', 7)
        doc.setTextColor(colMuted)
        doc.text(dateRange2, pageW - margin, y, { align: 'right' } as any)
      }
      y += Math.max(tH2, 9) + 2
      if (cgpaStr) {
        setFont('helvetica', 'normal', 7)
        doc.setTextColor(colGray)
        doc.text(cgpaStr, margin, y, { maxWidth: contentW } as any)
        y += 7 * 1.18 + 1
      }
      y += 2
    }
  }
  if ((data as any).certifications?.length) {
    section('Certifications')
    for (const c of (data as any).certifications) {
      const name2 = (c.name || 'Certification').trim() || 'Certification'
      const issuer = c.issuer?.trim() ? ` — ${c.issuer.trim()}` : ''
      const date2 = (c.date || '').trim()
      const titleLine = `${name2}${issuer}`
      const tW = contentW - 80
      const tl = doc.splitTextToSize(titleLine, tW)
      const th = (tl as string[]).length * 8.2 * 1.18
      ensureSpace(Math.max(th, 10) + 4)
      setFont('helvetica','bold',8.2); doc.setTextColor(colBlack)
      doc.text(titleLine, margin, y, { maxWidth: tW } as any)
      if (date2) { setFont('helvetica','normal',7); doc.setTextColor(colMuted); doc.text(date2, pageW - margin, y, { align:'right'} as any) }
      y += Math.max(th, 9) + 2
      if (c.url?.trim()) {
        const url = c.url.trim()
        setFont('helvetica','normal',7); doc.setTextColor(colPrimary)
        doc.textWithLink(url, margin, y, { url } as any)
        try{ doc.link(margin, y-5, Math.min(doc.getTextWidth(url), contentW), 7, { url } as any)}catch{}
        y += 8
      }
      y += 1
    }
  }
  ensureSpace(12)
  setFont('helvetica', 'normal', 6)
  doc.setTextColor('#9ca3af')
  doc.text('Generated by CampusFlow', pageW / 2, pageH - margin + 8, { align: 'center' } as any)
}

// ---------- Modern AltaCV ----------
