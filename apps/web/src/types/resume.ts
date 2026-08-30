export type ResumeTemplateId = 'classic' | 'modern' | 'minimal'

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

export type ResumeData = {
  personalInfo: ResumePersonalInfo
  skills: string[]
  projects: ResumeProject[]
  experience: ResumeExperience[]
  education: ResumeEducation[]
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
  { id: 'classic', label: 'Classic ATS', desc: 'Single column, ATS-friendly' },
  { id: 'modern', label: 'Modern', desc: 'Header accent, pill skills' },
  { id: 'minimal', label: 'Minimal Sidebar', desc: 'Left sidebar, clean' },
]

export const DEFAULT_TEMPLATE: ResumeTemplateId = 'classic'
