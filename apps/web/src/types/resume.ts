export type ResumeTemplateId = 'classic' | 'modern' | 'minimal' | 'source-split' | 'compact' | 'custom' | 'asis'

export type OriginalAsset = {
  fileName: string
  mimeType: string
  size: number
  dataUrl: string
  uploadedAt: string
  numPages?: number
  storedInDB?: boolean
}

export type CustomSectionId = 'summary' | 'skills' | 'experience' | 'projects' | 'education' | 'certifications'

export type CustomTemplateConfig = {
  accentColor: string
  fontFamily: 'sans' | 'serif' | 'mono' | 'display'
  background: 'white' | 'soft' | 'gradient'
  density: 'compact' | 'comfortable' | 'spacious'
  sectionOrder: CustomSectionId[]
  hiddenSections: CustomSectionId[]
  headingStyle: 'uppercase' | 'capitalize' | 'normal'
  showIcons: boolean
  showDividers: boolean
  borderStyle: 'none' | 'hairline' | 'accent'
}

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
  customConfig?: CustomTemplateConfig
  originalAsset?: OriginalAsset | null
  latexSource?: string
  updatedAt: string
  // Editable overlay persistence for As-Is PDF/DOCX — key: "page-itemIdx", value: edited text/html
  pdfOverlayEdits?: Record<string, string>
  docxEditedHtml?: string
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
  { id: 'asis', label: 'Original — As Is ★', desc: 'Your uploaded PDF/DOCX exactly as is — every border preserved. Edit overlay & LaTeX.' },
  { id: 'custom', label: 'Custom — Fully Editable ★', desc: 'Drag sections, colors, fonts — change anything.' },
  { id: 'source-split', label: 'Source Sans — Split', desc: 'Exact Overleaf PDF: split header, tabular skills, 2-line exp' },
  { id: 'compact', label: 'Compact — Dense ATS', desc: '1-page dense ATS, monochrome, tight' },
  { id: 'classic', label: "Jake's — Classic", desc: 'Overleaf Jake 1-col ATS, selectable' },
  { id: 'modern', label: 'AltaCV — Modern', desc: 'Overleaf AltaCV two-column' },
  { id: 'minimal', label: 'ATS Minimal — Clean', desc: 'Overleaf ATS single-col minimal' },
]

export const DEFAULT_TEMPLATE: ResumeTemplateId = 'source-split'

export const DEFAULT_CUSTOM_CONFIG: CustomTemplateConfig = {
  accentColor: '#4f46e5',
  fontFamily: 'sans',
  background: 'white',
  density: 'comfortable',
  sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'],
  hiddenSections: [],
  headingStyle: 'uppercase',
  showIcons: false,
  showDividers: true,
  borderStyle: 'hairline',
}

export const CUSTOM_ACCENT_COLORS = ['#4f46e5', '#0ea5e9', '#059669', '#dc2626', '#7c3aed', '#111827']
export const CUSTOM_FONTS: { id: CustomTemplateConfig['fontFamily']; label: string; family: string }[] = [
  { id: 'sans', label: 'Sans', family: "'Inter','Helvetica Neue',Helvetica,Arial,sans-serif" },
  { id: 'serif', label: 'Serif', family: "'Source Serif Pro','Georgia',serif" },
  { id: 'mono', label: 'Mono', family: "'JetBrains Mono','Cascadia Code',monospace" },
  { id: 'display', label: 'Display', family: "'Space Grotesk','Inter',sans-serif" },
]
