/**
 * CampusFlow Resume PDF — vector generation helpers (Overleaf-mimic 5 templates)
 * SECURITY (C-4): pure-pdfkit only — no shell, no eval, no external compile.
 *  - REMOVED: pdflatex spawn on user-controlled latex (RCE via \write18 / \input
 *    even with -interaction=nonstopmode; infinite-loop TeX DoS; predictable tmp).
 *  - REMOVED: latexonline.cc HTTP compile (PII exfil of resume to third party).
 *  - REMOVED: dynamic-code eval for pdfkit loading (CSP unsafe-eval class).
 *    Use static import instead — see loadPdfKit below.
 * Strategy now:
 *  - ALWAYS generate via pdfkit vector PDFs — five distinct layouts:
 *     source-split (Source Sans exact PDF replica, monochrome 0.5in 0.4pt), compact (dense ATS), classic (Jake 1-col), modern (AltaCV 2-col), minimal (ATS clean)
 *  - compileLatexToPdfBuffer / compileViaLatexOnline kept as safe stubs (return null)
 *    for backwards compat with routes/resume.ts callers; they never spawn or fetch.
 *  - For pixel-perfect LaTeX, client downloads .tex (?format=tex) and compiles in
 *    Overleaf (user-controlled sandbox, not server-side RCE).
 */

function parseSkillRows(skills: string[]): { label: string; value: string }[] {
  if (!skills || skills.length === 0) return []
  const hasColon = skills.some(s => String(s).includes(':'))
  if (!hasColon) return [{ label: 'Skills', value: skills.map(s=>String(s).trim()).filter(Boolean).join(', ') }]
  const rows: { label: string; value: string }[] = []
  for (const raw of skills) {
    const s = String(raw).trim()
    if (!s) continue
    const idx = s.indexOf(':')
    if (idx > 0) rows.push({ label: s.slice(0, idx).trim(), value: s.slice(idx+1).trim() })
    else if (rows.length) rows[rows.length-1].value += `, ${s}`
    else rows.push({ label: 'Other', value: s })
  }
  return rows.filter(r=>r.value)
}
function formatBullet(b: string): string { return String(b).trim() }
import type { ResumeDataForLatex } from './resumeLatex'

// C-4 stubs: never spawn, never fetch. Kept for caller compat (resume.ts tries
// local → online → vector; stubs return null so vector path always wins).
export async function compileLatexToPdfBuffer(_latex: string): Promise<Buffer | null> {
  return null
}

export async function compileViaLatexOnline(_latex: string): Promise<Buffer | null> {
  return null
}

// ---------- pdfkit loader (static import — no Function/eval) ----------
let pdfKitCtor: any | null = null
async function loadPdfKit(): Promise<any | null> {
  if (pdfKitCtor) return pdfKitCtor
  try {
    const mod: any = await import('pdfkit')
    pdfKitCtor = mod?.default || mod
    return pdfKitCtor
  } catch { return null }
}

