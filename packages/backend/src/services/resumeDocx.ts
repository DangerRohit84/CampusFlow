/**
 * CampusFlow — DOCX export backend via `docx` lib
 * Mirrors resumePdf.ts templates but generates .docx with same content
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  TabStopType,
  TabStopPosition,
  BorderStyle,
  ExternalHyperlink,
  LevelFormat,
  convertInchesToTwip,
} from 'docx'

type ResumeDataForDocx = any

function formatDate(s?: string): string {
  if (!s) return ''
  if (String(s).toLowerCase() === 'present') return 'Present'
  return String(s)
}
function parseSkillRows(skills: string[]): { label: string; value: string }[] {
  if (!skills || skills.length === 0) return []
  const hasColon = skills.some((s: string) => String(s).includes(':'))
  if (!hasColon) return [{ label: 'Skills', value: skills.map((s: string) => String(s).trim()).filter(Boolean).join(', ') }]
  const rows: { label: string; value: string }[] = []
  for (const raw of skills) {
    const s = String(raw).trim()
    if (!s) continue
    const idx = s.indexOf(':')
    if (idx > 0) rows.push({ label: s.slice(0, idx).trim(), value: s.slice(idx + 1).trim() })
    else if (rows.length) rows[rows.length - 1].value += `, ${s}`
    else rows.push({ label: 'Other', value: s })
  }
  return rows.filter(r => r.value)
}
function hexNoHash(hex: string): string {
  const h = String(hex || '#4f46e5').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '4F46E5'
  return h.toUpperCase()
}
function headingParagraph(text: string, opts?: { accentHex?: string; size?: number; borderBottom?: boolean; spacingAfter?: number }): Paragraph {
  const color = opts?.accentHex ? hexNoHash(opts.accentHex) : '111827'
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { after: opts?.spacingAfter ?? 120, before: 120 },
    border: opts?.borderBottom ? { bottom: { color, space: 1, style: BorderStyle.SINGLE, size: 6 } } : undefined,
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color, size: opts?.size ?? 22, allCaps: true })],
  })
}
function spacer(size = 120): Paragraph {
  return new Paragraph({ spacing: { after: size }, children: [new TextRun({ text: '', size: 2 })] })
}
function hr(accentHex?: string): Paragraph {
  const c = accentHex ? hexNoHash(accentHex) : '000000'
  return new Paragraph({ border: { bottom: { color: c, space: 1, style: BorderStyle.SINGLE, size: 6 } }, spacing: { after: 120, before: 60 }, children: [] })
}
function contactParagraph(p: any, align: any = AlignmentType.CENTER, accentHex?: string): Paragraph {
  const children: any[] = []
  const parts: { text: string; url?: string }[] = []
  if (p.email?.trim()) parts.push({ text: p.email.trim(), url: `mailto:${p.email.trim()}` })
  if (p.phone?.trim()) parts.push({ text: p.phone.trim() })
  if (p.location?.trim()) parts.push({ text: p.location.trim() })
  for (const l of (p.links || []).filter((x: any) => x.url?.trim())) parts.push({ text: l.label, url: l.url })
  parts.forEach((part, idx) => {
    if (idx > 0) children.push(new TextRun({ text: '  |  ', color: '6B7280', size: 16 }))
    if (part.url) children.push(new ExternalHyperlink({ children: [new TextRun({ text: part.text, color: accentHex ? hexNoHash(accentHex) : '1D4ED8', size: 16 })], link: part.url }))
    else children.push(new TextRun({ text: part.text, color: '374151', size: 16 }))
  })
  return new Paragraph({ alignment: align, spacing: { after: 80 }, children })
}

function buildParagraphs(data: ResumeDataForDocx, template: string): Paragraph[] {
  const p: any = data.personalInfo || {}
  const cfg: any = data.customConfig || {}
  const isCustom = template === 'custom'
  const hidden: Set<string> = new Set(isCustom ? cfg.hiddenSections || [] : [])
  const order: string[] = isCustom && Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']
  const accentHex = isCustom ? cfg.accentColor || '#4f46e5' : template === 'modern' ? '#2D4A9A' : template === 'minimal' ? '#374151' : template === 'source-split' || template === 'compact' ? '#000000' : '#111827'
  const showDividers = isCustom ? cfg.showDividers !== false : true
  const paras: Paragraph[] = []

  if (template === 'source-split') {
    paras.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: p.fullName || 'Jane Doe', bold: true, size: 50, color: '000000' })] }))
    paras.push(contactParagraph(p, AlignmentType.LEFT, '#000000'))
    paras.push(hr('#000000'))
    paras.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: (p.headline?.trim() || 'FULL STACK DEVELOPER').toUpperCase(), bold: true, size: 20, color: '000000', allCaps: true })] }))
  } else if (template === 'compact') {
    paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: (p.fullName || 'Your Name').toUpperCase(), bold: true, size: 40, color: '000000' })] }))
    paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: (p.headline?.trim() || 'STUDENT · DEVELOPER').toUpperCase(), bold: true, size: 17, color: '000000', allCaps: true })] }))
    paras.push(contactParagraph(p, AlignmentType.CENTER, '#000000'))
    paras.push(hr('#000000'))
  } else if (template === 'modern') {
    paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: p.fullName || 'Your Name', bold: true, size: 40, color: hexNoHash(accentHex) })] }))
    if (p.headline?.trim()) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: p.headline.trim(), italics: true, size: 19, color: '6B7280' })] }))
    paras.push(contactParagraph(p, AlignmentType.CENTER, accentHex))
    paras.push(hr(accentHex))
  } else if (template === 'minimal') {
    paras.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: p.fullName || 'Your Name', bold: true, size: 36, color: '111827' })] }))
    if (p.headline?.trim()) paras.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: p.headline.trim(), size: 17, color: '6B7280' })] }))
    paras.push(contactParagraph(p, AlignmentType.LEFT, '#374151'))
    paras.push(hr('#D1D5DB'))
  } else if (template === 'custom') {
    const titleSize = cfg.density === 'compact' ? 40 : cfg.density === 'spacious' ? 52 : 48
    paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: p.fullName || 'Your Name', bold: true, size: titleSize, color: hexNoHash(accentHex) })] }))
    if (p.location?.trim()) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: p.location.trim(), size: 17, color: hexNoHash(accentHex) })] }))
    const hl = p.headline?.trim() || 'FULL STACK DEVELOPER'
    const hlText = cfg.headingStyle === 'uppercase' ? hl.toUpperCase() : hl
    paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: hlText, bold: true, size: 22, color: hexNoHash(accentHex), allCaps: cfg.headingStyle === 'uppercase' })] }))
    paras.push(contactParagraph(p, AlignmentType.CENTER, accentHex))
    if (showDividers) paras.push(hr(accentHex))
    else paras.push(spacer(80))
  } else {
    paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: p.fullName || 'Your Name', bold: true, size: 44, color: '111827', allCaps: true })] }))
    if (p.headline?.trim()) paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: p.headline.trim(), italics: true, size: 17, color: '6B7280' })] }))
    paras.push(contactParagraph(p, AlignmentType.CENTER, '#1D4ED8'))
    if (showDividers) paras.push(hr('#111827'))
  }

  const builders: Record<string, () => Paragraph[]> = {
    summary: () => {
      if (!p.summary?.trim() || hidden.has('summary')) return []
      return [headingParagraph('Summary', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 }), new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: p.summary.trim(), size: 19, color: '1F2937' })] }), spacer(80)]
    },
    skills: () => {
      const skills: string[] = data.skills || []
      if (!skills.length || hidden.has('skills')) return []
      const rows = parseSkillRows(skills)
      const out: Paragraph[] = [headingParagraph('Technical Skills', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 })]
      if (rows.length === 1 && rows[0].label === 'Skills') out.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: skills.join(', '), size: 19, color: '1F2937' })] }))
      else {
        for (const r of rows) out.push(new Paragraph({ spacing: { after: 40 }, indent: { left: 120 }, children: [new TextRun({ text: `${r.label}: `, bold: true, size: 19, color: hexNoHash(accentHex) }), new TextRun({ text: r.value, size: 19, color: '1F2937' })] }))
      }
      out.push(spacer(80))
      return out
    },
    experience: () => {
      if (!data.experience?.length || hidden.has('experience')) return []
      const out: Paragraph[] = [headingParagraph('Experience', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 })]
      for (const exp of data.experience) {
        const role = String(exp.role || 'Role').trim() || 'Role'
        const company = String(exp.company || 'Company').trim() || 'Company'
        const loc = exp.location?.trim() ? ` — ${String(exp.location).trim()}` : ''
        const dateRange = [formatDate(exp.startDate), formatDate(exp.endDate)].filter(Boolean).join(' – ') || ''
        out.push(new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], spacing: { after: 20 }, children: [new TextRun({ text: `${role} — ${company}${loc}`, bold: true, size: 20, color: '111827' }), new TextRun({ text: '\t' }), new TextRun({ text: dateRange, italics: true, size: 17, color: hexNoHash(accentHex) })] }))
        const bullets = (exp.bullets || []).map((b: string) => String(b).trim()).filter(Boolean)
        for (const b of bullets) {
          const idx = b.indexOf(':')
          if (idx > 1 && idx < 80) {
            const before = b.slice(0, idx + 1)
            const after = b.slice(idx + 1).trim()
            out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: before + ' ', bold: true, size: 19, color: '1F2937' }), new TextRun({ text: after, size: 19, color: '1F2937' })] }))
          } else out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: b, size: 19, color: '1F2937' })] }))
        }
        out.push(spacer(60))
      }
      return out
    },
    projects: () => {
      if (!data.projects?.length || hidden.has('projects')) return []
      const out: Paragraph[] = [headingParagraph('Projects', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 })]
      for (const proj of data.projects) {
        const title = String(proj.title || 'Untitled').trim() || 'Untitled'
        const dateStr = String(proj.date || '').trim()
        const tech = (proj.tech || []).join(' · ')
        out.push(new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], spacing: { after: 20 }, children: [new TextRun({ text: title, bold: true, size: 20, color: '111827' }), new TextRun({ text: '\t' }), new TextRun({ text: dateStr, italics: true, size: 17, color: '6B7280' })] }))
        if (tech) out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: tech, italics: true, size: 17, color: hexNoHash(accentHex) })] }))
        if (proj.description?.trim()) out.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: String(proj.description).trim(), size: 19, color: '1F2937' })] }))
        if (proj.link?.trim()) {
          const url = String(proj.link).trim()
          out.push(new Paragraph({ spacing: { after: 60 }, children: [new ExternalHyperlink({ children: [new TextRun({ text: url, color: hexNoHash(accentHex), size: 17 })], link: url })] }))
        } else out.push(spacer(40))
      }
      return out
    },
    education: () => {
      if (!data.education?.length || hidden.has('education')) return []
      const out: Paragraph[] = [headingParagraph('Education', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 })]
      for (const ed of data.education) {
        const degree = String(ed.degree || 'Degree').trim() || 'Degree'
        const school = String(ed.school || 'Institution').trim() || 'Institution'
        const loc = ed.location?.trim() ? `, ${String(ed.location).trim()}` : ''
        const dateRange = [formatDate(ed.startDate), formatDate(ed.endDate)].filter(Boolean).join(' – ') || ''
        const cgpaStr = ed.cgpa?.trim() ? `CGPA: ${String(ed.cgpa).trim()}` : ''
        out.push(new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], spacing: { after: 20 }, children: [new TextRun({ text: `${degree} — ${school}${loc}`, bold: true, size: 20, color: '111827' }), new TextRun({ text: '\t' }), new TextRun({ text: dateRange, italics: true, size: 17, color: hexNoHash(accentHex) })] }))
        if (cgpaStr) out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: cgpaStr, size: 17, color: '6B7280' })] }))
        else out.push(spacer(40))
      }
      return out
    },
    certifications: () => {
      const certs: any[] = (data as any).certifications || []
      if (!certs?.length || hidden.has('certifications')) return []
      const out: Paragraph[] = [headingParagraph('Certifications', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 })]
      for (const c of certs) {
        const name = String(c.name || 'Certification').trim() || 'Certification'
        const issuer = c.issuer?.trim() ? ` — ${String(c.issuer).trim()}` : ''
        const date = String(c.date || '').trim()
        out.push(new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }], spacing: { after: 20 }, children: [new TextRun({ text: `${name}${issuer}`, bold: true, size: 20, color: '111827' }), new TextRun({ text: '\t' }), new TextRun({ text: date, size: 17, color: hexNoHash(accentHex) })] }))
        if (c.url?.trim()) {
          const url = String(c.url).trim()
          out.push(new Paragraph({ spacing: { after: 60 }, children: [new ExternalHyperlink({ children: [new TextRun({ text: url, color: hexNoHash(accentHex), size: 17 })], link: url })] }))
        } else out.push(spacer(40))
      }
      return out
    },
  }

  const orderToUse = isCustom ? order : ['summary', 'skills', 'experience', 'projects', 'education', 'certifications']
  for (const id of orderToUse) {
    const b = builders[id]
    if (b) paras.push(...b())
  }
  paras.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [new TextRun({ text: 'Generated by CampusFlow', size: 14, color: '9CA3AF', italics: true })] }))
  return paras
}

export async function generateDocxBuffer(data: ResumeDataForDocx): Promise<Buffer> {
  const template: string = (data.template as string) || 'source-split'
  const paras = buildParagraphs(data, template)
  const marginTwip = convertInchesToTwip(template === 'source-split' || template === 'compact' ? 0.5 : template === 'minimal' ? 0.6 : 0.55)
  const doc = new Document({
    numbering: {
      config: [{ reference: 'default-bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.2), hanging: convertInchesToTwip(0.15) } } } }] }],
    },
    sections: [{ properties: { page: { margin: { top: marginTwip, right: marginTwip, bottom: marginTwip, left: marginTwip }, size: { width: 12240, height: 15840 } } }, children: paras }],
  })
  const buf = await Packer.toBuffer(doc)
  return buf
}

export function getDocxFilename(data: ResumeDataForDocx): string {
  const base = (data.personalInfo?.fullName || 'Resume').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'Resume'
  const tpl: string = (data.template as string) || 'source-split'
  const suffixMap: Record<string, string> = { asis: 'OriginalAsIs', 'source-split': 'SourceSplit', compact: 'Compact', classic: 'Classic', modern: 'Modern', minimal: 'Minimal', custom: 'Custom' }
  const suffix = suffixMap[tpl] || 'SourceSplit'
  return `${base}_Resume_${suffix}.docx`
}
