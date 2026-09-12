// resume/vector/minimal.ts — Minimal template (SRP extract).
// WHY: 150-250 line template with nested closures was inline in the god.
// Moved verbatim; shared helpers via ./shared. Behavior identical.
import type { ResumeData } from '../../../types/resume';
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume';
import type { JsPDFInstance } from './shared';
import { createBaseHelpers, parseSkillRows, drawBulletWithBold, safeName } from './shared';

export async function renderMinimal(doc: JsPDFInstance, data: ResumeData) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 43 // 0.6in
  const contentW = pageW - margin*2
  const bottomLimit = pageH - margin
  const colAccent = '#374151'
  const colRule = '#D1D5DB'
  const colText = '#1f2937'
  const colMuted = '#6b7280'
  let y = margin

  function ensureSpace(need: number) {
    if (y + need > bottomLimit) { doc.addPage(); y = margin }
  }
  function section(title: string) {
    ensureSpace(18)
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(colAccent)
    doc.text(title.toUpperCase(), margin, y)
    y += 4
    doc.setDrawColor(colRule); doc.setLineWidth(0.5); doc.line(margin, y, pageW - margin, y); y += 4
  }

  const p = data.personalInfo
  doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor('#111827')
  {
    const name = (p.fullName || 'Your Name').trim() || 'Your Name'
    doc.text(name, margin, y, { maxWidth: contentW } as any)
    const lh = doc.splitTextToSize(name, contentW).length * 18 *1.15
    y += lh + 2
  }
  if (p.headline?.trim()) {
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colMuted)
    doc.text(p.headline.trim(), margin, y, { maxWidth: contentW } as any)
    y += 8
  }
  {
    const parts: string[] = []
    if (p.email?.trim()) parts.push(p.email.trim())
    if (p.phone?.trim()) parts.push(p.phone.trim())
    if (p.location?.trim()) parts.push(p.location.trim())
    const linkLabels = (p.links||[]).filter(l=>l.url?.trim()).map(l=> `${l.label}: ${l.url}`)
    if (linkLabels.length) parts.push(...linkLabels.slice(0,3))
    const contactLine = parts.join('  |  ')
    if (contactLine) {
      doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted)
      doc.text(contactLine, margin, y, { maxWidth: contentW } as any)
      try {
        if (p.email?.trim()) doc.link(margin, y-5, doc.getTextWidth(p.email.trim()), 6, { url: `mailto:${p.email.trim()}` } as any)
      } catch {}
      y += 8
    }
  }
  doc.setDrawColor(colRule); doc.setLineWidth(0.5); doc.line(margin, y, pageW - margin, y); y+=6

  if (p.summary?.trim()) {
    section('Summary')
    doc.setFont('helvetica','normal'); doc.setFontSize(7.8); doc.setTextColor(colText)
    const lines = doc.splitTextToSize(p.summary.trim(), contentW)
    doc.text(p.summary.trim(), margin, y, { maxWidth: contentW, lineHeightFactor:1.18 } as any)
    y += (lines as string[]).length *7.8*1.18 +4
  }
  if (data.skills?.length) {
    section('Skills')
    doc.setFont('helvetica','normal'); doc.setFontSize(7.8); doc.setTextColor(colText)
    const txt = data.skills.join(', ')
    const lines = doc.splitTextToSize(txt, contentW)
    doc.text(txt, margin, y, { maxWidth: contentW, lineHeightFactor:1.18 } as any)
    y += (lines as string[]).length *7.8*1.18 +4
  }
  if (data.experience?.length) {
    section('Experience')
    for (const exp of data.experience) {
      const role = (exp.role||'Role').trim()||'Role'
      const company = (exp.company||'Company').trim()||'Company'
      const loc = exp.location?.trim()? ` | ${exp.location.trim()}`:''
      const dateRange = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' – ')||''
      const titleLine = `${role} — ${company}${loc}`
      const tl = doc.splitTextToSize(titleLine, contentW - 90)
      const th = (tl as string[]).length *8*1.18
      ensureSpace(Math.max(th,10)+8)
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor('#111827')
      doc.text(titleLine, margin, y, { maxWidth: contentW -90 } as any)
      if (dateRange) {
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted)
        doc.text(dateRange, pageW - margin, y, { align:'right' } as any)
      }
      y+= Math.max(th,9)+1
      for (const b of (exp.bullets||[]).map(x=>String(x).trim()).filter(Boolean)) {
        const txt = `-- ${b}`
        const bl = doc.splitTextToSize(txt, contentW -10)
        const bh = (bl as string[]).length *7.4*1.18
        ensureSpace(bh+2)
        doc.setFont('helvetica','normal'); doc.setFontSize(7.4); doc.setTextColor(colText)
        doc.text(txt, margin+6, y, { maxWidth: contentW -10 } as any)
        y+= bh+1
      }
      y+=3
    }
  }
  if (data.projects?.length) {
    section('Projects')
    for (const proj of data.projects) {
      const title = (proj.title||'Untitled').trim()||'Untitled'
      const dateStr = (proj.date||'').trim()
      const tl = doc.splitTextToSize(title, contentW-60)
      const th = (tl as string[]).length*8*1.18
      ensureSpace(Math.max(th,10)+8)
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor('#111827')
      doc.text(title, margin, y, { maxWidth: contentW-60 } as any)
      if (dateStr) { doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted); doc.text(dateStr, pageW - margin, y, { align:'right'} as any)}
      y+= Math.max(th,9)+1
      if (proj.tech?.length) {
        const tech = proj.tech.join(', ')
        ensureSpace(7)
        doc.setFont('helvetica','italic'); doc.setFontSize(7); doc.setTextColor(colMuted)
        doc.text(tech, margin, y, { maxWidth: contentW } as any); y+=7
      }
      if (proj.description?.trim()) {
        const d = proj.description.trim()
        const dl = doc.splitTextToSize(d, contentW)
        ensureSpace((dl as string[]).length*7.4*1.18+2)
        doc.setFont('helvetica','normal'); doc.setFontSize(7.4); doc.setTextColor(colText)
        doc.text(d, margin, y, { maxWidth: contentW } as any); y+= (dl as string[]).length*7.4*1.18+1
      }
      if (proj.link?.trim()) {
        const url = proj.link.trim()
        ensureSpace(7)
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted)
        doc.textWithLink(url, margin, y, { url } as any); try{doc.link(margin, y-5, doc.getTextWidth(url),6,{url} as any)}catch{}; y+=7
      }
      y+=3
    }
  }
  if (data.education?.length) {
    section('Education')
    for (const ed of data.education) {
      const degree = (ed.degree||'Degree').trim()||'Degree'
      const school = (ed.school||'Institution').trim()||'Institution'
      const loc2 = ed.location?.trim()? `, ${ed.location.trim()}`:''
      const dateRange2 = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' – ')||''
      const titleLine = `${degree} — ${school}${loc2}`
      const tl = doc.splitTextToSize(titleLine, contentW-90)
      const th = (tl as string[]).length *8*1.18
      ensureSpace(Math.max(th,10)+10)
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor('#111827')
      doc.text(titleLine, margin, y, { maxWidth: contentW-90 } as any)
      if (dateRange2) { doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted); doc.text(dateRange2, pageW - margin, y, { align:'right'} as any)}
      y+= Math.max(th,9)+1
      if (ed.cgpa?.trim()) {
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted)
        doc.text(`CGPA: ${ed.cgpa.trim()}`, margin, y, { maxWidth: contentW } as any); y+=7
      }
      y+=2
    }
  }
  if ((data as any).certifications?.length) {
    section('Certifications')
    for (const c of (data as any).certifications) {
      const titleLine = `${(c.name||'Certification').trim()}${c.issuer?.trim()? ` — ${c.issuer.trim()}`: ''}`
      const tl = doc.splitTextToSize(titleLine, contentW-90)
      const th = (tl as string[]).length *8*1.18
      ensureSpace(Math.max(th,10)+8)
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor('#111827')
      doc.text(titleLine, margin, y, { maxWidth: contentW-90 } as any)
      if (c.date?.trim()) { doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted); doc.text(c.date.trim(), pageW - margin, y, { align:'right'} as any)}
      y+= Math.max(th,9)+1
      if (c.url?.trim()) {
        const url=c.url.trim()
        doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(colMuted)
        doc.textWithLink(url, margin, y, { url } as any); try{doc.link(margin,y-5,Math.min(doc.getTextWidth(url),contentW),7,{url} as any)}catch{}; y+=7
      }
      y+=2
    }
  }
  ensureSpace(10)
  doc.setFont('helvetica','normal'); doc.setFontSize(5.8); doc.setTextColor('#9ca3af')
  doc.text('Generated by CampusFlow', pageW/2, pageH - margin +4, { align:'center'} as any)
}

// ---------- Source Sans Split — exact PDF replica (monochrome, 0.5in, 10pt body/12pt h2/24.8pt name) ----------