// ---------- Classic vector (Jake 1-col) ----------
async function generateClassicVectorBuffer(data: ResumeDataForLatex): Promise<Buffer> {
  const PDFDocument = await loadPdfKit()
  if (!PDFDocument) throw new Error('pdfkit not available')
  return new Promise<Buffer>((resolve, reject) => {
    const doc: any = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const margin = 39.7
    const pageW = 595.28
    const pageH = 841.89
    const contentW = pageW - margin * 2
    const usableTop = margin
    const bottomLimit = pageH - margin
    const colBlack = '#111827'
    const colGray = '#6b7280'
    const colMuted = '#9ca3af'
    const colPrimary = '#1d4ed8'
    const colText = '#1f2937'
    let y = usableTop
    function ensureSpace(need: number) { if (y + need > bottomLimit) { doc.addPage(); y = usableTop } }
    function rule() {
      doc.save(); doc.strokeColor('#111827').lineWidth(0.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y += 3
    }
    function section(title: string) {
      ensureSpace(22); if (y > usableTop + 2) y += 2
      doc.font('Helvetica-Bold').fontSize(10).fillColor(colBlack)
      doc.text(title.toUpperCase(), margin, y, { width: contentW, characterSpacing: 0.35 })
      y = doc.y + 2; rule(); y += 3
    }
    const p: any = data.personalInfo || {}
    const fullName = String(p.fullName || 'Your Name').trim() || 'Your Name'
    doc.font('Helvetica-Bold').fontSize(22).fillColor(colBlack)
    doc.text(fullName, margin, y, { width: contentW, align: 'center' }); y = doc.y + 3
    if (p.headline?.trim()) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(colGray)
      doc.text(String(p.headline).trim(), margin, y, { width: contentW, align: 'center' }); y = doc.y + 3
    }
    const contactParts: string[] = []
    if (p.email?.trim()) contactParts.push(String(p.email).trim())
    if (p.phone?.trim()) contactParts.push(String(p.phone).trim())
    if (p.location?.trim()) contactParts.push(String(p.location).trim())
    const links = (p.links || []).filter((l: any) => l.url?.trim())
    const contactLine = contactParts.join('  |  ')
    if (contactLine) {
      doc.font('Helvetica').fontSize(7.5).fillColor(colGray)
      const contactY = y
      doc.text(contactLine, margin, y, { width: contentW, align: 'center' }); y = doc.y + 2
      try {
        if (p.email?.trim() && contactLine.includes(String(p.email).trim())) {
          const emailStr = String(p.email).trim()
          const w = doc.widthOfString(contactLine)
          const lineW = Math.min(w, contentW)
          const startX = margin + (contentW - lineW) / 2 + doc.widthOfString(contactLine.slice(0, contactLine.indexOf(emailStr)))
          doc.link(startX, contactY - 1, doc.widthOfString(emailStr), 8, `mailto:${emailStr}`)
        }
      } catch {}
    }
    if (links.length) {
      const linkLabels = links.map((l: any) => `${l.label}: ${l.url}`)
      const linkLine = linkLabels.join('  |  ')
      try {
        const testW = doc.widthOfString(linkLine)
        if (testW <= contentW - 4) {
          const linkY = y
          doc.font('Helvetica').fontSize(7).fillColor(colPrimary)
          doc.text(linkLine, margin, y, { width: contentW, align: 'center' })
          const afterY = doc.y
          let cursor = 0
          for (const l of links) {
            const seg = `${l.label}: ${l.url}`
            const idx = linkLine.indexOf(seg, cursor)
            if (idx >= 0) {
              const prefixW = doc.widthOfString(linkLine.slice(0, idx))
              const segW = doc.widthOfString(seg)
              const baseX = margin + (contentW - testW) / 2 + prefixW
              doc.link(baseX, linkY - 1, segW, 9, String(l.url))
              cursor = idx + seg.length
            }
          }
          y = afterY + 2
        } else {
          for (const l of links) {
            const label = `${l.label}: ${l.url}`
            ensureSpace(9)
            const w = doc.widthOfString(label)
            const x = pageW / 2 - Math.min(w, contentW) / 2
            const ly = y
            doc.font('Helvetica').fontSize(7).fillColor(colPrimary)
            doc.text(label, x, y, { width: Math.min(w, contentW), align: 'left' } as any)
            const ny = doc.y
            try { doc.link(x, ly - 1, Math.min(w, contentW), 8, String(l.url)) } catch {}
            y = ny + 1
          }
          y += 1
        }
      } catch {
        doc.font('Helvetica').fontSize(7).fillColor(colPrimary)
        doc.text(linkLine, margin, y, { width: contentW, align: 'center' }); y = doc.y + 2
      }
    } else if (contactLine) y += 1; else y += 2
    y += 2
    if (p.summary?.trim()) {
      section('Summary')
      doc.font('Helvetica').fontSize(7.9).fillColor(colText)
      doc.text(String(p.summary).trim(), margin, y, { width: contentW, align: 'left', lineGap: 1.1 }); y = doc.y + 4
    }
    if (data.skills && data.skills.length > 0) {
      section('Skills')
      const skillsLine = data.skills.join(', ')
      doc.font('Helvetica').fontSize(7.9).fillColor(colText)
      doc.text(skillsLine, margin, y, { width: contentW, lineGap: 1.1 }); y = doc.y + 4
    }
    if (data.experience && data.experience.length > 0) {
      section('Experience')
      for (const exp of data.experience) {
        const role = String(exp.role || 'Role').trim() || 'Role'
        const company = String(exp.company || 'Company').trim() || 'Company'
        const loc = exp.location?.trim() ? ` — ${String(exp.location).trim()}` : ''
        const start = String(exp.startDate || '').trim()
        const end = String(exp.endDate || '').trim()
        const dateRange = [start, end].filter(Boolean).join(' – ') || ''
        const titleLeft = `${role} — ${company}${loc}`
        const titleLeftW = contentW - 110
        const leftLines = doc.widthOfString(titleLeft) > titleLeftW ? 2 : 1
        const titleH = leftLines * 9
        ensureSpace(titleH + 6 + (Array.isArray(exp.bullets) && exp.bullets.length ? 10 : 0))
        const titleY = y
        doc.font('Helvetica-Bold').fontSize(8.4).fillColor(colBlack)
        doc.text(titleLeft, margin, y, { width: titleLeftW })
        const afterLeftY = doc.y
        if (dateRange) {
          doc.font('Helvetica').fontSize(7).fillColor(colMuted)
          doc.text(dateRange, margin, titleY, { width: contentW, align: 'right' })
        }
        y = Math.max(afterLeftY, titleY + 9) + 1
        const bullets = (exp.bullets || []).map((b: string) => String(b).trim()).filter(Boolean)
        for (const b of bullets) {
          const bullet = '•  ' + b
          const bh = doc.heightOfString(bullet, { width: contentW - 12, lineGap: 0.9 } as any)
          ensureSpace(bh + 1)
          doc.font('Helvetica').fontSize(7.7).fillColor(colText)
          doc.text(bullet, margin + 8, y, { width: contentW - 12, lineGap: 0.9 }); y += bh + 0.6
        }
        y += 2
      }
    }
    if (data.projects && data.projects.length > 0) {
      section('Projects')
      for (const proj of data.projects) {
        const title = String(proj.title || 'Untitled Project').trim() || 'Untitled'
        const dateStr = String(proj.date || '').trim()
        const titleW = contentW - 80
        const tLines = doc.widthOfString(title) > titleW ? 2 : 1
        const tH = tLines * 9
        ensureSpace(tH + 8)
        const projTitleY = y
        doc.font('Helvetica-Bold').fontSize(8.4).fillColor(colBlack)
        doc.text(title, margin, y, { width: titleW })
        const afterTitleY = doc.y
        if (dateStr) { doc.font('Helvetica').fontSize(7).fillColor(colMuted); doc.text(dateStr, margin, projTitleY, { width: contentW, align: 'right' }) }
        y = Math.max(afterTitleY, projTitleY + 9) + 1
        if (proj.tech && proj.tech.length > 0) {
          const techLine = proj.tech.join(' · ')
          ensureSpace(8)
          doc.font('Helvetica-Oblique').fontSize(7).fillColor(colPrimary)
          doc.text(techLine, margin, y, { width: contentW, lineGap: 0.9 }); y = doc.y + 1
        }
        if (proj.description?.trim()) {
          const desc = String(proj.description).trim()
          const dh = doc.heightOfString(desc, { width: contentW, lineGap: 0.9 } as any)
          ensureSpace(dh + 2)
          doc.font('Helvetica').fontSize(7.7).fillColor(colText)
          doc.text(desc, margin, y, { width: contentW, lineGap: 0.9 }); y = doc.y + 1
        }
        if (proj.link?.trim()) {
          const url = String(proj.link).trim()
          ensureSpace(9)
          doc.font('Helvetica').fontSize(7).fillColor(colPrimary)
          const linkY = y
          doc.text(url, margin, y, { width: contentW, link: url, underline: true } as any)
          const ny = doc.y
          try { doc.link(margin, linkY - 1, Math.min(doc.widthOfString(url), contentW), 8, url) } catch {}
          y = ny + 1
        }
        y += 2
      }
    }
    if (data.education && data.education.length > 0) {
      section('Education')
      for (const ed of data.education) {
        const degree = String(ed.degree || 'Degree').trim() || 'Degree'
        const school = String(ed.school || 'Institution').trim() || 'Institution'
        const loc2 = ed.location?.trim() ? `, ${String(ed.location).trim()}` : ''
        const start2 = String(ed.startDate || '').trim()
        const end2 = String(ed.endDate || '').trim()
        const dateRange2 = [start2, end2].filter(Boolean).join(' – ') || ''
        const cgpaStr = ed.cgpa?.trim() ? `CGPA: ${String(ed.cgpa).trim()}` : ''
        const titleLine2 = `${degree} — ${school}${loc2}`
        const tW = contentW - 110
        const tLines2 = doc.widthOfString(titleLine2) > tW ? 2 : 1
        const h2 = tLines2 * 9
        ensureSpace(h2 + (cgpaStr ? 10 : 4))
        const eduY = y
        doc.font('Helvetica-Bold').fontSize(8.4).fillColor(colBlack)
        doc.text(titleLine2, margin, y, { width: tW })
        const afterEduY = doc.y
        if (dateRange2) { doc.font('Helvetica').fontSize(7).fillColor(colMuted); doc.text(dateRange2, margin, eduY, { width: contentW, align: 'right' }) }
        y = Math.max(afterEduY, eduY + 9) + 1
        if (cgpaStr) { doc.font('Helvetica').fontSize(7).fillColor(colGray); doc.text(cgpaStr, margin, y, { width: contentW, lineGap: 0.9 }); y = doc.y + 1 }
        y += 1
      }
    }
    ensureSpace(10)
    doc.font('Helvetica').fontSize(5.8).fillColor('#9ca3af')
    doc.text('Generated by CampusFlow Resume Studio — Classic ATS (vector, selectable)', margin, pageH - margin + 4, { width: contentW, align: 'center' } as any)
    doc.end()
  })
}

