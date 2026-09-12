/**
 * CampusFlow — JSON Resume import/export (http://jsonresume.org)
 * Converts between ResumeData and JSON Resume format (basics, work, education, skills, projects)
 */
import type { ResumeData } from '../types/resume'
import { DEFAULT_CUSTOM_CONFIG } from '../types/resume'

export type JsonResume = {
  basics?: {
    name?: string
    label?: string
    email?: string
    phone?: string
    url?: string
    summary?: string
    location?: { address?: string; city?: string; region?: string; countryCode?: string } | string
    profiles?: { network: string; username?: string; url: string }[]
    headline?: string
  }
  work?: Array<{
    name?: string
    position?: string
    location?: string
    startDate?: string
    endDate?: string
    summary?: string
    highlights?: string[]
    url?: string
  }>
  education?: Array<{
    institution?: string
    area?: string
    studyType?: string
    startDate?: string
    endDate?: string
    gpa?: string
    location?: string
    url?: string
  }>
  skills?: Array<{ name: string; keywords?: string[]; level?: string }>
  projects?: Array<{
    name?: string
    description?: string
    highlights?: string[]
    keywords?: string[]
    startDate?: string
    endDate?: string
    url?: string
    roles?: string[]
  }>
  certificates?: Array<{ name?: string; date?: string; issuer?: string; url?: string }>
  // allow passthrough for legacy CampusFlow JSON
  personalInfo?: any
  customConfig?: any
  template?: string
}

export function resumeDataToJsonResume(data: ResumeData): JsonResume {
  const p = data.personalInfo
  // location string -> JSON Resume location object simplified
  const locationStr = p.location?.trim() || ''
  const basicsProfiles = (p.links || []).filter(l => l.url?.trim()).map(l => ({
    network: l.label || 'Link',
    url: l.url,
    username: l.label,
  }))

  const work = (data.experience || []).map(exp => ({
    name: exp.company || '',
    position: exp.role || '',
    location: exp.location || '',
    startDate: exp.startDate || '',
    endDate: exp.endDate || '',
    highlights: (exp.bullets || []).map(b => String(b).trim()).filter(Boolean),
    summary: '',
  }))

  const education = (data.education || []).map(ed => ({
    institution: ed.school || '',
    area: ed.degree || '',
    studyType: ed.degree || '',
    startDate: ed.startDate || '',
    endDate: ed.endDate || '',
    gpa: ed.cgpa || '',
    location: ed.location || '',
  }))

  // Skills: try to preserve categorized vs flat. If hasColon, map each as skill name=label, keywords=values split by comma.
  // Otherwise, single skill "Skills" with keywords = flat skills.
  let skills: JsonResume['skills'] = []
  if (data.skills?.length) {
    const hasColon = data.skills.some(s => String(s).includes(':'))
    if (hasColon) {
      for (const raw of data.skills) {
        const s = String(raw).trim()
        const idx = s.indexOf(':')
        if (idx > 0) {
          const label = s.slice(0, idx).trim()
          const val = s.slice(idx + 1).trim()
          const kws = val.split(',').map(x => x.trim()).filter(Boolean)
          skills.push({ name: label, keywords: kws })
        } else if (s) {
          skills.push({ name: 'Other', keywords: [s] })
        }
      }
    } else {
      skills = [{ name: 'Skills', keywords: data.skills.map(s => String(s).trim()).filter(Boolean) }]
    }
  }

  const projects = (data.projects || []).map(proj => ({
    name: proj.title || '',
    description: proj.description || '',
    keywords: proj.tech || [],
    url: proj.link || '',
    startDate: proj.date || '',
    highlights: [],
  }))

  const certificates = (data.certifications || []).map(c => ({
    name: c.name || '',
    issuer: c.issuer || '',
    date: c.date || '',
    url: c.url || '',
  }))

  return {
    basics: {
      name: p.fullName || '',
      label: p.headline || '',
      email: p.email || '',
      phone: p.phone || '',
      summary: p.summary || '',
      location: locationStr ? { address: locationStr } as any : undefined,
      profiles: basicsProfiles.length ? basicsProfiles : undefined,
    },
    work: work.length ? work : undefined,
    education: education.length ? education : undefined,
    skills: skills.length ? skills : undefined,
    projects: projects.length ? projects : undefined,
    certificates: certificates.length ? certificates : undefined,
  }
}

