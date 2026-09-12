/**
 * CampusFlow — DOCX export via `docx` lib
 * Mirrors jsPDF templates (custom/source-split etc.) but generates .docx with same content
 * (header, summary, skills, experience, projects, education) using docx Document, Paragraph, etc.
 */
import type { ResumeData, ResumeTemplateId, CustomSectionId } from '../types/resume'
import { DEFAULT_CUSTOM_CONFIG } from '../types/resume'

// On-demand docx chunk (load on Export click, not on page load).
// WHY: `docx` (~200KB) is only needed for DOCX export — dynamic import()
// keeps it out of the ResumeStudio chunk like popular sites do for exporters.
type DocxModule = typeof import('docx')
let docxCache: DocxModule | null = null
async function loadDocx(): Promise<DocxModule> {
  if (!docxCache) docxCache = await import('docx')
  return docxCache
}
// Runtime namespace set before building paragraphs (helpers use R.*).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let R: any = null

function safeName(data: ResumeData): string {
  return (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_') || 'Resume'
}

function formatDate(s?: string): string {
  if (!s) return ''
  if (String(s).toLowerCase() === 'present') return 'Present'
  return String(s)
}

function parseSkillRows(skills: string[]): { label: string; value: string }[] {
  if (!skills || skills.length === 0) return []
  const hasColon = skills.some(s => String(s).includes(':'))
  if (!hasColon) return [{ label: 'Skills', value: skills.map(s => String(s).trim()).filter(Boolean).join(', ') }]
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = String(hex || '#4f46e5').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 79, g: 70, b: 229 }
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}
function hexNoHash(hex: string): string {
  const h = String(hex || '#4f46e5').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '4F46E5'
  return h.toUpperCase()
}

// Helpers to build docx paragraph styles
function headingParagraph(text: string, opts?: { color?: string; size?: number; align?: any; spacingAfter?: number; borderBottom?: boolean; accentHex?: string }): any {
  const color = opts?.accentHex ? hexNoHash(opts.accentHex) : opts?.color ? hexNoHash(opts.color) : undefined
  const size = opts?.size ?? 22 // half-points: 11pt = 22
  const p = new R.Paragraph({
    heading: R.HeadingLevel.HEADING_2,
    alignment: opts?.align,
    spacing: { after: opts?.spacingAfter ?? 120, before: 120 },
    border: opts?.borderBottom
      ? {
          bottom: {
            color: color || '000000',
            space: 1,
            style: R.BorderStyle.SINGLE,
            size: 6,
          },
        }
      : undefined,
    children: [
      new R.TextRun({
        text: text.toUpperCase(),
        bold: true,
        color: color,
        size,
        font: 'Calibri',
        allCaps: true,
      }),
    ],
  })
  return p
}

function spacer(size = 120): any {
  return new R.Paragraph({ spacing: { after: size }, children: [new R.TextRun({ text: '', size: 2 })] })
}

function hr(accentHex?: string): any {
  const c = accentHex ? hexNoHash(accentHex) : '000000'
  return new R.Paragraph({
    border: {
      bottom: { color: c, space: 1, style: R.BorderStyle.SINGLE, size: 6 },
    },
    spacing: { after: 120, before: 60 },
    children: [],
  })
}

// Contact line with hyperlinks (if docx ExternalHyperlink available)
function contactParagraph(p: ResumeData['personalInfo'], align: any = R.AlignmentType.CENTER, accentHex?: string): any {
  const children: any[] = []
  const parts: { text: string; url?: string }[] = []
  if (p.email?.trim()) parts.push({ text: p.email.trim(), url: `mailto:${p.email.trim()}` })
  if (p.phone?.trim()) parts.push({ text: p.phone.trim() })
  if (p.location?.trim()) parts.push({ text: p.location.trim() })
  for (const l of (p.links || []).filter(x => x.url?.trim())) parts.push({ text: l.label, url: l.url })
  parts.forEach((part, idx) => {
    if (idx > 0) children.push(new R.TextRun({ text: '  |  ', color: '6B7280', size: 16 }))
    if (part.url) {
      const link = new R.ExternalHyperlink({
        children: [new R.TextRun({ text: part.text, color: accentHex ? hexNoHash(accentHex) : '1D4ED8', size: 16, style: 'Hyperlink' })],
        link: part.url,
      })
      children.push(link)
    } else {
      children.push(new R.TextRun({ text: part.text, color: '374151', size: 16 }))
    }
  })
  return new R.Paragraph({ alignment: align, spacing: { after: 80 }, children })
}

