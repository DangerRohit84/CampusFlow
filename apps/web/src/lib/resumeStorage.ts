import type { ResumeData, PortfolioData } from '../types/resume'

function getResumeKey(userId: string) {
  return `campusflow:resume:${userId || 'default'}`
}
function getPortfolioKey(userId: string) {
  return `campusflow:portfolio:${userId || 'default'}`
}

export function saveResume(userId: string, data: ResumeData): void {
  try {
    const key = getResumeKey(userId)
    localStorage.setItem(key, JSON.stringify(data))
  } catch (e) {
    console.warn('saveResume failed', e)
    throw e
  }
}

export function loadResume(userId: string): ResumeData | null {
  try {
    const key = getResumeKey(userId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ResumeData
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
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
    template: 'classic',
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