export function jsonResumeToResumeData(json: any): ResumeData {
  // Detect if it's already CampusFlow ResumeData shape (has personalInfo)
  if (json && typeof json === 'object' && json.personalInfo && Array.isArray(json.skills)) {
    // It's CampusFlow native JSON — return as-is with defaults
    const d = json as ResumeData
    return {
      personalInfo: {
        fullName: d.personalInfo?.fullName || json.basics?.name || '',
        email: d.personalInfo?.email || json.basics?.email || '',
        phone: d.personalInfo?.phone || json.basics?.phone || '',
        location: d.personalInfo?.location || (typeof json.basics?.location === 'string' ? json.basics.location : json.basics?.location?.address || ''),
        headline: d.personalInfo?.headline || json.basics?.label || '',
        summary: d.personalInfo?.summary || json.basics?.summary || '',
        links: d.personalInfo?.links?.length ? d.personalInfo.links : (Array.isArray(json.basics?.profiles) ? json.basics.profiles.map((p: any) => ({ label: p.network || 'Link', url: p.url || '' })) : [{ label: 'LinkedIn', url: '' }]),
      },
      skills: Array.isArray(d.skills) ? d.skills : [],
      projects: Array.isArray(d.projects) ? d.projects : [],
      experience: Array.isArray(d.experience) ? d.experience : [],
      education: Array.isArray(d.education) ? d.education : [],
      certifications: Array.isArray((d as any).certifications) ? (d as any).certifications : [],
      template: (d.template as any) || 'source-split',
      customConfig: d.customConfig || { ...DEFAULT_CUSTOM_CONFIG },
      originalAsset: d.originalAsset || null,
      latexSource: d.latexSource,
      updatedAt: new Date().toISOString(),
      pdfOverlayEdits: (d as any).pdfOverlayEdits,
      docxEditedHtml: (d as any).docxEditedHtml,
    }
  }

  const basics = json?.basics || {}
  const locationStr = typeof basics.location === 'string' ? basics.location : basics.location?.address || basics.location?.city || '' || json?.basics?.location?.address || ''
  const profiles = Array.isArray(basics.profiles) ? basics.profiles : []

  // Skills -> flat ResumeData skills (categorized string "Label: kw1, kw2")
  let skills: string[] = []
  if (Array.isArray(json.skills)) {
    for (const s of json.skills) {
      if (!s) continue
      if (typeof s === 'string') skills.push(String(s).trim())
      else if (s.name && Array.isArray(s.keywords) && s.keywords.length) {
        skills.push(`${s.name}: ${s.keywords.join(', ')}`)
      } else if (s.name && s.keywords && typeof s.keywords === 'string') {
        skills.push(`${s.name}: ${s.keywords}`)
      } else if (s.name) skills.push(String(s.name).trim())
      else if (Array.isArray(s.keywords)) skills.push(...s.keywords.map((k: any) => String(k).trim()))
    }
  }
  // Some JSON Resume use "skills" as flat strings in other exporters
  if (!skills.length && Array.isArray(json.skills) && json.skills.length && typeof json.skills[0] === 'string') {
    skills = json.skills.map((x: any) => String(x).trim())
  }

  const work = Array.isArray(json.work) ? json.work : []
  const experience = work.map((w: any, idx: number) => ({
    id: String(Date.now() + idx),
    role: w.position || w.role || w.title || 'Role',
    company: w.name || w.company || 'Company',
    location: w.location || '',
    startDate: w.startDate || '',
    endDate: w.endDate || '',
    bullets: Array.isArray(w.highlights) && w.highlights.length ? w.highlights.map((x: any) => String(x).trim()).filter(Boolean) : w.summary ? [String(w.summary).trim()] : [''],
  }))

  const eduArr = Array.isArray(json.education) ? json.education : []
  const education = eduArr.map((e: any, idx: number) => ({
    id: String(Date.now() + 100 + idx),
    degree: e.area || e.studyType || e.degree || 'Degree',
    school: e.institution || e.school || 'Institution',
    location: e.location || '',
    startDate: e.startDate || '',
    endDate: e.endDate || '',
    cgpa: e.gpa || e.score || '',
  }))

  const projArr = Array.isArray(json.projects) ? json.projects : []
  const projects = projArr.map((proj: any, idx: number) => ({
    id: String(Date.now() + 200 + idx),
    title: proj.name || proj.title || 'Untitled',
    description: proj.description || (Array.isArray(proj.highlights) ? proj.highlights.join(' ') : '') || '',
    tech: Array.isArray(proj.keywords) ? proj.keywords : Array.isArray(proj.technologies) ? proj.technologies : proj.keywords ? [String(proj.keywords)] : [],
    link: proj.url || proj.link || '',
    date: proj.startDate || proj.date || '',
  }))

  const certArr = Array.isArray(json.certificates) ? json.certificates : Array.isArray(json.certifications) ? json.certifications : []
  const certifications = certArr.map((c: any, idx: number) => ({
    id: String(Date.now() + 300 + idx),
    name: c.name || 'Certification',
    issuer: c.issuer || '',
    date: c.date || '',
    url: c.url || '',
  }))

  // Resolve links: profiles + basics.url
  const links = profiles.length ? profiles.map((pr: any) => ({ label: pr.network || 'Link', url: pr.url || '' })) : basics.url ? [{ label: 'Portfolio', url: basics.url }] : [{ label: 'LinkedIn', url: '' }]

  return {
    personalInfo: {
      fullName: basics.name || '',
      email: basics.email || '',
      phone: basics.phone || '',
      location: locationStr || '',
      headline: basics.label || basics.headline || '',
      summary: basics.summary || '',
      links: links.length ? links : [{ label: 'LinkedIn', url: '' }],
    },
    skills,
    projects,
    experience,
    education,
    certifications,
    template: 'source-split',
    customConfig: { ...DEFAULT_CUSTOM_CONFIG },
    originalAsset: null,
    updatedAt: new Date().toISOString(),
  }
}

export function downloadJsonResume(data: ResumeData, asNative = false) {
  const json = asNative ? data : resumeDataToJsonResume(data)
  const safe = (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_') || 'Resume'
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = asNative ? `${safe}_ResumeData.json` : `${safe}_JsonResume.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function parseJsonResumeFile(file: File): Promise<ResumeData> {
  const text = await file.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch (e: any) {
    throw new Error('Invalid JSON file: ' + (e?.message || String(e)))
  }
  return jsonResumeToResumeData(json)
}