function summaryParagraph(text: string): any {
  return new R.Paragraph({
    spacing: { after: 120 },
    children: [new R.TextRun({ text, size: 19, color: '1F2937' })],
  })
}

function skillsFlatParagraph(skills: string[]): any {
  return new R.Paragraph({
    spacing: { after: 120 },
    children: [new R.TextRun({ text: skills.join(', '), size: 19, color: '1F2937' })],
  })
}

function skillRowsParagraphs(rows: { label: string; value: string }[], accentHex?: string): any[] {
  const out: any[] = []
  for (const r of rows) {
    out.push(
      new R.Paragraph({
        spacing: { after: 40 },
        children: [
          new R.TextRun({ text: `${r.label}: `, bold: true, size: 19, color: accentHex ? hexNoHash(accentHex) : '111827' }),
          new R.TextRun({ text: r.value, size: 19, color: '1F2937' }),
        ],
        indent: { left: 120 },
      })
    )
  }
  return out
}

function experienceParagraphs(exps: ResumeData['experience'], opts?: { accentHex?: string; density?: string }): any[] {
  const out: any[] = []
  const accent = opts?.accentHex ? hexNoHash(opts.accentHex) : '111827'
  for (const exp of exps) {
    const role = (exp.role || 'Role').trim() || 'Role'
    const company = (exp.company || 'Company').trim() || 'Company'
    const loc = exp.location?.trim() ? ` — ${exp.location.trim()}` : ''
    const dateRange = [formatDate(exp.startDate), formatDate(exp.endDate)].filter(Boolean).join(' – ') || ''
    // Title line with tab stop for dates right-aligned
    out.push(
      new R.Paragraph({
        tabStops: [{ type: R.TabStopType.RIGHT, position: R.TabStopPosition.MAX }],
        spacing: { after: 20 },
        children: [
          new R.TextRun({ text: `${role} — ${company}${loc}`, bold: true, size: 20, color: '111827' }),
          new R.TextRun({ text: '\t' }),
          new R.TextRun({ text: dateRange, italics: true, size: 17, color: accent }),
        ],
      })
    )
    const bullets = (exp.bullets || []).map(b => String(b).trim()).filter(Boolean)
    for (const b of bullets) {
      // Keyword bold if colon early
      const idx = b.indexOf(':')
      if (idx > 1 && idx < 80) {
        const before = b.slice(0, idx + 1)
        const after = b.slice(idx + 1).trim()
        out.push(
          new R.Paragraph({
            bullet: { level: 0 },
            spacing: { after: 20 },
            children: [
              new R.TextRun({ text: before + ' ', bold: true, size: 19, color: '1F2937' }),
              new R.TextRun({ text: after, size: 19, color: '1F2937' }),
            ],
          })
        )
      } else {
        out.push(
          new R.Paragraph({
            bullet: { level: 0 },
            spacing: { after: 20 },
            children: [new R.TextRun({ text: b, size: 19, color: '1F2937' })],
          })
        )
      }
    }
    out.push(spacer(60))
  }
  return out
}

function projectsParagraphs(projects: ResumeData['projects'], opts?: { accentHex?: string }): any[] {
  const out: any[] = []
  const accent = opts?.accentHex ? hexNoHash(opts.accentHex) : '1D4ED8'
  for (const proj of projects) {
    const title = (proj.title || 'Untitled').trim() || 'Untitled'
    const dateStr = (proj.date || '').trim()
    const tech = (proj.tech || []).join(' · ')
    out.push(
      new R.Paragraph({
        tabStops: [{ type: R.TabStopType.RIGHT, position: R.TabStopPosition.MAX }],
        spacing: { after: 20 },
        children: [
          new R.TextRun({ text: title, bold: true, size: 20, color: '111827' }),
          new R.TextRun({ text: '\t' }),
          new R.TextRun({ text: dateStr, italics: true, size: 17, color: '6B7280' }),
        ],
      })
    )
    if (tech) {
      out.push(new R.Paragraph({ spacing: { after: 40 }, children: [new R.TextRun({ text: tech, italics: true, size: 17, color: accent })] }))
    }
    if (proj.description?.trim()) {
      out.push(new R.Paragraph({ spacing: { after: 40 }, children: [new R.TextRun({ text: proj.description.trim(), size: 19, color: '1F2937' })] }))
    }
    if (proj.link?.trim()) {
      const url = proj.link.trim()
      out.push(
        new R.Paragraph({
          spacing: { after: 60 },
          children: [new R.ExternalHyperlink({ children: [new R.TextRun({ text: url, color: accent, size: 17, style: 'Hyperlink' })], link: url })],
        })
      )
    } else out.push(spacer(40))
  }
  return out
}