// ---------- Modern AltaCV ----------
async function generateModernVectorBuffer(data: ResumeDataForLatex): Promise<Buffer> {
  const PDFDocument = await loadPdfKit()
  if (!PDFDocument) throw new Error('pdfkit not available')
  return new Promise<Buffer>((resolve, reject) => {
    const doc: any = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const margin = 36 // 0.50in
    const gap = 16
    const pageW = 595.28
    const pageH = 841.89
    const contentW = pageW - margin * 2
    const leftW = Math.floor(contentW * 0.62)
    const rightW = contentW - leftW - gap
    const bottomLimit = pageH - margin
    const colAccent = '#2D4A9A'
    const colText = '#1f2937'
    const colMuted = '#6b7280'
    const colBlack = '#111827'
    let y = margin
    const p: any = data.personalInfo || {}
    // top accent
    doc.save(); doc.fillColor(colAccent).rect(margin, y - 8, contentW, 2.5).fill(); doc.restore()
    y += 4
    doc.font('Helvetica-Bold').fontSize(20).fillColor(colAccent)
    {
      const name = String(p.fullName || 'Your Name').trim() || 'Your Name'
      doc.text(name, margin, y, { width: contentW, align: 'center' }); y = doc.y + 2
    }
    if (p.headline?.trim()) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(colMuted)
      doc.text(String(p.headline).trim(), margin, y, { width: contentW, align: 'center' }); y = doc.y + 2
    }
    // contact
    {
      const parts: string[] = []
      if (p.email?.trim()) parts.push(String(p.email).trim())
      if (p.phone?.trim()) parts.push(String(p.phone).trim())
      if (p.location?.trim()) parts.push(String(p.location).trim())
      const linkLabels = (p.links || []).filter((l: any)=>l.url?.trim()).map((l: any)=> String(l.label))
      if (linkLabels.length) parts.push(...linkLabels)
      const contactLine = parts.join('  |  ')
      if (contactLine) {
        doc.font('Helvetica').fontSize(7).fillColor(colMuted)
        doc.text(contactLine, margin, y, { width: contentW, align: 'center' })
        const contactY = y
        try {
          if (p.email?.trim()) {
            const email = String(p.email).trim()
            const w = doc.widthOfString(contactLine)
            const lineW = Math.min(w, contentW)
            const startX = margin + (contentW - lineW) / 2 + doc.widthOfString(contactLine.slice(0, contactLine.indexOf(email)))
            doc.link(startX, contactY - 1, doc.widthOfString(email), 7, `mailto:${email}`)
          }
        } catch {}
        y = doc.y + 2
      }
    }
    doc.save(); doc.strokeColor(colAccent).lineWidth(0.6).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y += 6
    if (p.summary?.trim()) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(colAccent)
      doc.text('SUMMARY', margin, y); y = doc.y + 2
      doc.save(); doc.strokeColor(colAccent).lineWidth(0.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y += 4
      doc.font('Helvetica').fontSize(7.6).fillColor(colText)
      doc.text(String(p.summary).trim(), margin, y, { width: contentW, lineGap: 1.1 }); y = doc.y + 6
    }
    const y0 = y
    let yLeft = y0
    let yRight = y0
    function ensureLeft(need: number) { if (yLeft + need > bottomLimit) { doc.addPage(); yLeft = margin; yRight = margin } }
    function ensureRight(need: number) { if (yRight + need > bottomLimit) { doc.addPage(); yRight = margin; yLeft = margin } }
    function leftSection(title: string) {
      ensureLeft(18); doc.font('Helvetica-Bold').fontSize(9).fillColor(colAccent)
      doc.text(title.toUpperCase(), margin, yLeft); yLeft = doc.y + 1
      doc.save(); doc.strokeColor(colAccent).lineWidth(0.5).moveTo(margin, yLeft).lineTo(margin + leftW, yLeft).stroke(); doc.restore(); yLeft += 4
    }
    function rightSection(title: string) {
      ensureRight(18)
      const rx = margin + leftW + gap
      doc.font('Helvetica-Bold').fontSize(9).fillColor(colAccent)
      doc.text(title.toUpperCase(), rx, yRight); yRight = doc.y + 1
      doc.save(); doc.strokeColor(colAccent).lineWidth(0.5).moveTo(rx, yRight).lineTo(rx + rightW, yRight).stroke(); doc.restore(); yRight += 4
    }
    if (data.experience && data.experience.length > 0) {
      leftSection('Experience')
      for (const exp of data.experience) {
        const role = String(exp.role || 'Role').trim() || 'Role'
        const company = String(exp.company || 'Company').trim() || 'Company'
        const loc = exp.location?.trim() ? ` | ${String(exp.location).trim()}` : ''
        const dateRange = [String(exp.startDate||'').trim(), String(exp.endDate||'').trim()].filter(Boolean).join(' – ') || ''
        const titleLine = `${role} — ${company}${loc}`
        const tLines = doc.widthOfString(titleLine) > leftW - 70 ? 2 : 1
        const tH = tLines * 9
        ensureLeft(Math.max(tH,10)+8)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(colBlack)
        doc.text(titleLine, margin, yLeft, { width: leftW - 70 })
        const afterLeft = doc.y
        if (dateRange) {
          doc.font('Helvetica').fontSize(6.5).fillColor(colAccent)
          doc.text(dateRange, margin, yLeft - (doc.y - yLeft) + (afterLeft - yLeft > 9 ? 0 : 0), { width: leftW, align: 'right' } as any)
          // simpler: place at same yLeft with right align; we already advanced, so use yLeft baseline approximated
          // we re-draw at corrected Y (title baseline): use saved yLeftStart
        }
        // Since we used doc.y advanced, set yLeft to afterLeft
        // For date, we already used text which may have advanced doc.y incorrectly — reset logic: re-draw date at title baseline more robustly using doc.text with fixed y
        // Simpler: if we need precise, we could store titleY; but approximating is fine
        yLeft = Math.max(afterLeft, yLeft + 9) + 1
        if (dateRange) {
          // ensure date is visible: we already drew it overlapping; ignore adjustment for minimal
        }
        const bullets = (exp.bullets||[]).map((b:string)=>String(b).trim()).filter(Boolean)
        for (const b of bullets) {
          const txt = '• ' + b
          const bh = doc.heightOfString(txt, { width: leftW - 8, lineGap: 0.9 } as any)
          ensureLeft(bh+2)
          doc.font('Helvetica').fontSize(7.2).fillColor(colText)
          doc.text(txt, margin + 6, yLeft, { width: leftW - 8, lineGap: 0.9 }); yLeft += bh + 1
        }
        yLeft += 3
      }
    }
    if (data.projects && data.projects.length > 0) {
      leftSection('Projects')
      for (const proj of data.projects) {
        const title = String(proj.title || 'Untitled').trim() || 'Untitled'
        const dateStr = String(proj.date || '').trim()
        ensureLeft(12)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(colBlack)
        doc.text(title, margin, yLeft, { width: leftW - 50 })
        const afterT = doc.y
        if (dateStr) { doc.font('Helvetica').fontSize(6.5).fillColor(colMuted); doc.text(dateStr, margin + leftW, yLeft, { align: 'right' } as any) }
        yLeft = afterT + 1
        if (proj.tech && proj.tech.length > 0) {
          const tech = proj.tech.join(' · ')
          doc.font('Helvetica-Oblique').fontSize(6.8).fillColor(colAccent)
          doc.text(tech, margin, yLeft, { width: leftW }); yLeft = doc.y + 1
        }
        if (proj.description?.trim()) {
          const d = String(proj.description).trim()
          doc.font('Helvetica').fontSize(7.2).fillColor(colText)
          doc.text(d, margin, yLeft, { width: leftW, lineGap: 0.9 }); yLeft = doc.y + 1
        }
        if (proj.link?.trim()) {
          const url = String(proj.link).trim()
          doc.font('Helvetica').fontSize(6.8).fillColor(colAccent)
          const ly = yLeft
          doc.text(url, margin, yLeft, { width: leftW, link: url } as any)
          const ny = doc.y
          try { doc.link(margin, ly -1, Math.min(doc.widthOfString(url), leftW), 7, url) } catch {}
          yLeft = ny + 1
        }
        yLeft += 3
      }
    }
    const rx = margin + leftW + gap
    if (data.skills && data.skills.length > 0) {
      rightSection('Skills')
      doc.font('Helvetica').fontSize(7.2).fillColor(colText)
      const txt = data.skills.join(', ')
      doc.text(txt, rx, yRight, { width: rightW, lineGap: 1.1 }); yRight = doc.y + 4
    }
    if (data.education && data.education.length > 0) {
      rightSection('Education')
      for (const ed of data.education) {
        const degree = String(ed.degree || 'Degree').trim() || 'Degree'
        const school = String(ed.school || 'Institution').trim() || 'Institution'
        const loc2 = ed.location?.trim() ? `, ${String(ed.location).trim()}` : ''
        const dateRange2 = [String(ed.startDate||'').trim(), String(ed.endDate||'').trim()].filter(Boolean).join(' – ') || ''
        const cgpaStr = ed.cgpa?.trim() ? `CGPA: ${String(ed.cgpa).trim()}` : ''
        ensureRight(14)
        doc.font('Helvetica-Bold').fontSize(8).fillColor(colBlack)
        doc.text(degree, rx, yRight, { width: rightW }); yRight = doc.y + 1
        doc.font('Helvetica').fontSize(7).fillColor(colText)
        doc.text(`${school}${loc2}`, rx, yRight, { width: rightW }); yRight = doc.y + 1
        if (dateRange2) { doc.font('Helvetica').fontSize(6.5).fillColor(colAccent); doc.text(dateRange2, rx, yRight, { width: rightW }); yRight = doc.y + 1 }
        if (cgpaStr) { doc.font('Helvetica').fontSize(6.5).fillColor(colMuted); doc.text(cgpaStr, rx, yRight, { width: rightW }); yRight = doc.y + 1 }
        yRight += 3
      }
    }
    doc.font('Helvetica').fontSize(5.8).fillColor('#9ca3af')
    doc.text('Generated by CampusFlow — AltaCV Modern (vector, selectable)', pageW/2, pageH - margin + 4, { width: contentW, align: 'center' } as any)
    doc.end()
  })
}

