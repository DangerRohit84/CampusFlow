import type { ResumeData, PortfolioData } from '../types/resume'
import { DEFAULT_CUSTOM_CONFIG } from '../types/resume'

function getResumeKey(userId: string) {
  return `campusflow:resume:${userId || 'default'}`
}
function getPortfolioKey(userId: string) {
  return `campusflow:portfolio:${userId || 'default'}`
}

export function saveResume(userId: string, data: ResumeData): void {
  try {
    const key = getResumeKey(userId)
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (e: any) {
      const isQuota = String(e?.name || '').includes('Quota') || String(e?.message || '').includes('quota') || String(e).includes('Quota')
      if (isQuota && data.originalAsset?.dataUrl && data.originalAsset.dataUrl.length > 500_000) {
        console.warn('saveResume quota hit — stripping originalAsset dataUrl, keeping metadata; blob remains in IndexedDB')
        const stripped = { ...data, originalAsset: data.originalAsset ? { ...data.originalAsset, dataUrl: '', storedInDB: true } : null }
        try {
          localStorage.setItem(key, JSON.stringify(stripped))
          return
        } catch (e2) {
          console.warn('saveResume still failed after strip', e2)
          throw e2
        }
      }
      console.warn('saveResume failed', e)
      throw e
    }
  } catch (e) {
    console.warn('saveResume failed outer', e)
    throw e
  }
}

export function loadResume(userId: string): ResumeData | null {
  try {
    const key = getResumeKey(userId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: any = JSON.parse(raw) as ResumeData
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.certifications)) parsed.certifications = []
    if (!parsed.template) parsed.template = 'source-split'
    if (!Array.isArray(parsed.skills)) parsed.skills = []
    if (!Array.isArray(parsed.projects)) parsed.projects = []
    if (!Array.isArray(parsed.experience)) parsed.experience = []
    if (!Array.isArray(parsed.education)) parsed.education = []
    if (!parsed.personalInfo?.links) parsed.personalInfo.links = [{ label: 'LinkedIn', url: '' }]
    // Custom template config defaults / migration
    if (parsed.template === 'custom' || parsed.template === 'asis') {
      if (!parsed.customConfig || typeof parsed.customConfig !== 'object') parsed.customConfig = { ...DEFAULT_CUSTOM_CONFIG }
      else {
        parsed.customConfig = { ...DEFAULT_CUSTOM_CONFIG, ...parsed.customConfig }
        if (!Array.isArray(parsed.customConfig.sectionOrder)) parsed.customConfig.sectionOrder = [...DEFAULT_CUSTOM_CONFIG.sectionOrder]
        if (!Array.isArray(parsed.customConfig.hiddenSections)) parsed.customConfig.hiddenSections = []
      }
    }
    if (parsed.template === 'asis' && !parsed.originalAsset) {
      // keep asis template even without asset — will show placeholder
    }
    if (parsed.originalAsset && typeof parsed.originalAsset === 'object') {
      if (!parsed.originalAsset.dataUrl) parsed.originalAsset.dataUrl = ''
      if (!parsed.originalAsset.uploadedAt) parsed.originalAsset.uploadedAt = new Date().toISOString()
    }
    if (typeof parsed.latexSource !== 'string') parsed.latexSource = parsed.latexSource || undefined
    return parsed as ResumeData
  } catch {
    return null
  }
}

export function clearResume(userId: string): void {
  try {
    localStorage.removeItem(getResumeKey(userId))
  } catch {}
}

export function savePortfolio(userId: string, data: PortfolioData): void {
  try {
    localStorage.setItem(getPortfolioKey(userId), JSON.stringify(data))
  } catch (e) {
    console.warn('savePortfolio failed', e)
    throw e
  }
}

export function loadPortfolio(userId: string): PortfolioData | null {
  try {
    const raw = localStorage.getItem(getPortfolioKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as PortfolioData
  } catch {
    return null
  }
}

export function clearPortfolio(userId: string): void {
  try {
    localStorage.removeItem(getPortfolioKey(userId))
  } catch {}
}

export function emptyResumeData(user?: { name?: string; email?: string }): ResumeData {
  return {
    personalInfo: {
      fullName: user?.name || '',
      email: user?.email || '',
      phone: '',
      location: '',
      headline: '',
      summary: '',
      links: [{ label: 'LinkedIn', url: '' }],
    },
    skills: [],
    projects: [],
    experience: [],
    education: [],
    certifications: [],
    template: 'source-split',
    customConfig: { ...DEFAULT_CUSTOM_CONFIG },
    originalAsset: null,
    latexSource: undefined,
    updatedAt: new Date().toISOString(),
  }
}

export function createPortfolioData(userId: string, resume: ResumeData, themeId: string): PortfolioData {
  return {
    id: `portfolio-${Date.now()}`,
    userId,
    resumeId: null,
    themeId,
    slug: null,
    publicUrl: null,
    importedAt: new Date().toISOString(),
    publishedAt: null,
    data: resume,
  }
}