function educationParagraphs(eds: ResumeData['education'], opts?: { accentHex?: string }): any[] {
  const out: any[] = []
  const accent = opts?.accentHex ? hexNoHash(opts.accentHex) : '374151'
  for (const ed of eds) {
    const degree = (ed.degree || 'Degree').trim() || 'Degree'
    const school = (ed.school || 'Institution').trim() || 'Institution'
    const loc = ed.location?.trim() ? `, ${ed.location.trim()}` : ''
    const dateRange = [formatDate(ed.startDate), formatDate(ed.endDate)].filter(Boolean).join(' – ') || ''
    const cgpaStr = ed.cgpa?.trim() ? `CGPA: ${ed.cgpa.trim()}` : ''
    out.push(
      new R.Paragraph({
        tabStops: [{ type: R.TabStopType.RIGHT, position: R.TabStopPosition.MAX }],
        spacing: { after: 20 },
        children: [
          new R.TextRun({ text: `${degree} — ${school}${loc}`, bold: true, size: 20, color: '111827' }),
          new R.TextRun({ text: '\t' }),
          new R.TextRun({ text: dateRange, italics: true, size: 17, color: accent }),
        ],
      })
    )
    if (cgpaStr) out.push(new R.Paragraph({ spacing: { after: 60 }, children: [new R.TextRun({ text: cgpaStr, size: 17, color: '6B7280' })] }))
    else out.push(spacer(40))
  }
  return out
}

function certificationsParagraphs(certs: NonNullable<ResumeData['certifications']>, opts?: { accentHex?: string }): any[] {
  const out: any[] = []
  const accent = opts?.accentHex ? hexNoHash(opts.accentHex) : '374151'
  for (const c of certs) {
    const name = (c.name || 'Certification').trim() || 'Certification'
    const issuer = c.issuer?.trim() ? ` — ${c.issuer.trim()}` : ''
    const date = (c.date || '').trim()
    out.push(
      new R.Paragraph({
        tabStops: [{ type: R.TabStopType.RIGHT, position: R.TabStopPosition.MAX }],
        spacing: { after: 20 },
        children: [
          new R.TextRun({ text: `${name}${issuer}`, bold: true, size: 20, color: '111827' }),
          new R.TextRun({ text: '\t' }),
          new R.TextRun({ text: date, size: 17, color: accent }),
        ],
      })
    )
    if (c.url?.trim()) {
      const url = c.url.trim()
      out.push(new R.Paragraph({ spacing: { after: 60 }, children: [new R.ExternalHyperlink({ children: [new R.TextRun({ text: url, color: accent, size: 17 })], link: url })] }))
    } else out.push(spacer(40))
  }
  return out
}