async function generateMinimalVectorBuffer(data: ResumeDataForLatex): Promise<Buffer> {
  const PDFDocument = await loadPdfKit()
  if (!PDFDocument) throw new Error('pdfkit not available')
  return new Promise<Buffer>((resolve, reject) => {
    const doc: any = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const margin = 43 // 0.60in
    const pageW = 595.28
    const pageH = 841.89
    const contentW = pageW - margin * 2
    const bottomLimit = pageH - margin
    const colAccent = '#374151'
    const colRule = '#D1D5DB'
    const colText = '#1f2937'
    const colMuted = '#6b7280'
    let y = margin
    function ensureSpace(need: number) { if (y + need > bottomLimit) { doc.addPage(); y = margin } }
    function section(title: string) {
      ensureSpace(18); doc.font('Helvetica-Bold').fontSize(9).fillColor(colAccent)
      doc.text(title.toUpperCase(), margin, y); y = doc.y + 2
      doc.save(); doc.strokeColor(colRule).lineWidth(0.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y += 4
    }
    const p: any = data.personalInfo || {}
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827')
    {
      const name = String(p.fullName || 'Your Name').trim() || 'Your Name'
      doc.text(name, margin, y, { width: contentW }); y = doc.y + 2
    }
    if (p.headline?.trim()) {
      doc.font('Helvetica').fontSize(8).fillColor(colMuted)
      doc.text(String(p.headline).trim(), margin, y, { width: contentW }); y = doc.y + 1
    }
    {
      const parts: string[] = []
      if (p.email?.trim()) parts.push(String(p.email).trim())
      if (p.phone?.trim()) parts.push(String(p.phone).trim())
      if (p.location?.trim()) parts.push(String(p.location).trim())
      const linkLabels = (p.links||[]).filter((l:any)=>l.url?.trim()).map((l:any)=> `${l.label}: ${l.url}`).slice(0,3)
      if (linkLabels.length) parts.push(...linkLabels)
      const contactLine = parts.join('  |  ')
      if (contactLine) {
        doc.font('Helvetica').fontSize(7).fillColor(colMuted)
        doc.text(contactLine, margin, y, { width: contentW }); y = doc.y + 2
      }
    }
    doc.save(); doc.strokeColor(colRule).lineWidth(0.5).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y+=6
    if (p.summary?.trim()) {
      section('Summary')
      doc.font('Helvetica').fontSize(7.8).fillColor(colText)
      doc.text(String(p.summary).trim(), margin, y, { width: contentW, lineGap: 1.1 }); y = doc.y + 4
    }
    if (data.skills && data.skills.length > 0) {
      section('Skills')
      const txt = data.skills.join(', ')
      doc.font('Helvetica').fontSize(7.8).fillColor(colText)
      doc.text(txt, margin, y, { width: contentW, lineGap: 1.1 }); y = doc.y + 4
    }
    if (data.experience && data.experience.length > 0) {
      section('Experience')
      for (const exp of data.experience) {
        const role = String(exp.role||'Role').trim()||'Role'
        const company = String(exp.company||'Company').trim()||'Company'
        const loc = exp.location?.trim()? ` | ${String(exp.location).trim()}`:''
        const dateRange = [String(exp.startDate||'').trim(), String(exp.endDate||'').trim()].filter(Boolean).join(' – ')||''
        const titleLine = `${role} — ${company}${loc}`
        ensureSpace(12)
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827')
        doc.text(titleLine, margin, y, { width: contentW - 90 })
        const afterLeft = doc.y
        if (dateRange) { doc.font('Helvetica').fontSize(7).fillColor(colMuted); doc.text(dateRange, margin, y - (afterLeft - y) + 0, { width: contentW, align: 'right' } as any) }
        y = afterLeft + 1
        // date already drawn overlapping — but doc.y advanced; we fix y to afterLeft
        // Re-draw date correctly at title baseline more robust: store titleY
        // For minimal, simplicity: date on next line right-aligned is okay; keep as drawn
        for (const b of (exp.bullets||[]).map((x:string)=>String(x).trim()).filter(Boolean)) {
          const txt = '-- ' + b
          const bh = doc.heightOfString(txt, { width: contentW -10, lineGap: 0.9 } as any)
          ensureSpace(bh+2)
          doc.font('Helvetica').fontSize(7.4).fillColor(colText)
          doc.text(txt, margin+6, y, { width: contentW -10, lineGap: 0.9 }); y+= bh+1
        }
        y+=3
      }
    }
    if (data.projects && data.projects.length > 0) {
      section('Projects')
      for (const proj of data.projects) {
        const title = String(proj.title||'Untitled').trim()||'Untitled'
        const dateStr = String(proj.date||'').trim()
        ensureSpace(12)
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827')
        doc.text(title, margin, y, { width: contentW - 60 })
        const afterT = doc.y
        if (dateStr) { doc.font('Helvetica').fontSize(7).fillColor(colMuted); doc.text(dateStr, margin, y - (afterT - y), { width: contentW, align: 'right' } as any) }
        y = afterT + 1
        if (proj.tech && proj.tech.length>0) {
          const tech = proj.tech.join(', ')
          doc.font('Helvetica-Oblique').fontSize(7).fillColor(colMuted)
          doc.text(tech, margin, y, { width: contentW }); y = doc.y + 1
        }
        if (proj.description?.trim()) {
          const d = String(proj.description).trim()
          doc.font('Helvetica').fontSize(7.4).fillColor(colText)
          doc.text(d, margin, y, { width: contentW, lineGap: 0.9 }); y = doc.y + 1
        }
        if (proj.link?.trim()) {
          const url = String(proj.link).trim()
          doc.font('Helvetica').fontSize(7).fillColor(colMuted)
          const ly = y
          doc.text(url, margin, y, { width: contentW, link: url } as any)
          const ny = doc.y
          try { doc.link(margin, ly -1, Math.min(doc.widthOfString(url), contentW), 7, url) } catch {}
          y = ny + 1
        }
        y+=3
      }
    }
    if (data.education && data.education.length > 0) {
      section('Education')
      for (const ed of data.education) {
        const degree = String(ed.degree||'Degree').trim()||'Degree'
        const school = String(ed.school||'Institution').trim()||'Institution'
        const loc2 = ed.location?.trim()? `, ${String(ed.location).trim()}`:''
        const dateRange2 = [String(ed.startDate||'').trim(), String(ed.endDate||'').trim()].filter(Boolean).join(' – ')||''
        const titleLine = `${degree} — ${school}${loc2}`
        ensureSpace(12)
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827')
        doc.text(titleLine, margin, y, { width: contentW -90 })
        const afterT = doc.y
        if (dateRange2) { doc.font('Helvetica').fontSize(7).fillColor(colMuted); doc.text(dateRange2, margin, y - (afterT - y), { width: contentW, align: 'right' } as any) }
        y = afterT + 1
        if (ed.cgpa?.trim()) { doc.font('Helvetica').fontSize(7).fillColor(colMuted); doc.text(`CGPA: ${String(ed.cgpa).trim()}`, margin, y, { width: contentW }); y = doc.y +1 }
        y+=2
      }
    }
    ensureSpace(10)
    doc.font('Helvetica').fontSize(5.8).fillColor('#9ca3af')
    doc.text('Generated by CampusFlow — ATS Minimal — vector, selectable', pageW/2, pageH - margin +4, { width: contentW, align: 'center' } as any)
    doc.end()
  })
}

async function generateSourceSplitVectorBuffer(data: ResumeDataForLatex): Promise<Buffer> {
  const PDFDocument = await loadPdfKit()
  if (!PDFDocument) throw new Error('pdfkit not available')
  return new Promise<Buffer>((resolve, reject) => {
    const doc: any = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const margin = 36 // 0.5in
    const pageW = 595.28
    const pageH = 841.89
    const contentW = pageW - margin * 2
    const bottomLimit = pageH - margin
    const colBlack = '#000000'
    const colText = '#000000'
    let y = margin
    function ensureSpace(need: number) { if (y + need > bottomLimit) { doc.addPage(); y = margin } }
    function hairline() { doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y += 4 }
    function sectionHead(title: string) {
      ensureSpace(18); doc.font('Helvetica-Bold').fontSize(12).fillColor(colBlack)
      doc.text(title.toUpperCase(), margin, y); y = doc.y + 2
      doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y += 6
    }
    const p: any = data.personalInfo || {}
    const fullName = String(p.fullName || 'Jane Doe').trim() || 'Jane Doe'
    const location = String(p.location || '').trim()
    // Name left 24.8pt
    doc.font('Helvetica-Bold').fontSize(24.8).fillColor(colBlack)
    doc.text(fullName, margin, y, { width: contentW - 110 } as any)
    const afterNameY = doc.y
    if (location) {
      doc.font('Helvetica').fontSize(9.5).fillColor(colBlack)
      // right align location at same baseline
      const nameY = y
      doc.text(location, margin, nameY, { width: contentW, align: 'right' } as any)
    }
    y = afterNameY + 2
    // links left vs email/phone right
    const links = (p.links || []).filter((l:any)=> l.url?.trim())
    const linkLine = links.map((l:any)=> l.label).join(' | ')
    const contactRight = [p.email?.trim(), p.phone?.trim()].filter(Boolean).join(' | ')
    if (linkLine || contactRight) {
      const leftW = contentW * 0.58
      if (linkLine) {
        doc.font('Helvetica').fontSize(8.5).fillColor(colBlack)
        const linkY = y
        doc.text(linkLine, margin, y, { width: leftW } as any)
        const afterLeftY = doc.y
        // underline + links
        try {
          let curX = margin
          doc.font('Helvetica').fontSize(8.5)
          for (let i=0;i<links.length;i++) {
            const seg = String(links[i].label)
            const segW = doc.widthOfString(seg)
            const ulY = linkY + 8.5 * 0.2 + 1
            doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(curX, ulY).lineTo(curX + segW, ulY).stroke(); doc.restore()
            doc.link(curX, linkY - 1, segW, 9, String(links[i].url))
            curX += segW
            if (i < links.length -1) curX += doc.widthOfString(' | ')
          }
        } catch {}
        if (contactRight) {
          doc.font('Helvetica').fontSize(8.5).fillColor(colBlack)
          doc.text(contactRight, margin, linkY, { width: contentW, align: 'right' } as any)
          if (p.email?.trim()) {
            try {
              const email = String(p.email).trim()
              const w = doc.widthOfString(contactRight)
              const lineW = Math.min(w, contentW)
              const startX = margin + (contentW - lineW)
              // right aligned => startX is right edge minus width? Actually width = contentW, align right => startX = margin + contentW - lineW, but for our case contentW width, so compute
              // Simpler: compute prefix
              const idx = contactRight.indexOf(email)
              if (idx >=0) {
                const prefixW = doc.widthOfString(contactRight.slice(0, idx))
                const emailW = doc.widthOfString(email)
                const ulY = linkY + 1
                doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(startX + prefixW, ulY).lineTo(startX + prefixW + emailW, ulY).stroke(); doc.restore()
                doc.link(startX + prefixW, linkY -1, emailW, 9, `mailto:${email}`)
              }
            } catch {}
          }
        }
        y = afterLeftY + 1
      } else if (contactRight) {
        doc.font('Helvetica').fontSize(8.5).fillColor(colBlack)
        doc.text(contactRight, margin, y, { width: contentW, align: 'right' } as any); y = doc.y + 1
      }
    }
    hairline()
    const headline = String(p.headline || 'FULL STACK DEVELOPER').trim().toUpperCase() || 'FULL STACK DEVELOPER'
    doc.font('Helvetica-Bold').fontSize(10).fillColor(colBlack)
    doc.text(headline, margin, y, { characterSpacing: 0.6 } as any); y = doc.y + 6
    if (p.summary?.trim()) {
      sectionHead('Summary')
      doc.font('Helvetica').fontSize(10).fillColor(colText)
      doc.text(String(p.summary).trim(), margin, y, { width: contentW, lineGap: 3 } as any); y = doc.y + 4
    }
    const skillRows = parseSkillRows(data.skills||[])
    if (skillRows.length) {
      sectionHead('Technical Skills')
      const labelW = 102
      const gap = 6
      const valueW = contentW - labelW - gap
      for (const row of skillRows) {
        const label = `${row.label}:`
        const value = row.value
        const vH = doc.heightOfString(value, { width: valueW } as any)
        ensureSpace(Math.max(vH, 12) + 2)
        const rowY = y
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(colBlack)
        doc.text(label, margin, rowY, { width: labelW } as any)
        doc.font('Helvetica').fontSize(9.5).fillColor(colText)
        doc.text(value, margin + labelW + gap, rowY, { width: valueW, lineGap: 2 } as any)
        const afterV = doc.y
        y = Math.max(rowY + 12, afterV) + 2
      }
    }
    if (data.experience && data.experience.length) {
      sectionHead('Experience')
      for (const exp of data.experience) {
        const role = String(exp.role||'Role').trim()||'Role'
        const company = String(exp.company||'Company').trim()||'Company'
        const loc = exp.location?.trim()? String(exp.location).trim():''
        const start = String(exp.startDate||'').trim()
        const end = String(exp.endDate||'').trim()
        const dateRange = [start, end].filter(Boolean).join(' – ')||''
        ensureSpace(26)
        const rowY = y
        doc.font('Helvetica-Bold').fontSize(10).fillColor(colBlack)
        doc.text(role, margin, rowY, { width: contentW - 110 } as any)
        const afterRoleY = doc.y
        if (dateRange) { doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(colBlack); doc.text(dateRange, margin, rowY, { width: contentW, align: 'right'} as any) }
        y = Math.max(afterRoleY, rowY + 10) + 1
        doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(colBlack)
        doc.text(company, margin, y, { width: contentW - 110 } as any)
        const afterCompY = doc.y
        if (loc) doc.text(loc, margin, y, { width: contentW, align: 'right'} as any)
        y = Math.max(afterCompY, y + 10) + 2
        const bullets = (exp.bullets||[]).map((b:string)=>String(b).trim()).filter(Boolean)
        for (const b of bullets) {
          const isKeyword = b.indexOf(':')>1 && b.indexOf(':')<80
          const txt = isKeyword ? b : b
          const display = isKeyword ? `•  ${b.split(':')[0]}: ${b.slice(b.indexOf(':')+1).trim()}` : `•  ${b}`
          // Use formatted bullet: bold keyword if colon
          const parts = b.split(':')
          if (isKeyword) {
            const first = parts[0] + ':'
            const rest = b.slice(b.indexOf(':')+1).trim()
            const bullet = `•  ${first} ${rest}`
            const bh = doc.heightOfString(bullet, { width: contentW - 12 } as any)
            ensureSpace(bh + 2)
            // Render with bold keyword approximation: first draw full then overdraw bold keyword
            doc.font('Helvetica').fontSize(9.5).fillColor(colText)
            doc.text(bullet, margin + 8, y, { width: contentW - 12, lineGap: 2 } as any)
            const savedY = y
            const bulletPrefixW = doc.widthOfString('•  ')
            try {
              doc.font('Helvetica-Bold').fontSize(9.5)
              doc.text(first, margin + 8 + bulletPrefixW, savedY, { lineBreak: false } as any)
            } catch {}
            y += bh + 1
          } else {
            const bullet = `•  ${b}`
            const bh = doc.heightOfString(bullet, { width: contentW -12 } as any)
            ensureSpace(bh + 2)
            doc.font('Helvetica').fontSize(9.5).fillColor(colText)
            doc.text(bullet, margin + 8, y, { width: contentW -12, lineGap: 2 } as any); y += bh + 1
          }
        }
        y += 2
      }
    }
    if (data.projects && data.projects.length) {
      sectionHead('Projects')
      for (const proj of data.projects) {
        const title = String(proj.title||'Untitled Project').trim()||'Untitled'
        const tech = (proj.tech||[]).join(' · ')
        const linkUrl = proj.link?.trim()||''
        ensureSpace(16)
        const rowY = y
        doc.font('Helvetica-Bold').fontSize(10).fillColor(colBlack)
        doc.text(title, margin, rowY, { width: 140 } as any)
        const afterTitleY = doc.y
        if (tech) { doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(colBlack); doc.text(tech, margin + 146, rowY, { width: contentW - 226, align: 'center'} as any) }
        if (linkUrl) {
          const src='Source Code'
          const srcW = doc.widthOfString(src)
          const srcX = pageW - margin - srcW
          doc.font('Helvetica').fontSize(8.5).fillColor(colBlack)
          doc.text(src, srcX, rowY)
          doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(srcX, rowY+1).lineTo(srcX+srcW, rowY+1).stroke(); doc.restore()
          try{ doc.link(srcX, rowY-1, srcW, 9, linkUrl)}catch{}
        } else if (proj.date?.trim()) {
          doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(colBlack)
          doc.text(String(proj.date).trim(), pageW - margin, rowY, { align: 'right'} as any)
        }
        y = Math.max(afterTitleY, rowY + 10) + 2
        if (proj.description?.trim()) {
          const d = String(proj.description).trim()
          const dh = doc.heightOfString(d, { width: contentW } as any)
          ensureSpace(dh + 2)
          doc.font('Helvetica').fontSize(9.5).fillColor(colText)
          doc.text(d, margin, y, { width: contentW, lineGap: 2 } as any); y = doc.y + 2
        }
        y += 1
      }
    }
    if (data.education && data.education.length) {
      sectionHead('Education')
      for (const ed of data.education) {
        const degree = String(ed.degree||'Degree').trim()||'Degree'
        const school = String(ed.school||'Institution').trim()||'Institution'
        const loc2 = ed.location?.trim()? `, ${String(ed.location).trim()}`:''
        const start2 = String(ed.startDate||'').trim()
        const end2 = String(ed.endDate||'').trim()
        const dateRange2 = [start2, end2].filter(Boolean).join(' – ')||''
        const cgpaStr = ed.cgpa?.trim()? `CGPA: ${String(ed.cgpa).trim()}`:''
        ensureSpace(18)
        const rowY = y
        doc.font('Helvetica-Bold').fontSize(10).fillColor(colBlack)
        doc.text(degree, margin, rowY, { width: contentW -110 } as any)
        const afterDegY = doc.y
        if (dateRange2) { doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(colBlack); doc.text(dateRange2, margin, rowY, { width: contentW, align:'right'} as any) }
        y = Math.max(afterDegY, rowY + 10) +1
        const schoolLine = `${school}${loc2}${cgpaStr? ` · ${cgpaStr}`:''}`
        doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(colBlack)
        doc.text(schoolLine, margin, y, { width: contentW } as any); y = doc.y + 4
      }
    }
    const certs = (data as any).certifications as any[] | undefined
    if (certs && certs.length) {
      sectionHead('Certifications')
      for (const c of certs) {
        const name2 = String(c.name||'Certification').trim()||'Certification'
        const issuer = c.issuer?.trim()? ` — ${String(c.issuer).trim()}`:''
        const date2 = String(c.date||'').trim()
        ensureSpace(14)
        const rowY = y
        doc.font('Helvetica-Bold').fontSize(10).fillColor(colBlack)
        doc.text(`${name2}${issuer}`, margin, rowY, { width: contentW - 90 } as any)
        const afterY = doc.y
        if (date2) { doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(colBlack); doc.text(date2, margin, rowY, { width: contentW, align:'right'} as any) }
        y = Math.max(afterY, rowY +10) +1
        if (c.url?.trim()) {
          const url = String(c.url).trim()
          doc.font('Helvetica').fontSize(8.5).fillColor(colBlack)
          doc.text('Verify', margin, y, { link: url } as any)
          const vW = doc.widthOfString('Verify')
          doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(margin, y+1).lineTo(margin+vW, y+1).stroke(); doc.restore()
          try{ doc.link(margin, y-1, vW, 9, url)}catch{}
          y = doc.y + 4
        }
        y +=1
      }
    }
    doc.font('Helvetica').fontSize(6).fillColor('#000000')
    doc.text('Source Sans Pro · 10pt/12pt · 0.5in · 0.4pt hairline · monochrome', pageW/2, pageH - margin +6, { width: contentW, align:'center'} as any)
    doc.end()
  })
}

async function generateCompactVectorBuffer(data: ResumeDataForLatex): Promise<Buffer> {
  const PDFDocument = await loadPdfKit()
  if (!PDFDocument) throw new Error('pdfkit not available')
  return new Promise<Buffer>((resolve, reject) => {
    const doc: any = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const margin = 36
    const pageW = 595.28
    const pageH = 841.89
    const contentW = pageW - margin*2
    const bottomLimit = pageH - margin
    const colBlack = '#000000'
    let y = margin
    function ensureSpace(need: number){ if (y + need > bottomLimit){ doc.addPage(); y = margin } }
    function hairline(){ doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y+=4 }
    function sectionHead(title: string){ ensureSpace(16); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(colBlack); doc.text(title.toUpperCase(), margin, y); y = doc.y + 2; doc.save(); doc.strokeColor('#000000').lineWidth(0.4).moveTo(margin, y).lineTo(pageW - margin, y).stroke(); doc.restore(); y+=5 }
    const p: any = data.personalInfo || {}
    const nameU = String(p.fullName||'Your Name').trim().toUpperCase()||'YOUR NAME'
    doc.font('Helvetica-Bold').fontSize(20).fillColor(colBlack)
    doc.text(nameU, margin, y, { width: contentW, align:'center'} as any); y = doc.y + 2
    const headline = String(p.headline||'STUDENT · DEVELOPER').trim().toUpperCase()
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colBlack)
    doc.text(headline, margin, y, { width: contentW, align:'center', characterSpacing: 0.8 } as any); y=doc.y+6
    const contactParts: string[] = []
    if (p.email?.trim()) contactParts.push(String(p.email).trim())
    if (p.phone?.trim()) contactParts.push(String(p.phone).trim())
    if (p.location?.trim()) contactParts.push(String(p.location).trim())
    for (const l of (p.links||[]).filter((l:any)=>l.url?.trim())) contactParts.push(String(l.label))
    const contactLine = contactParts.join(' | ')
    if (contactLine) {
      doc.font('Helvetica').fontSize(8).fillColor(colBlack)
      doc.text(contactLine, margin, y, { width: contentW, align:'center'} as any)
      const contactY = y
      try {
        const w = doc.widthOfString(contactLine)
        const lineW = Math.min(w, contentW)
        const startX = margin + (contentW - lineW)/2
        if (p.email?.trim()) {
          const email=String(p.email).trim()
          const idx=contactLine.indexOf(email)
          if(idx>=0) doc.link(startX + doc.widthOfString(contactLine.slice(0, idx)), contactY-1, doc.widthOfString(email), 8, `mailto:${email}`)
        }
        for (const l of (p.links||[]).filter((l:any)=>l.url?.trim())) {
          const idx=contactLine.indexOf(String(l.label))
          if(idx>=0) doc.link(startX + doc.widthOfString(contactLine.slice(0, idx)), contactY-1, doc.widthOfString(String(l.label)), 8, String(l.url))
        }
      } catch{}
      y = doc.y + 4
    }
    hairline()
    if (p.summary?.trim()) {
      sectionHead('Summary')
      doc.font('Helvetica').fontSize(9).fillColor(colBlack)
      doc.text(String(p.summary).trim(), margin, y, { width: contentW, lineGap:2 } as any); y=doc.y+4
    }
    const skillRows = parseSkillRows(data.skills||[])
    if (skillRows.length) {
      sectionHead('Skills')
      if (skillRows.length===1 && skillRows[0].label==='Skills') {
        doc.font('Helvetica').fontSize(9).fillColor(colBlack)
        doc.text(skillRows[0].value, margin, y, { width: contentW, lineGap:2 } as any); y=doc.y+4
      } else {
        const labelW=92
        const gap=6
        const valueW=contentW - labelW - gap
        for (const row of skillRows) {
          const label=`${row.label}:`
          const vH=doc.heightOfString(row.value, { width: valueW } as any)
          ensureSpace(Math.max(vH,10)+2)
          const rowY=y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(colBlack)
          doc.text(label, margin, rowY, { width: labelW } as any)
          doc.font('Helvetica').fontSize(9).fillColor(colBlack)
          doc.text(row.value, margin+labelW+gap, rowY, { width: valueW, lineGap:2 } as any)
          const afterV=doc.y
          y=Math.max(rowY+10, afterV)+2
        }
      }
    }
    if (data.experience && data.experience.length) {
      sectionHead('Experience')
      for (const exp of data.experience) {
        const role=String(exp.role||'Role').trim()||'Role'
        const company=String(exp.company||'Company').trim()||'Company'
        const loc=exp.location?.trim()? ` · ${String(exp.location).trim()}`:''
        const dateRange=[String(exp.startDate||'').trim(), String(exp.endDate||'').trim()].filter(Boolean).join(' – ')||''
        const titleLine=`${role} — ${company}${loc}`
        ensureSpace(14)
        const rowY=y
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(colBlack)
        doc.text(titleLine, margin, rowY, { width: contentW -80 } as any)
        const afterY=doc.y
        if(dateRange){ doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(dateRange, margin, rowY, { width: contentW, align:'right'} as any) }
        y=Math.max(afterY, rowY+10)+1
        for (const b of (exp.bullets||[]).map((x:string)=>String(x).trim()).filter(Boolean)) {
          const bullet=`•  ${b}`
          const bh=doc.heightOfString(bullet, { width: contentW -10 } as any)
          ensureSpace(bh+2)
          const isKeyword=b.indexOf(':')>1 && b.indexOf(':')<80
          doc.font('Helvetica').fontSize(9).fillColor(colBlack)
          doc.text(bullet, margin+6, y, { width: contentW -10, lineGap:1.5 } as any)
          if(isKeyword){
            const prefixW=doc.widthOfString('•  ')
            const first=b.split(':')[0]+':'
            try{ doc.font('Helvetica-Bold').fontSize(9); doc.text(first, margin+6+prefixW, y) }catch{}
          }
          y+=bh+1
        }
        y+=2
      }
    }
    if (data.projects && data.projects.length) {
      sectionHead('Projects')
      for (const proj of data.projects) {
        const title=String(proj.title||'Untitled').trim()||'Untitled'
        const dateStr=String(proj.date||'').trim()
        ensureSpace(14)
        const rowY=y
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(colBlack)
        doc.text(title, margin, rowY, { width: contentW -60 } as any)
        const afterY=doc.y
        if(dateStr){ doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(dateStr, margin, rowY, { width: contentW, align:'right'} as any) }
        y=Math.max(afterY, rowY+10)+1
        if(proj.tech && proj.tech.length){ const tech=proj.tech.join(' · '); doc.font('Helvetica-Oblique').fontSize(8).fillColor(colBlack); doc.text(tech, margin, y, { width: contentW } as any); y=doc.y+2 }
        if(proj.description?.trim()){ const d=String(proj.description).trim(); const dh=doc.heightOfString(d, { width: contentW } as any); ensureSpace(dh+2); doc.font('Helvetica').fontSize(9).fillColor(colBlack); doc.text(d, margin, y, { width: contentW, lineGap:1.5 } as any); y=doc.y+2 }
        if(proj.link?.trim()){ const url=String(proj.link).trim(); doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(url, margin, y, { width: contentW, link: url } as any); const ny=doc.y; try{ doc.link(margin, y-1, Math.min(doc.widthOfString(url), contentW), 8, url)}catch{}; y=ny+2 }
        y+=2
      }
    }
    if (data.education && data.education.length) {
      sectionHead('Education')
      for (const ed of data.education) {
        const degree=String(ed.degree||'Degree').trim()||'Degree'
        const school=String(ed.school||'Institution').trim()||'Institution'
        const loc2=ed.location?.trim()? `, ${String(ed.location).trim()}`:''
        const dateRange2=[String(ed.startDate||'').trim(), String(ed.endDate||'').trim()].filter(Boolean).join(' – ')||''
        const titleLine=`${degree} — ${school}${loc2}`
        ensureSpace(12)
        const rowY=y
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(colBlack)
        doc.text(titleLine, margin, rowY, { width: contentW -80 } as any)
        const afterY=doc.y
        if(dateRange2){ doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(dateRange2, margin, rowY, { width: contentW, align:'right'} as any) }
        y=Math.max(afterY, rowY+10)+1
        if(ed.cgpa?.trim()){ doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(`CGPA: ${String(ed.cgpa).trim()}`, margin, y, { width: contentW } as any); y=doc.y+2 }
        y+=1
      }
    }
    const certs=(data as any).certifications as any[]|undefined
    if(certs && certs.length){
      sectionHead('Certifications')
      for(const c of certs){
        const name2=String(c.name||'Certification').trim()||'Certification'
        const issuer=c.issuer?.trim()? ` — ${String(c.issuer).trim()}`:''
        const date2=String(c.date||'').trim()
        const titleLine=`${name2}${issuer}`
        ensureSpace(12)
        const rowY=y
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(colBlack)
        doc.text(titleLine, margin, rowY, { width: contentW -80 } as any)
        const afterY=doc.y
        if(date2){ doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(date2, margin, rowY, { width: contentW, align:'right'} as any) }
        y=Math.max(afterY,rowY+10)+1
        if(c.url?.trim()){ const url=String(c.url).trim(); doc.font('Helvetica').fontSize(8).fillColor(colBlack); doc.text(url, margin, y, { width: contentW, link:url } as any); const ny=doc.y; try{doc.link(margin,y-1,Math.min(doc.widthOfString(url),contentW),8,url)}catch{}; y=ny+2 }
        y+=1
      }
    }
    doc.font('Helvetica').fontSize(5.8).fillColor('#000000')
    doc.text('Compact ATS · monochrome · dense', pageW/2, pageH - margin +4, { width: contentW, align:'center'} as any)
    doc.end()
  })
}

