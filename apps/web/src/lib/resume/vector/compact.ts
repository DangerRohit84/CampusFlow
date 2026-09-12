// resume/vector/compact.ts — Compact template (SRP extract).
// WHY: 150-250 line template with nested closures was inline in the god.
// Moved verbatim; shared helpers via ./shared. Behavior identical.
import type { ResumeData } from '../../../types/resume';
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume';
import type { JsPDFInstance } from './shared';
import { createBaseHelpers, parseSkillRows, drawBulletWithBold, safeName } from './shared';

export async function renderCompact(doc: JsPDFInstance, data: ResumeData) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 36 // 0.5in
  const contentW = pageW - margin * 2
  const bottomLimit = pageH - margin
  const colBlack = '#000000'
  let y = margin
  function ensureSpace(need: number){ if (y + need > bottomLimit){ doc.addPage(); y = margin } }
  function hairline(){ doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(margin, y, pageW - margin, y); y+=4 }
  function sectionHead(title: string){
    ensureSpace(16)
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(colBlack)
    // tracking approximation
    doc.text(title.toUpperCase(), margin, y); y+=4
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(margin, y, pageW - margin, y); y+=5
  }
  const p = data.personalInfo
  // Centered name 20pt uppercase
  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(colBlack)
  const name = (p.fullName || 'Your Name').trim() || 'Your Name'
  const nameU = name.toUpperCase()
  const nl = doc.splitTextToSize(nameU, contentW)
  doc.text(nameU, pageW/2, y, { align:'center', maxWidth: contentW } as any)
  y += (nl as string[]).length * 20 * 1.1 + 2
  // headline 8.5pt tracking widest uppercase
  const headline = (p.headline?.trim() || 'STUDENT · DEVELOPER').toUpperCase()
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
  try { doc.text(headline, pageW/2, y, { align:'center', maxWidth: contentW, charSpace: 1.1 } as any) } catch { doc.text(headline, pageW/2, y, { align:'center', maxWidth: contentW } as any) }
  y += 9
  // contact centered pipes
  const contactParts: string[] = []
  if (p.email?.trim()) contactParts.push(p.email.trim())
  if (p.phone?.trim()) contactParts.push(p.phone.trim())
  if (p.location?.trim()) contactParts.push(p.location.trim())
  for (const l of (p.links||[]).filter(x=>x.url?.trim())) contactParts.push(l.label)
  const contactLine = contactParts.join(' | ')
  if (contactLine) {
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack)
    doc.text(contactLine, pageW/2, y, { align:'center', maxWidth: contentW } as any)
    // links: annotate each label
    try {
      const w = doc.getTextWidth(contactLine)
      const startX = pageW/2 - w/2
      // email
      if (p.email?.trim()) {
        const email = p.email.trim()
        const idx = contactLine.indexOf(email)
        if (idx>=0) {
          const prefixW = doc.getTextWidth(contactLine.slice(0, idx))
          doc.link(startX + prefixW, y-6, doc.getTextWidth(email), 7, { url: `mailto:${email}` } as any)
        }
      }
      for (const l of (p.links||[]).filter(x=>x.url?.trim())) {
        const idx = contactLine.indexOf(l.label)
        if (idx>=0) {
          const prefixW = doc.getTextWidth(contactLine.slice(0, idx))
          doc.link(startX + prefixW, y-6, doc.getTextWidth(l.label), 7, { url: l.url } as any)
        }
      }
    } catch {}
    y += 9
  }
  hairline()
  if (p.summary?.trim()) {
    sectionHead('Summary')
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(colBlack)
    const sl = doc.splitTextToSize(p.summary.trim(), contentW)
    doc.text(p.summary.trim(), margin, y, { maxWidth: contentW, lineHeightFactor: 1.4 } as any)
    y += (sl as string[]).length * 9 * 1.4 + 4
  }
  const skillRows = parseSkillRows(data.skills)
  if (skillRows.length) {
    sectionHead('Skills')
    if (skillRows.length === 1 && skillRows[0].label === 'Skills') {
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(colBlack)
      const sl = doc.splitTextToSize(skillRows[0].value, contentW)
      doc.text(skillRows[0].value, margin, y, { maxWidth: contentW, lineHeightFactor: 1.4 } as any)
      y += (sl as string[]).length * 9 * 1.4 + 4
    } else {
      const labelW = 92
      const gap = 6
      const valueW = contentW - labelW - gap
      for (const row of skillRows) {
        const label = `${row.label}:`
        const vLines = doc.splitTextToSize(row.value, valueW)
        const vH = (vLines as string[]).length * 9 * 1.35
        ensureSpace(vH + 2)
        doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(colBlack)
        doc.text(label, margin, y, { maxWidth: labelW } as any)
        doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(colBlack)
        doc.text(row.value, margin + labelW + gap, y, { maxWidth: valueW, lineHeightFactor: 1.35 } as any)
        y += vH + 2
      }
    }
  }
  if (data.experience?.length) {
    sectionHead('Experience')
    for (const exp of data.experience) {
      const role = (exp.role||'Role').trim()||'Role'
      const company = (exp.company||'Company').trim()||'Company'
      const loc = exp.location?.trim()? ` · ${exp.location.trim()}`:''
      const dateRange = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' – ')||''
      const titleLine = `${role} — ${company}${loc}`
      const tl = doc.splitTextToSize(titleLine, contentW - 80)
      const th = (tl as string[]).length * 9.5 * 1.2
      ensureSpace(th + 10)
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      doc.text(titleLine, margin, y, { maxWidth: contentW - 80 } as any)
      if (dateRange) { doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack); doc.text(dateRange, pageW - margin, y, { align:'right'} as any) }
      y += Math.max(th, 9.5*1.2)+1
      for (const b of (exp.bullets||[]).map(x=>String(x).trim()).filter(Boolean)) {
        const tmpLines = doc.splitTextToSize(`•  ${b}`, contentW - 10)
        const bh = (tmpLines as string[]).length * 9 * 1.35
        ensureSpace(bh + 2)
        drawBulletWithBold(doc, b, margin + 6, y, contentW - 10, 9, colBlack)
        y += bh + 0.8
      }
      y += 2
    }
  }
  if (data.projects?.length) {
    sectionHead('Projects')
    for (const proj of data.projects) {
      const title = (proj.title||'Untitled').trim()||'Untitled'
      const dateStr = (proj.date||'').trim()
      const tl = doc.splitTextToSize(title, contentW - 60)
      const th = (tl as string[]).length * 9.5 * 1.2
      ensureSpace(th + 8)
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      doc.text(title, margin, y, { maxWidth: contentW -60 } as any)
      if (dateStr) { doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack); doc.text(dateStr, pageW - margin, y, { align:'right'} as any) }
      y += Math.max(th, 9.5*1.2)+1
      if (proj.tech?.length) {
        const tech = proj.tech.join(' · ')
        doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(colBlack)
        doc.text(tech, margin, y, { maxWidth: contentW } as any); y+=8
      }
      if (proj.description?.trim()) {
        const d = proj.description.trim()
        const dl = doc.splitTextToSize(d, contentW)
        ensureSpace((dl as string[]).length * 9 *1.35+2)
        doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(colBlack)
        doc.text(d, margin, y, { maxWidth: contentW, lineHeightFactor:1.35 } as any); y+= (dl as string[]).length *9*1.35+1
      }
      if (proj.link?.trim()) {
        const url = proj.link.trim()
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack)
        doc.textWithLink(url, margin, y, { url } as any); try{doc.link(margin,y-5,Math.min(doc.getTextWidth(url),contentW),7,{url} as any)}catch{}; y+=8
      }
      y+=3
    }
  }
  if (data.education?.length) {
    sectionHead('Education')
    for (const ed of data.education) {
      const degree = (ed.degree||'Degree').trim()||'Degree'
      const school = (ed.school||'Institution').trim()||'Institution'
      const loc2 = ed.location?.trim()? `, ${ed.location.trim()}`:''
      const dateRange2 = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' – ')||''
      const titleLine = `${degree} — ${school}${loc2}`
      const tl = doc.splitTextToSize(titleLine, contentW - 80)
      const th = (tl as string[]).length * 9.5 *1.2
      ensureSpace(th+8)
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      doc.text(titleLine, margin, y, { maxWidth: contentW -80 } as any)
      if (dateRange2) { doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack); doc.text(dateRange2, pageW - margin, y, { align:'right'} as any) }
      y+= Math.max(th,9.5*1.2)+1
      if (ed.cgpa?.trim()) { doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack); doc.text(`CGPA: ${ed.cgpa.trim()}`, margin, y, { maxWidth: contentW } as any); y+=8 }
      y+=1
    }
  }
  if ((data as any).certifications?.length) {
    sectionHead('Certifications')
    for (const c of (data as any).certifications) {
      const name2 = (c.name||'Certification').trim()||'Certification'
      const issuer = c.issuer?.trim()? ` — ${c.issuer.trim()}`:''
      const date2 = (c.date||'').trim()
      const titleLine = `${name2}${issuer}`
      const tl = doc.splitTextToSize(titleLine, contentW -80)
      const th = (tl as string[]).length *9.5*1.2
      ensureSpace(th+6)
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      doc.text(titleLine, margin, y, { maxWidth: contentW -80 } as any)
      if(date2){ doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack); doc.text(date2, pageW - margin, y, { align:'right'} as any)}
      y+= Math.max(th,9.5*1.2)+1
      if(c.url?.trim()){
        const url=c.url.trim()
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(colBlack)
        doc.textWithLink(url, margin, y, { url } as any); try{doc.link(margin,y-5,Math.min(doc.getTextWidth(url),contentW),7,{url} as any)}catch{}; y+=8
      }
      y+=1
    }
  }
  doc.setFont('helvetica','normal'); doc.setFontSize(5.8); doc.setTextColor('#000000')
  doc.text('Generated by CampusFlow', pageW/2, pageH - margin +4, { align:'center'} as any)
}

// ---------- Custom — fully editable (accent/font/density/order/hide) ----------