function buildParagraphsForTemplate(data: ResumeData, template: ResumeTemplateId): any[] {
  const p = data.personalInfo
  const cfg = (data as any).customConfig || DEFAULT_CUSTOM_CONFIG
  const accentHex = template === 'custom' ? cfg.accentColor || '#4f46e5' : template === 'source-split' || template === 'compact' ? '#000000' : template === 'modern' ? '#2D4A9A' : template === 'minimal' ? '#374151' : '#111827'
  const isCustom = template === 'custom'
  const hidden: Set<string> = new Set(isCustom ? cfg.hiddenSections || [] : [])
  const order: CustomSectionId[] = isCustom && Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : (['summary', 'skills', 'experience', 'projects', 'education', 'certifications'] as CustomSectionId[])
  const headingStyle = isCustom ? cfg.headingStyle || 'uppercase' : 'uppercase'
  const showDividers = isCustom ? cfg.showDividers !== false : true

  const paras: any[] = []

  // Header — per template variants
  if (template === 'source-split') {
    // Split: Name 24.8pt left, location right, links left vs email/phone right
    paras.push(
      new R.Paragraph({
        spacing: { after: 40 },
        children: [new R.TextRun({ text: p.fullName || 'Jane Doe', bold: true, size: 50, color: '000000' })], // 24.8pt ~ 50 half-pt
      })
    )
    if (p.location?.trim()) {
      paras.push(new R.Paragraph({ alignment: R.AlignmentType.RIGHT, spacing: { after: 40 }, children: [new R.TextRun({ text: p.location.trim(), size: 19, color: '000000' })] }))
    }
    paras.push(contactParagraph(p, R.AlignmentType.LEFT, '#000000'))
    paras.push(hr('#000000'))
    const headline = (p.headline?.trim() || 'FULL STACK DEVELOPER').toUpperCase()
    paras.push(new R.Paragraph({ spacing: { after: 120 }, children: [new R.TextRun({ text: headline, bold: true, size: 20, color: '000000', allCaps: true })] }))
  } else if (template === 'compact') {
    paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 40 }, children: [new R.TextRun({ text: (p.fullName || 'Your Name').toUpperCase(), bold: true, size: 40, color: '000000' })] }))
    const hl = (p.headline?.trim() || 'STUDENT · DEVELOPER').toUpperCase()
    paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 80 }, children: [new R.TextRun({ text: hl, bold: true, size: 17, color: '000000', allCaps: true })] }))
    paras.push(contactParagraph(p, R.AlignmentType.CENTER, '#000000'))
    paras.push(hr('#000000'))
  } else if (template === 'modern') {
    // modern with accent bar + centered
    paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 40 }, children: [new R.TextRun({ text: p.fullName || 'Your Name', bold: true, size: 40, color: hexNoHash(accentHex) })] }))
    if (p.headline?.trim()) paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 60 }, children: [new R.TextRun({ text: p.headline.trim(), italics: true, size: 19, color: '6B7280' })] }))
    paras.push(contactParagraph(p, R.AlignmentType.CENTER, accentHex))
    paras.push(hr(accentHex))
  } else if (template === 'minimal') {
    paras.push(new R.Paragraph({ spacing: { after: 40 }, children: [new R.TextRun({ text: p.fullName || 'Your Name', bold: true, size: 36, color: '111827' })] }))
    if (p.headline?.trim()) paras.push(new R.Paragraph({ spacing: { after: 60 }, children: [new R.TextRun({ text: p.headline.trim(), size: 17, color: '6B7280' })] }))
    paras.push(contactParagraph(p, R.AlignmentType.LEFT, '#374151'))
    paras.push(hr('#D1D5DB'))
  } else if (template === 'custom') {
    // Custom: honor accent, fontFamily is not docx font but we keep generic, density influences spacing
    const titleSize = cfg.density === 'compact' ? 40 : cfg.density === 'spacious' ? 52 : 48
    paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 40 }, children: [new R.TextRun({ text: p.fullName || 'Your Name', bold: true, size: titleSize, color: hexNoHash(accentHex) })] }))
    if (p.location?.trim()) paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 40 }, children: [new R.TextRun({ text: p.location.trim(), size: 17, color: hexNoHash(accentHex) })] }))
    const hl = p.headline?.trim() || 'FULL STACK DEVELOPER'
    const hlText = headingStyle === 'uppercase' ? hl.toUpperCase() : hl
    paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 80 }, children: [new R.TextRun({ text: hlText, bold: true, size: 22, color: hexNoHash(accentHex), allCaps: headingStyle === 'uppercase' })] }))
    paras.push(contactParagraph(p, R.AlignmentType.CENTER, accentHex))
    if (showDividers) paras.push(hr(accentHex))
    else paras.push(spacer(80))
  } else {
    // classic Jake
    paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 40 }, children: [new R.TextRun({ text: p.fullName || 'Your Name', bold: true, size: 44, color: '111827', allCaps: true })] }))
    if (p.headline?.trim()) paras.push(new R.Paragraph({ alignment: R.AlignmentType.CENTER, spacing: { after: 60 }, children: [new R.TextRun({ text: p.headline.trim(), italics: true, size: 17, color: '6B7280' })] }))
    paras.push(contactParagraph(p, R.AlignmentType.CENTER, '#1D4ED8'))
    if (showDividers) paras.push(hr('#111827'))
  }

  // Build ordered sections
  const sectionBuilders: Record<CustomSectionId, () => any[]> = {
    summary: () => {
      if (!p.summary?.trim() || hidden.has('summary')) return []
      return [headingParagraph('Summary', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 }), summaryParagraph(p.summary.trim()), spacer(80)]
    },
    skills: () => {
      const skills = data.skills || []
      if (!skills.length || hidden.has('skills')) return []
      const rows = parseSkillRows(skills)
      const out: any[] = [headingParagraph('Technical Skills', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 })]
      if (rows.length === 1 && rows[0].label === 'Skills') out.push(skillsFlatParagraph(skills))
      else out.push(...skillRowsParagraphs(rows, accentHex))
      out.push(spacer(80))
      return out
    },
    experience: () => {
      if (!data.experience?.length || hidden.has('experience')) return []
      return [headingParagraph('Experience', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 }), ...experienceParagraphs(data.experience, { accentHex }), spacer(40)]
    },
    projects: () => {
      if (!data.projects?.length || hidden.has('projects')) return []
      return [headingParagraph('Projects', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 }), ...projectsParagraphs(data.projects, { accentHex }), spacer(40)]
    },
    education: () => {
      if (!data.education?.length || hidden.has('education')) return []
      return [headingParagraph('Education', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 }), ...educationParagraphs(data.education, { accentHex }), spacer(40)]
    },
    certifications: () => {
      const certs = (data as any).certifications as any[]
      if (!certs?.length || hidden.has('certifications')) return []
      return [headingParagraph('Certifications', { accentHex, size: 22, borderBottom: showDividers, spacingAfter: 80 }), ...certificationsParagraphs(certs, { accentHex }), spacer(40)]
    },
  }

  // For non-custom, keep fixed classic order: summary, skills, experience, projects, education, certifications
  const orderToUse = isCustom ? order : (['summary', 'skills', 'experience', 'projects', 'education', 'certifications'] as CustomSectionId[])
  for (const id of orderToUse) {
    const builder = sectionBuilders[id]
    if (builder) paras.push(...builder())
  }

  // Footer
  paras.push(
    new R.Paragraph({
      alignment: R.AlignmentType.CENTER,
      spacing: { before: 240 },
      children: [new R.TextRun({ text: 'Generated by CampusFlow', size: 14, color: '9CA3AF', italics: true })],
    })
  )
  return paras
}

