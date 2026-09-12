// resume/vector/sourceSplit.ts — Source-split template (SRP extract).
// WHY: 150-250 line template with nested closures was inline in the god.
// Moved verbatim; shared helpers via ./shared. Behavior identical.
import type { ResumeData } from '../../../types/resume';
import { DEFAULT_CUSTOM_CONFIG } from '../../../types/resume';
import type { JsPDFInstance } from './shared';
import { createBaseHelpers, parseSkillRows, drawBulletWithBold, safeName } from './shared';

export async function renderSourceSplit(doc: JsPDFInstance, data: ResumeData) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 36 // 0.5in
  const contentW = pageW - margin * 2
  const bottomLimit = pageH - margin
  const colBlack = '#000000'
  const colText = '#000000'
  const colMuted = '#000000'
  let y = margin

  function ensureSpace(need: number) { if (y + need > bottomLimit) { doc.addPage(); y = margin } }
  function hairline() {
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(margin, y, pageW - margin, y); y += 4
  }
  function sectionHead(title: string) {
    ensureSpace(18)
    doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(colBlack)
    doc.text(title.toUpperCase(), margin, y)
    y += 4
    doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(margin, y, pageW - margin, y); y += 6
  }

  const p = data.personalInfo
  // Name left 24.8pt bold
  doc.setFont('helvetica','bold'); doc.setFontSize(24.8); doc.setTextColor(colBlack)
  const name = (p.fullName || 'Jane Doe').trim() || 'Jane Doe'
  const nameLines = doc.splitTextToSize(name, contentW - 110)
  doc.text(name, margin, y, { maxWidth: contentW - 110 } as any)
  // Location right aligned on same baseline
  if (p.location?.trim()) {
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
    doc.text(p.location.trim(), pageW - margin, y, { align: 'right' } as any)
  }
  y += Math.max((nameLines as string[]).length * 24.8 * 1.05, 12) + 2

  // Second row: links left | email/phone right
  const links = (p.links || []).filter(l=>l.url?.trim())
  const linkLine = links.map(l=> l.label).join(' | ')
  const contactRight = [p.email?.trim(), p.phone?.trim()].filter(Boolean).join(' | ')
  if (linkLine || contactRight) {
    // left links
    if (linkLine) {
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
      const leftW = contentW * 0.58
      const ll = doc.splitTextToSize(linkLine, leftW)
      doc.text(linkLine, margin, y, { maxWidth: leftW } as any)
      // underline + links
      try {
        let curX = margin
        for (let i=0;i<links.length;i++) {
          const seg = links[i].label
          const segW = doc.getTextWidth(seg)
          const underlineY = y + 1
          doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(curX, underlineY, curX + segW, underlineY)
          doc.link(curX, y - 7, segW, 8, { url: links[i].url } as any)
          curX += segW
          if (i < links.length -1) {
            const sep = ' | '
            curX += doc.getTextWidth(sep)
          }
        }
      } catch {}
      // right side on same y but right aligned — need to handle overlap if long
      if (contactRight) {
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
        doc.text(contactRight, pageW - margin, y, { align: 'right', maxWidth: contentW * 0.38 } as any)
        // link for email
        if (p.email?.trim()) {
          try {
            const email = p.email.trim()
            const w = doc.getTextWidth(contactRight)
            const startX = pageW - margin - w
            const idx = contactRight.indexOf(email)
            if (idx >=0) {
              const prefixW = doc.getTextWidth(contactRight.slice(0, idx))
              const emailW = doc.getTextWidth(email)
              const underlineY = y + 1
              doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(startX + prefixW, underlineY, startX + prefixW + emailW, underlineY)
              doc.link(startX + prefixW, y -7, emailW, 8, { url: `mailto:${email}` } as any)
            }
          } catch {}
        }
      }
      // Compute advance: whichever taller
      const leftH = (ll as string[]).length * 8.5 * 1.18
      y += Math.max(leftH, 8.5*1.18) + 1
    } else if (contactRight) {
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
      doc.text(contactRight, pageW - margin, y, { align: 'right', maxWidth: contentW } as any)
      y += 10
    }
  }

  hairline()
  // Headline uppercase tracked
  const headline = (p.headline?.trim() || 'FULL STACK DEVELOPER').toUpperCase()
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(colBlack)
  // letter spacing approximation via characterSpacing option if available
  try { doc.text(headline, margin, y, { charSpace: 0.6 } as any) } catch { doc.text(headline, margin, y) }
  y += 10

  if (p.summary?.trim()) {
    sectionHead('Summary')
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(colText)
    const sLines = doc.splitTextToSize(p.summary.trim(), contentW)
    doc.text(p.summary.trim(), margin, y, { maxWidth: contentW, lineHeightFactor: 1.45 } as any)
    y += (sLines as string[]).length * 10 * 1.45 + 4
  }

  const skillRows = parseSkillRows(data.skills)
  if (skillRows.length) {
    sectionHead('Technical Skills')
    const labelW = 102 // 138px at 96dpi approx 100pt
    const gap = 6
    const valueW = contentW - labelW - gap
    for (const row of skillRows) {
      const label = `${row.label}:`
      const value = row.value
      const vLines = doc.splitTextToSize(value, valueW)
      const vH = (vLines as string[]).length * 9.5 * 1.45
      const need = Math.max(vH, 9.5*1.45)
      ensureSpace(need + 2)
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      doc.text(label, margin, y, { maxWidth: labelW } as any)
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(colText)
      doc.text(value, margin + labelW + gap, y, { maxWidth: valueW, lineHeightFactor: 1.45 } as any)
      y += vH + 2
    }
  }

  if (data.experience?.length) {
    sectionHead('Experience')
    for (const exp of data.experience) {
      const role = (exp.role || 'Role').trim() || 'Role'
      const dateRange = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' – ') || ''
      const roleLines = doc.splitTextToSize(role, contentW - 110)
      const roleH = (roleLines as string[]).length * 10 * 1.18
      ensureSpace(roleH + 18)
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(colBlack)
      doc.text(role, margin, y, { maxWidth: contentW - 110 } as any)
      if (dateRange) {
        doc.setFont('helvetica','italic'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
        doc.text(dateRange, pageW - margin, y, { align: 'right' } as any)
      }
      y += Math.max(roleH, 10*1.18) + 1
      // second line company vs location
      const company = (exp.company || 'Company').trim() || 'Company'
      const loc = (exp.location || '').trim()
      doc.setFont('helvetica','italic'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      const companyLines = doc.splitTextToSize(company, contentW - 110)
      doc.text(company, margin, y, { maxWidth: contentW - 110 } as any)
      if (loc) doc.text(loc, pageW - margin, y, { align: 'right' } as any)
      y += Math.max((companyLines as string[]).length * 9.5 * 1.18, 9.5*1.18) + 2
      // bullets — ensure space before drawing, then draw with keyword bold
      const bullets = (exp.bullets||[]).map(b=>String(b).trim()).filter(Boolean)
      for (const b of bullets) {
        const tmpLines = doc.splitTextToSize(`•  ${b}`, contentW - 12)
        const bh = (tmpLines as string[]).length * 9.5 * 1.18
        ensureSpace(bh + 2)
        drawBulletWithBold(doc, b, margin + 8, y, contentW - 12, 9.5, colText)
        y += bh + 1.2
      }
      y += 2
    }
  }

  if (data.projects?.length) {
    sectionHead('Projects')
    for (const proj of data.projects) {
      const title = (proj.title || 'Untitled Project').trim() || 'Untitled'
      const tech = (proj.tech||[]).join(' · ')
      const linkUrl = proj.link?.trim() || ''
      const titleW = 140
      const techW = contentW - titleW - 80
      const titleLines = doc.splitTextToSize(title, titleW)
      const th = (titleLines as string[]).length * 10 * 1.18
      ensureSpace(Math.max(th, 10) + 12)
      const rowY = y
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(colBlack)
      doc.text(title, margin, rowY, { maxWidth: titleW } as any)
      if (tech) {
        doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
        const techLines = doc.splitTextToSize(tech, techW)
        doc.text(tech, margin + titleW + 6, rowY, { maxWidth: techW, align: 'center' } as any)
      }
      if (linkUrl) {
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
        const src = 'Source Code'
        const srcW = doc.getTextWidth(src)
        const srcX = pageW - margin - srcW
        doc.text(src, srcX, rowY)
        const ulY = rowY + 1
        doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(srcX, ulY, srcX + srcW, ulY)
        try { doc.link(srcX, rowY -7, srcW, 8, { url: linkUrl } as any) } catch {}
      } else if (proj.date?.trim()) {
        doc.setFont('helvetica','italic'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
        doc.text(proj.date.trim(), pageW - margin, rowY, { align:'right'} as any)
      }
      y += Math.max(th, 10*1.18) + 2
      if (proj.description?.trim()) {
        doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(colText)
        const d = proj.description.trim()
        const dl = doc.splitTextToSize(d, contentW)
        ensureSpace((dl as string[]).length * 9.5 * 1.45 + 2)
        doc.text(d, margin, y, { maxWidth: contentW, lineHeightFactor: 1.45 } as any)
        y += (dl as string[]).length * 9.5 * 1.45 + 2
      }
      y += 2
    }
  }

  if (data.education?.length) {
    sectionHead('Education')
    for (const ed of data.education) {
      const degree = (ed.degree || 'Degree').trim() || 'Degree'
      const dateRange = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' – ') || ''
      const degLines = doc.splitTextToSize(degree, contentW - 110)
      const degH = (degLines as string[]).length * 10 * 1.18
      ensureSpace(degH + 12)
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(colBlack)
      doc.text(degree, margin, y, { maxWidth: contentW - 110 } as any)
      if (dateRange) {
        doc.setFont('helvetica','italic'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
        doc.text(dateRange, pageW - margin, y, { align:'right'} as any)
      }
      y += Math.max(degH, 10*1.18)+1
      const schoolLine = `${(ed.school||'Institution').trim()}${ed.location?.trim()? ` — ${ed.location.trim()}`:''}${ed.cgpa?.trim()? ` · CGPA: ${ed.cgpa.trim()}`:''}`
      doc.setFont('helvetica','italic'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
      const sl = doc.splitTextToSize(schoolLine, contentW)
      doc.text(schoolLine, margin, y, { maxWidth: contentW, lineHeightFactor: 1.2 } as any)
      y += (sl as string[]).length * 9.5 *1.2 + 4
    }
  }

  if ((data as any).certifications?.length) {
    sectionHead('Certifications')
    for (const c of (data as any).certifications) {
      const name2 = (c.name || 'Certification').trim() || 'Certification'
      const issuer = c.issuer?.trim() ? ` — ${c.issuer.trim()}` : ''
      const date2 = (c.date||'').trim()
      const titleLine = `${name2}${issuer}`
      const tl = doc.splitTextToSize(titleLine, contentW - 90)
      const th = (tl as string[]).length * 10 * 1.18
      ensureSpace(th + 6)
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(colBlack)
      doc.text(titleLine, margin, y, { maxWidth: contentW - 90 } as any)
      if (date2) {
        doc.setFont('helvetica','italic'); doc.setFontSize(9.5); doc.setTextColor(colBlack)
        doc.text(date2, pageW - margin, y, { align:'right'} as any)
      }
      y += Math.max(th, 10*1.18)+1
      if (c.url?.trim()) {
        const url = c.url.trim()
        doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(colBlack)
        doc.textWithLink('Verify', margin, y, { url } as any)
        try {
          const vW = doc.getTextWidth('Verify')
          doc.setDrawColor(0,0,0); doc.setLineWidth(0.4); doc.line(margin, y+1, margin+vW, y+1)
          doc.link(margin, y-7, vW, 8, { url } as any)
        } catch {}
        y += 8
      }
      y += 1
    }
  }

  doc.setFont('helvetica','normal'); doc.setFontSize(6); doc.setTextColor('#000000')
  doc.text('Generated by CampusFlow', pageW/2, pageH - margin + 6, { align:'center'} as any)
}

// ---------- Compact ATS — dense single-col ----------
