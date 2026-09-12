/**
 * CampusFlow — TXT export, plain text ATS-safe version
 */
import type { ResumeData } from '../types/resume'

function line(s = ''): string { return s + '\n' }
function hr(): string { return '------------------------------------------------------------\n' }
function sectionTitle(t: string): string { return `\n${t.toUpperCase()}\n${hr()}` }

export function generateResumeTxt(data: ResumeData): string {
  const p = data.personalInfo
  const out: string[] = []

  // Header
  out.push((p.fullName || 'Your Name').toUpperCase())
  if (p.headline?.trim()) out.push(p.headline.trim())
  out.push('')

  const contact: string[] = []
  if (p.email?.trim()) contact.push(`Email: ${p.email.trim()}`)
  if (p.phone?.trim()) contact.push(`Phone: ${p.phone.trim()}`)
  if (p.location?.trim()) contact.push(`Location: ${p.location.trim()}`)
  for (const l of (p.links || []).filter(x => x.url?.trim())) contact.push(`${l.label}: ${l.url.trim()}`)
  if (contact.length) out.push(contact.join(' | '))
  out.push(hr())

  // Custom order / hidden handling
  const cfg: any = (data as any).customConfig
  const isCustom = (data.template as any) === 'custom'
  const hidden = new Set(isCustom && cfg?.hiddenSections ? cfg.hiddenSections : [])
  const order: string[] = isCustom && Array.isArray(cfg?.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : ['summary','skills','experience','projects','education','certifications']

  const builders: Record<string, () => string[]> = {
    summary: () => {
      if (!p.summary?.trim() || hidden.has('summary')) return []
      return [sectionTitle('Summary'), p.summary.trim() + '\n']
    },
    skills: () => {
      if (!data.skills?.length || hidden.has('skills')) return []
      const lines: string[] = [sectionTitle('Technical Skills')]
      // if colon categorized, keep each as "Label: value"
      const hasColon = data.skills.some(s => String(s).includes(':'))
      if (hasColon) {
        for (const s of data.skills) lines.push(`- ${String(s).trim()}`)
      } else {
        lines.push(data.skills.join(', '))
      }
      lines.push('')
      return lines
    },
    experience: () => {
      if (!data.experience?.length || hidden.has('experience')) return []
      const lines: string[] = [sectionTitle('Experience')]
      for (const exp of data.experience) {
        const role = (exp.role || 'Role').trim() || 'Role'
        const company = (exp.company || 'Company').trim() || 'Company'
        const loc = exp.location?.trim() ? ` | ${exp.location.trim()}` : ''
        const date = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' - ')
        lines.push(`${role} — ${company}${loc}${date ? `  (${date})` : ''}`)
        for (const b of (exp.bullets || []).map(x => String(x).trim()).filter(Boolean)) {
          lines.push(`  - ${b}`)
        }
        lines.push('')
      }
      return lines
    },
    projects: () => {
      if (!data.projects?.length || hidden.has('projects')) return []
      const lines: string[] = [sectionTitle('Projects')]
      for (const proj of data.projects) {
        const title = (proj.title || 'Untitled').trim() || 'Untitled'
        const tech = proj.tech?.length ? ` [${proj.tech.join(', ')}]` : ''
        const date = proj.date?.trim() ? ` (${proj.date.trim()})` : ''
        lines.push(`${title}${tech}${date}`)
        if (proj.description?.trim()) lines.push(`  ${proj.description.trim()}`)
        if (proj.link?.trim()) lines.push(`  Link: ${proj.link.trim()}`)
        lines.push('')
      }
      return lines
    },
    education: () => {
      if (!data.education?.length || hidden.has('education')) return []
      const lines: string[] = [sectionTitle('Education')]
      for (const ed of data.education) {
        const degree = (ed.degree || 'Degree').trim() || 'Degree'
        const school = (ed.school || 'Institution').trim() || 'Institution'
        const loc = ed.location?.trim() ? `, ${ed.location.trim()}` : ''
        const date = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' - ')
        lines.push(`${degree} — ${school}${loc}${date ? `  (${date})` : ''}`)
        if (ed.cgpa?.trim()) lines.push(`  CGPA: ${ed.cgpa.trim()}`)
        lines.push('')
      }
      return lines
    },
    certifications: () => {
      const certs = (data as any).certifications as any[]
      if (!certs?.length || hidden.has('certifications')) return []
      const lines: string[] = [sectionTitle('Certifications')]
      for (const c of certs) {
        const name = (c.name || 'Certification').trim() || 'Certification'
        const issuer = c.issuer?.trim() ? ` — ${c.issuer.trim()}` : ''
        const date = c.date?.trim() ? ` (${c.date.trim()})` : ''
        lines.push(`${name}${issuer}${date}`)
        if (c.url?.trim()) lines.push(`  Verify: ${c.url.trim()}`)
        lines.push('')
      }
      return lines
    }
  }

  for (const id of order) {
    const b = builders[id]
    if (b) out.push(...b())
  }

  out.push(hr())
  out.push('Generated by CampusFlow — ATS TXT (plain text, copy-paste safe)')
  out.push('')
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function downloadResumeTxt(data: ResumeData) {
  const txt = generateResumeTxt(data)
  const safe = (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_') || 'Resume'
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}_Resume.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