export async function generateDocxBlob(data: ResumeData): Promise<Blob> {
  R = await loadDocx()
  const template: ResumeTemplateId = (data.template as ResumeTemplateId) || 'source-split'
  const paras = buildParagraphsForTemplate(data, template)

  const marginTwip = R.convertInchesToTwip(template === 'source-split' || template === 'compact' ? 0.5 : template === 'minimal' ? 0.6 : 0.55)
  const doc = new R.Document({
    numbering: {
      config: [
        {
          reference: 'default-bullet',
          levels: [
            {
              level: 0,
              format: R.LevelFormat.BULLET,
              text: '\u2022',
              alignment: R.AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: R.convertInchesToTwip(0.2), hanging: R.convertInchesToTwip(0.15) } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: marginTwip, right: marginTwip, bottom: marginTwip, left: marginTwip },
            size: { width: 12240, height: 15840 }, // A4 approx in twip
          },
        },
        children: paras,
      },
    ],
  })
  const blob = await R.Packer.toBlob(doc)
  return blob
}

export async function downloadDocxFile(data: ResumeData) {
  const blob = await generateDocxBlob(data)
  const tpl = (data.template || 'source-split') as string
  const suffixMap: Record<string, string> = {
    asis: 'OriginalAsIs',
    'source-split': 'SourceSplit',
    compact: 'Compact',
    classic: 'Classic',
    modern: 'Modern',
    minimal: 'Minimal',
    custom: 'Custom',
  }
  const suffix = suffixMap[tpl] || 'SourceSplit'
  const safe = (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_') || 'Resume'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}_Resume_${suffix}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function getDocxFilename(data: ResumeData): string {
  const tpl = (data.template || 'source-split') as string
  const suffixMap: Record<string, string> = { asis: 'OriginalAsIs', 'source-split': 'SourceSplit', compact: 'Compact', classic: 'Classic', modern: 'Modern', minimal: 'Minimal', custom: 'Custom' }
  const suffix = suffixMap[tpl] || 'SourceSplit'
  return `${safeName(data)}_Resume_${suffix}.docx`
}
