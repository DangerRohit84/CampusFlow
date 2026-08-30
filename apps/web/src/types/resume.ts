export type ResumeTemplateId = 'classic' | 'modern' | 'minimal' | 'source-split' | 'compact'

export type ResumePersonalInfo = {
  fullName: string
  email: string
  phone: string
  location: string
  headline: string
  summary: string
  links: { label: string; url: string }[]
}

export type ResumeSkill = string

export type ResumeProject = {
  id: string
  title: string
  description: string
  tech: string[]
  link?: string
  date?: string
}

export type ResumeExperience = {
  id: string
  role: string
  company: string
  location?: string
  startDate: string
  endDate: string
  bullets: string[]
}

export type ResumeEducation = {
  id: string
  degree: string
  school: string
  location?: string
  startDate: string
  endDate: string
  cgpa?: string
}

export type ResumeCertification = {
  id: string
  name: string
  issuer?: string
  date?: string
  url?: string
}

export type ResumeData = {
  personalInfo: ResumePersonalInfo
  skills: string[]
  projects: ResumeProject[]
  experience: ResumeExperience[]
  education: ResumeEducation[]
  certifications: ResumeCertification[]
  template?: ResumeTemplateId
  updatedAt: string
}

export type StoredResume = {
  id: string
  data: ResumeData
}

export type PortfolioData = {
  id: string
  userId: string
  resumeId: string | null
  themeId: string
  slug: string | null
  publicUrl: string | null
  importedAt: string
  publishedAt: string | null
  data: ResumeData
}

export type PortyImportPayload = ResumeData & {
  theme?: string
}

export const RESUME_TEMPLATES: { id: ResumeTemplateId; label: string; desc: string }[] = [
  { id: 'source-split', label: 'Source Sans — Split', desc: 'Exact Overleaf PDF: split header, tabular skills, 2-line exp' },
  { id: 'compact', label: 'Compact — Dense ATS', desc: '1-page dense ATS, monochrome, tight' },
  { id: 'classic', label: "Jake's — Classic", desc: 'Overleaf Jake 1-col ATS, selectable' },
  { id: 'modern', label: 'AltaCV — Modern', desc: 'Overleaf AltaCV two-column' },
  { id: 'minimal', label: 'ATS Minimal — Clean', desc: 'Overleaf ATS single-col minimal' },
]

export const DEFAULT_TEMPLATE: ResumeTemplateId = 'source-split'