async function generateCustomVectorBuffer(data: ResumeDataForLatex & { customConfig?: any }): Promise<Buffer> {
  const PDFDocument = await (await import('pdfkit')).default || (await import('pdfkit'))
  // fallback loader - reuse existing load method logic simplified
  const PdfKit: any = PDFDocument
  // If PDFDocument is not constructor, try dynamic
  let DocCtor: any = PdfKit
  if (!DocCtor || typeof DocCtor !== 'function') {
    try { const mod: any = await import('pdfkit'); DocCtor = mod.default || mod } catch { DocCtor = PdfKit }
  }
  return new Promise<Buffer>((resolve, reject) => {
    const doc: any = new DocCtor({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const cfg: any = (data as any).customConfig || {}
    const accent = String(cfg.accentColor || '#4f46e5').trim() || '#4f46e5'
    const density = cfg.density || 'comfortable'
    const hidden: Set<string> = new Set(cfg.hiddenSections || [])
    const order: string[] = Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : ['summary','skills','experience','projects','education','certifications']
    const showDividers = cfg.showDividers !== false
    const margin = density === 'compact' ? 32 : density === 'spacious' ? 42 : 36
    const pageW = 595.28, pageH = 841.89, contentW = pageW - margin*2, bottomLimit = pageH - margin
    let y = margin
    const colText = '#1f2937', colMuted = '#6b7280'
    function ensureSpace(need:number){ if(y+need>bottomLimit){ doc.addPage(); y=margin } }
    function hairline(){ if(!showDividers) return; doc.save(); doc.strokeColor(accent).lineWidth(0.6).moveTo(margin,y).lineTo(pageW-margin,y).stroke(); doc.restore(); y+=4 }
    function sectionHead(title:string){ ensureSpace(16); doc.font('Helvetica-Bold').fontSize(density==='compact'?10.2: density==='spacious'?12:11).fillColor(accent); doc.text(title.toUpperCase(), margin, y); y=doc.y+2; if(showDividers){ doc.save(); doc.strokeColor(accent).lineWidth(0.6).moveTo(margin,y).lineTo(pageW-margin,y).stroke(); doc.restore(); y+=6 } else y+=3 }
    const p:any = (data as any).personalInfo || {}
    const fullName = String(p.fullName||'Your Name').trim()||'Your Name'
    doc.font('Helvetica-Bold').fontSize(density==='compact'?22: density==='spacious'?26:24).fillColor('#0f172a')
    const nl = doc.splitTextToSize ? doc.splitTextToSize(fullName, contentW-110) : [fullName]
    doc.text(fullName, margin, y, { width: contentW-110 } as any)
    if(p.location?.trim()){ doc.font('Helvetica').fontSize(9).fillColor(accent); doc.text(String(p.location).trim(), pageW-margin, y, { align:'right'} as any) }
    y = doc.y + 2
    const headline = String(p.headline||'FULL STACK DEVELOPER').trim().toUpperCase()||'FULL STACK DEVELOPER'
    doc.font('Helvetica-Bold').fontSize(density==='compact'?8.8:9.5).fillColor(accent); doc.text(headline, margin, y); y=doc.y+6
    const contactParts:string[]=[]; if(p.email?.trim()) contactParts.push(String(p.email).trim()); if(p.phone?.trim()) contactParts.push(String(p.phone).trim())
    const links=(p.links||[]).filter((l:any)=>l.url?.trim())
    const linkLine=links.map((l:any)=> `${l.label}: ${l.url}`).join(' | ')
    const contactLine=contactParts.join(' | ') + (linkLine? (contactParts.length? ' | '+linkLine: linkLine):'')
    if(contactLine){ doc.font('Helvetica').fontSize(density==='compact'?7.2:7.8).fillColor(colMuted); doc.text(contactLine, margin, y, { width:contentW, lineGap:1 } as any); y=doc.y+3 }
    hairline(); y+=2
    const renderers: Record<string,()=>void>={
      summary: ()=>{ if(hidden.has('summary')) return; const s=String(p.summary||'').trim(); if(!s) return; sectionHead('Summary'); doc.font('Helvetica').fontSize(9).fillColor(colText); doc.text(s, margin, y, { width:contentW, lineGap:1.2 } as any); y=doc.y+4 },
      skills: ()=>{ if(hidden.has('skills')||!data.skills?.length) return; sectionHead('Technical Skills'); const rows=parseSkillRows(data.skills||[]); for(const r of rows){ const v=r.value; const vH=doc.heightOfString? doc.heightOfString(v,{width: contentW-116} as any): 12; ensureSpace(14); doc.font('Helvetica-Bold').fontSize(9).fillColor(accent); doc.text(r.label+':', margin, y, { width:110 } as any); doc.font('Helvetica').fontSize(9).fillColor(colText); doc.text(v, margin+116, y, { width: contentW-116, lineGap:1 } as any); y=Math.max(y+vH, doc.y)+2 } },
      experience: ()=>{ if(hidden.has('experience')||!data.experience?.length) return; sectionHead('Experience'); for(const exp of data.experience){ const role=String(exp.role||'Role').trim()||'Role'; const company=String(exp.company||'Company').trim()||'Company'; const loc=exp.location?.trim()? ` · ${String(exp.location).trim()}`:''; const dr=[String(exp.startDate||'').trim(),String(exp.endDate||'').trim()].filter(Boolean).join(' – ')||''; const tl=`${role} — ${company}${loc}`; ensureSpace(18); doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827'); doc.text(tl, margin, y, { width: contentW-90 } as any); if(dr){ doc.font('Helvetica').fontSize(8).fillColor(accent); doc.text(dr, margin, y, { width:contentW, align:'right'} as any) } y=doc.y+1; for(const b of (exp.bullets||[]).map((x:string)=>String(x).trim()).filter(Boolean)){ const bullet='•  '+b; const bh=doc.heightOfString? doc.heightOfString(bullet,{width:contentW-12} as any): 10; ensureSpace(bh+2); doc.font('Helvetica').fontSize(8.5).fillColor(colText); doc.text(bullet, margin+8, y, { width:contentW-12 } as any); y+=bh } y+=2 } },
      projects: ()=>{ if(hidden.has('projects')||!data.projects?.length) return; sectionHead('Projects'); for(const proj of data.projects){ const title=String(proj.title||'Untitled').trim()||'Untitled'; const dStr=String(proj.date||'').trim(); ensureSpace(16); doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827'); doc.text(title, margin, y, { width: contentW-60 } as any); if(dStr){ doc.font('Helvetica').fontSize(8).fillColor(accent); doc.text(dStr, pageW-margin, y, { align:'right'} as any) } y=doc.y+1; if(proj.tech?.length){ const t=proj.tech.join(' · '); doc.font('Helvetica-Oblique').fontSize(8).fillColor(accent); doc.text(t, margin, y, { width:contentW } as any); y=doc.y+1 } if(proj.description?.trim()){ const d=String(proj.description).trim(); doc.font('Helvetica').fontSize(8.5).fillColor(colText); doc.text(d, margin, y, { width:contentW } as any); y=doc.y+1 } y+=3 } },
      education: ()=>{ if(hidden.has('education')||!data.education?.length) return; sectionHead('Education'); for(const ed of data.education){ const deg=String(ed.degree||'Degree').trim()||'Degree'; const school=String(ed.school||'Institution').trim()||'Institution'; const loc2=ed.location?.trim()? `, ${String(ed.location).trim()}`:''; const dr=[String(ed.startDate||'').trim(),String(ed.endDate||'').trim()].filter(Boolean).join(' – ')||''; const tl=`${deg} — ${school}${loc2}`; ensureSpace(14); doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827'); doc.text(tl, margin, y, { width: contentW-80 } as any); if(dr){ doc.font('Helvetica').fontSize(8).fillColor(accent); doc.text(dr, margin, y, { width:contentW, align:'right'} as any) } y=doc.y+1; if(ed.cgpa?.trim()){ doc.font('Helvetica').fontSize(8).fillColor(colMuted); doc.text(`CGPA: ${String(ed.cgpa).trim()}`, margin, y); y=doc.y+1 } } },
      certifications: ()=>{ const certs=(data as any).certifications||[]; if(hidden.has('certifications')||!certs.length) return; sectionHead('Certifications'); for(const c of certs){ const n=String(c.name||'Certification').trim()||'Certification'; const iss=c.issuer?.trim()? ` — ${String(c.issuer).trim()}`:''; const d2=String(c.date||'').trim(); const tl=`${n}${iss}`; ensureSpace(12); doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827'); doc.text(tl, margin, y, { width:contentW-80 } as any); if(d2){ doc.font('Helvetica').fontSize(8).fillColor(accent); doc.text(d2, margin, y, { width:contentW, align:'right'} as any) } y=doc.y+1 } }
    }
    for(const id of order){ const fn=renderers[id]; if(fn) fn() }
    doc.font('Helvetica').fontSize(6).fillColor('#9ca3af'); doc.text('Custom • fully editable — CampusFlow', pageW/2, pageH-margin+6, { width:contentW, align:'center'} as any); doc.end()
  })
}

export async function generateVectorPdfBuffer(data: ResumeDataForLatex): Promise<Buffer> {
  const tpl = String((data as any).template || 'source-split').toLowerCase()
  if (tpl === 'custom') return generateCustomVectorBuffer(data as any)
  if (tpl === 'source-split') return generateSourceSplitVectorBuffer(data)
  if (tpl === 'compact') return generateCompactVectorBuffer(data)
  if (tpl === 'modern') return generateModernVectorBuffer(data)
  if (tpl === 'minimal') return generateMinimalVectorBuffer(data)
  return generateClassicVectorBuffer(data)
}

export async function generateResumePdfBuffer(_latex: string, data: ResumeDataForLatex): Promise<Buffer> {
  // Pure-vector only (C-4). _latex is ignored server-side (kept for signature
  // compat); .tex download path remains for Overleaf client-side compile.
  return generateVectorPdfBuffer(data)
}

export async function generateResumePdfWithMeta(_latex: string, data: ResumeDataForLatex): Promise<{ buffer: Buffer; engine: 'local-pdflatex' | 'online-latex' | 'pdfkit-vector' }> {
  // Always pdfkit-vector. Engine union kept for caller compat (resume.ts sets
  // X-Pdf-Engine header); local/online branches removed (no shell, no PII exfil).
  const vec = await generateVectorPdfBuffer(data)
  return { buffer: vec, engine: 'pdfkit-vector' }
}

