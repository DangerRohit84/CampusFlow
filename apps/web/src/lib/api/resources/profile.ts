// lib/api/resources/profile.ts - dashboard/search/AI/profile/resume/reports (SRP extract).
// WHY: profile + resume-studio + discovery flows, one home.
// Moved verbatim from lib/api.ts; AbortSignal threading preserved.
import axios from 'axios'
import { api, API_TIMEOUTS, API_URL } from '../client'
import { groqHeader } from '../groq'
import type { Department } from '../../../types/api'
import type { CodingProfile } from '../../../types/codingProfile'

// Dashboard — signal makes the bundle cancellable so rapid day/college
// switches never resolve out-of-order (stale dashboard after navigation).
export const dashboardAPI = {
  get: (signal?: AbortSignal) => api.get('/user/dashboard', { signal }).then((r) => r.data),
}

// AI
export const aiAPI = {
  summarize: (content: string, type?: string) =>
    api.post('/ai/summarize', { content, type }).then((r) => r.data),
  studyPlan: (subjects: string[], daysLeft: number, hoursPerDay: number) =>
    api.post('/ai/study-plan', { subjects, daysLeft, hoursPerDay }).then((r) => r.data),
  checkConflicts: (dayOfWeek: number, startTime: string, endTime: string, excludeId?: string) =>
    api.post('/ai/check-conflicts', { dayOfWeek, startTime, endTime, excludeId }).then((r) => r.data),
  getInsights: () => api.get('/ai/insights').then((r) => r.data),
}

// Search — cancellable (AbortController) so fast typing never stacks requests
export const searchAPI = {
  search: (q: string, signal?: AbortSignal) =>
    api.get('/search', { params: { q }, signal, timeout: API_TIMEOUTS.default }).then((r) => r.data),
}

// Match AI department codes/abbreviations to actual department names
const DEPT_ABBREV_MAP: Record<string, string> = {
  'CSE': 'computer', 'CS': 'computer', 'COMPUTER SCIENCE': 'computer',
  'IT': 'information tech', 'INFORMATION TECHNOLOGY': 'information tech',
  'ECE': 'electronics', 'ELECTRONICS': 'electronics',
  'EEE': 'electrical', 'ELECTRICAL': 'electrical', 'EE': 'electrical',
  'MECH': 'mechanical', 'ME': 'mechanical', 'MECHANICAL': 'mechanical',
  'CIVIL': 'civil',
  'EIE': 'instrumentation', 'INSTRUMENTATION': 'instrumentation',
  'ISE': 'information sc', 'INFORMATION SCIENCE': 'information sc',
}

export function matchAICodesToDepartments(aiCodes: string[], departments: Department[]): string[] {
  if (!aiCodes?.length || !departments?.length) return []
  if (aiCodes.includes('ALL')) return departments.map((d) => d.name)

  const matched: string[] = []
  for (const code of aiCodes) {
    const normalizedCode = code.toUpperCase().trim()
    const mapped = DEPT_ABBREV_MAP[normalizedCode]
    const dept = departments.find(
      (d) => d.name.toUpperCase() === normalizedCode || d.name.toUpperCase().includes(mapped || normalizedCode)
    )
    if (dept) matched.push(dept.name)
  }
  return matched
}

// Public profile u/:username
export const publicProfileAPI = {
  get: (username: string) => {
    // try authenticated route first, fallback to public via axios without auth if needed
    return api.get(`/u/${encodeURIComponent(username)}`).then(r => r.data).catch(async (e) => {
      if (e.response?.status === 401) {
        // try without auth header via plain axios
        const res = await axios.get(`${API_URL}/u/${encodeURIComponent(username)}`)
        return res.data
      }
      throw e
    })
  },
  // Public unified-heatmap activity for the VIEWED user (feat-public-heatmap).
  // WHY: PublicProfilePage shows the SAME heatmap as CodingProfilePage, so it
  // needs the same trailing-window payload (stored CodingActivity snapshot +
  // live GitHub) scoped to the viewed username. Same shape as
  // codingProfileAPI.getActivity so the page merge stays verbatim (contests
  // come from the main profile payload). Public handles only — no edit/sync.
  // Best-effort: resolves null on any failure so the page keeps the
  // contests-only grid (pre-migration safe, offline safe).
  getActivity: (username: string, opts?: { days?: number }) =>
    api.get(`/u/${encodeURIComponent(username)}/activity`, { params: opts }).then((r) => r.data) as Promise<{
      stored: { date: string; source: string; count: number }[];
      github: { date: string; count: number; level: number }[];
      githubLive: boolean;
      windowDays: number;
      sources: Record<string, boolean>;
      omitted: string[];
      omittedReason: string;
    }>,
  check: (username: string) => axios.get(`${API_URL}/u/check/${encodeURIComponent(username)}`).then(r => r.data),
  suggest: (name: string, email: string) => axios.get(`${API_URL}/u/suggest/one`, { params: { name, email } }).then(r => r.data),
}

// Coding Profile — get() typed so backend CodingProfile.lastSyncError
// (null on success, ≤500ch on total failure) is visible to the UI.
export const codingProfileAPI = {
  get: () => api.get('/coding-profile').then((r) => r.data as CodingProfile),
  update: (data: any) => api.put('/coding-profile', data).then((r) => r.data),
  sync: (auto?: boolean) => api.post('/coding-profile/sync', {}, { params: auto ? { auto: true } : {} }).then((r) => r.data),
  getParticipations: () => api.get('/coding-profile/participations').then((r) => r.data),
  getLeaderboard: (params?: { platform?: string; departmentId?: string; year?: string }) =>
    api.get('/coding-profile/leaderboard', { params }).then((r) => r.data),
  getContestParticipants: (contestId: string) =>
    api.get(`/coding-profile/contest/${contestId}/participants`).then((r) => r.data),
  syncAll: () => api.post('/coding-profile/sync-all').then((r) => r.data),
  getGithubCalendar: (opts?: { days?: number }) =>
    api.get('/coding-profile/github-calendar', { params: opts }).then((r) => r.data) as Promise<{ date: string; count: number; level: number }[]>,
  getGithubForUsername: (username: string, opts?: { days?: number }) =>
    api.get(`/coding-profile/github/${encodeURIComponent(username)}`, { params: opts }).then((r) => r.data) as Promise<{ date: string; count: number; level: number }[]>,
  // Unified heatmap: trailing-window CodingActivity snapshot + live GitHub.
  // Best-effort: resolves null on any failure so the page keeps the
  // contests-only grid (pre-migration safe, offline safe).
  getActivity: (opts?: { days?: number }) =>
    api.get('/coding-profile/activity', { params: opts }).then((r) => r.data) as Promise<{
      stored: { date: string; source: string; count: number }[];
      github: { date: string; count: number; level: number }[];
      githubLive: boolean;
      windowDays: number;
      sources: Record<string, boolean>;
      omitted: string[];
      omittedReason: string;
    }>,
  // Problems-to-Solve MVP: LeetCode daily (20h server cache, stale badge on
  // failure) + curated/live list (real titleSlug links only, paidOnly badged).
  // Rate-safe: the Problems tab calls these once per mount (≤2 calls/page).
  getDailyProblem: () =>
    api.get('/coding-problems/daily').then((r) => r.data) as Promise<{
      problem: { title: string; titleSlug: string; url: string; difficulty: string | null; date: string | null; questionId: string | null; paidOnly?: boolean } | null;
      stale: boolean;
      cachedAt: string | null;
      source: string;
    }>,
  getProblemsList: (params?: { live?: boolean; topic?: string; difficulty?: string; search?: string; limit?: number; skip?: number }) =>
    api.get('/coding-problems/list', { params }).then((r) => r.data) as Promise<{
      source: 'curated' | 'live';
      items: { title: string; titleSlug: string; difficulty: string; topics: string[]; paidOnly?: boolean; url: string }[];
      total: number;
      stale: boolean;
      cachedAt: string | null;
    }>,
  // Sheets browser (§3): static ordered tracks (Striver A2Z / SDE, NeetCode
  // 150 — titles+links only). Static import server-side, 24h HTTP cache.
  // Progress stays localStorage-only (see lib/sheets.ts) — never synced.
  getSheets: () =>
    api.get('/coding-problems/sheets').then((r) => r.data) as Promise<{
      tracks: { id: string; name: string; sourceName: string; sourceUrl: string; credit: string; originalCount: number; steps: { id: string; title: string; order: number; items: { order: number; title: string; sourceUrl: string; topic: string; difficulty: string; cfKey?: string; a2ojDifficulty?: number }[] }[] }[];
      totalTracks: number;
      totalProblems: number;
      source: 'static';
      cachedAt: string | null;
    }>,
  // Sheets auto-mark (§4): solved feeds for the linked handles (CF
  // full-history solvedKeys + LC recent-20 solved slugs). Best-effort 200 —
  // empty solved on missing handles/upstream blips (manual-only fallback).
  // Rate-safe: 10min per-handle server cache, CF through the shared 2s gate;
  // the tab calls this at most once per mount.
  getAutomark: () =>
    api.get('/coding-problems/automark').then((r) => r.data) as Promise<{
      cf: { handle: string | null; solvedKeys: string[]; stale: boolean; cachedAt: string | null; rateLimited?: boolean; error?: string };
      lc: { handle: string | null; solved: { slug: string; solvedAtMs: number }[]; stale: boolean; cachedAt: string | null; note?: string; error?: string };
      omitted: string[];
      omittedReason: string;
    }>,
}

// Resume Studio — LaTeX vector + AI + Parse
export const resumeAPI = {
  // Returns { latex, filename, size } — Classic ATS Jake single-col
  getLatex: (data: any) => api.post('/resume/latex', data).then((r) => r.data),

  // Download .tex via backend (fallback handled caller-side)
  downloadTex: async (data: any, filename?: string) => {
    const res = await api.post('/resume/latex?format=tex', data, { responseType: 'blob' })
    const blob = new Blob([res.data], { type: 'application/x-tex;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = (res.headers as any)['content-disposition'] || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.download = filename || (m ? m[1] : `${(data.personalInfo?.fullName || 'Resume').replace(/\s+/g, '_')}_Resume.tex`)
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => window.URL.revokeObjectURL(url), 2000)
    return true
  },

  // Vector selectable PDF via backend (pdfkit + pdflatex fallback). If backend unavailable, caller falls back to client jsPDF
  downloadVectorPdf: async (data: any, filename?: string) => {
    const res = await api.post('/resume/latex?format=pdf', data, { responseType: 'blob' })
    // If backend returned JSON error as blob, try parse
    const ct = (res.headers as any)['content-type'] || ''
    if (ct.includes('application/json')) {
      const text = await (res.data as Blob).text()
      const j = JSON.parse(text)
      throw new Error(j.error || 'PDF failed')
    }
    const blob = new Blob([res.data], { type: 'application/pdf' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = (res.headers as any)['content-disposition'] || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.download = filename || (m ? m[1] : `${(data.personalInfo?.fullName || 'Resume').replace(/\s+/g, '_')}_Resume_Vector.pdf`)
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => window.URL.revokeObjectURL(url), 2000)
    return true
  },

  // DOCX export — mirror jsPDF templates via docx Document/Paragraph
  downloadDocx: async (data: any, filename?: string) => {
    const res = await api.post('/resume/export-docx', data, { responseType: 'blob' })
    const ct = (res.headers as any)['content-type'] || ''
    if (ct.includes('application/json')) {
      const text = await (res.data as Blob).text()
      const j = JSON.parse(text)
      throw new Error(j.error || 'DOCX failed')
    }
    const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = (res.headers as any)['content-disposition'] || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.download = filename || (m ? m[1] : `${(data.personalInfo?.fullName || 'Resume').replace(/\s+/g, '_')}_Resume.docx`)
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => window.URL.revokeObjectURL(url), 2000)
    return true
  },
  downloadTxt: async (data: any, filename?: string) => {
    const res = await api.post('/resume/export-txt', data, { responseType: 'blob' })
    const ct = (res.headers as any)['content-type'] || ''
    if (ct.includes('application/json')) {
      const text = await (res.data as Blob).text()
      const j = JSON.parse(text)
      throw new Error(j.error || 'TXT failed')
    }
    const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const cd = (res.headers as any)['content-disposition'] || ''
    const m = cd.match(/filename="([^"]+)"/)
    a.download = filename || (m ? m[1] : `${(data.personalInfo?.fullName || 'Resume').replace(/\s+/g, '_')}_Resume.txt`)
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => window.URL.revokeObjectURL(url), 2000)
    return true
  },

  // Probe health
  health: () => api.get('/resume/latex/health').then((r) => r.data),

  // AI upgrade — mode: summary|bullets|skills|full|tailor|upgrade — requires per-user Groq key (spec)
  aiUpgrade: (payload: { data: any; mode?: string; jobDescription?: string; prompt?: string; targetId?: string }) =>
    api.post('/resume/ai-upgrade', payload, { headers: { ...groqHeader() } as any }).then((r) => r.data),
  aiEnhance: (payload: { data: any; mode?: string; jobDescription?: string; prompt?: string; targetId?: string }) =>
    api.post('/resume/ai-upgrade', payload, { headers: { ...groqHeader() } as any }).then((r) => r.data),
  atsScore: (payload: { data: any; jobDescription?: string }) =>
    api.post('/resume/ats-score', payload, { headers: { ...groqHeader() } as any }).then((r) => r.data),

  // Parse uploaded resume — PDF/DOCX/TXT → ResumeData — heuristic works without API, AI structuring needs per-user key
  parseResume: async (file: File) => {
    const fd = new FormData()
    fd.append('resume', file)
    const res = await api.post('/resume/parse', fd, { headers: { 'Content-Type': undefined, ...groqHeader() } as any })
    return res.data as { data: any; rawText: string; heuristic: boolean; usedAI: boolean; hasGroq?: boolean; placeholder?: string }
  },
  parseText: (rawText: string) =>
    api.post('/resume/parse-text', { rawText }, { headers: { ...groqHeader() } as any }).then((r) => r.data),

  // Resume depth (#10) — JD scrape + cover letter + GitHub import
  // JD scrape returns verbatim stripped text (grounded, no AI/hallucination)
  scrapeJd: (url: string) =>
    api.post('/resume/jd-scrape', { url }, { headers: { ...groqHeader() } as any }).then((r) => r.data as { text: string; length: number; truncated: boolean; sourceUrl: string }),
  // Cover letter grounded in resume + JD (AI when user key present, heuristic fallback)
  coverLetter: (payload: { data: any; jobDescription: string; tone?: 'professional' | 'enthusiastic' | 'concise' }) =>
    api.post('/resume/cover-letter', payload, { headers: { ...groqHeader() } as any }).then((r) => r.data as { letter: string; usedAI: boolean; hasGroq?: boolean; heuristic?: boolean; placeholder?: string }),
  // Public GitHub repos for import (no token)
  githubRepos: (username: string, limit = 12) =>
    api.get(`/resume/github-repos/${encodeURIComponent(username.trim())}`, { params: { limit }, headers: { ...groqHeader() } as any }).then((r) => r.data as { repos: { name: string; description: string; language: string; stars: number; forks: number; url: string; homepage: string; updatedAt: string; topics: string[] }[]; username: string; count: number }),
  parseUpload: async (file: File) => {
    const fd = new FormData()
    fd.append('resume', file)
    const res = await api.post('/resume/parse', fd, { headers: { 'Content-Type': undefined, ...groqHeader() } as any })
    return res.data
  },
  // Convert PDF/Image/DOCX/TXT → LaTeX code — vision & AI text->LaTeX need per-user Groq key + global model
  convertToLatex: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post('/resume/convert-to-latex', fd, { headers: { 'Content-Type': undefined, ...groqHeader() } as any, timeout: 90000 })
    return res.data as { latex: string; rawText: string; data: any; usedAI: boolean; method: string; hasGroq: boolean; fileName: string; placeholder?: string }
  },
  convertTextToLatex: (rawText: string) =>
    api.post('/resume/convert-to-latex', { rawText }, { headers: { ...groqHeader() } as any, timeout: 90000 }).then((r) => r.data as { latex: string; rawText: string; data: any; usedAI: boolean; method: string; hasGroq?: boolean }),
  convertHealth: () => api.get('/resume/convert-to-latex/health', { headers: { ...groqHeader() } as any }).then((r) => r.data),
}

// Reports — college vs website scope, bug/design/etc categories
export const reportAPI = {
  create: (data: { scope: string; issueType: string; collegeId?: string | null; title: string; description: string; priority: string; attachmentUrl?: string | null }) =>
    api.post('/reports', data).then(r => r.data),
  list: (params?: { scope?: string; status?: string; issueType?: string; priority?: string; collegeId?: string; search?: string; page?: number; limit?: number; signal?: AbortSignal }) => {
    const { signal, ...query } = (params ?? {}) as Record<string, unknown>
    return api.get('/reports', { params: query, signal: signal as AbortSignal | undefined }).then(r => r.data)
  },
  getOne: (id: string) => api.get(`/reports/${id}`).then(r => r.data),
  updateStatus: (id: string, status: string) => api.patch(`/reports/${id}/status`, { status }).then(r => r.data),
  delete: (id: string) => api.delete(`/reports/${id}`).then(r => r.data),
}

// POST /coding-profile/sync returns 202 and runs server-side; poll until
// lastSyncedAt advances past the baseline (or give up after maxTries).
// 429 backoff (Too-many-requests fix): the old fixed 2s×30 setInterval kept
// hammering GET /coding-profile straight through a 429 (each poll = 1 hit on
// the shared generalLimiter bucket). Now a setTimeout chain: base 2s, double
// on 429 up to 10s, and honor Retry-After when the backend sends it.
export function waitForCodingSync(
  baseline: number,
  opts?: { intervalMs?: number; maxTries?: number }
): Promise<{ completed: boolean; profile: any }> {
  const baseMs = opts?.intervalMs ?? 2000
  const maxTries = opts?.maxTries ?? 30
  const MAX_DELAY_MS = 10_000
  return new Promise((resolve) => {
    let tries = 0
    let delay = baseMs
    let stopped = false
    const step = async () => {
      if (stopped) return
      tries++
      try {
        const p = await codingProfileAPI.get()
        const last = p?.lastSyncedAt ? new Date(p.lastSyncedAt).getTime() : 0
        if (last > baseline) {
          stopped = true
          resolve({ completed: true, profile: p })
          return
        }
        delay = baseMs // success resets backoff
      } catch (e: any) {
        // 429 → back off (exponential to 10s) + honor Retry-After seconds.
        const status = e?.response?.status
        if (status === 429) {
          const retrySec =
            (typeof e?.response?.data?.retryAfterSec === 'number' && e.response.data.retryAfterSec) ||
            parseInt(e?.response?.headers?.['retry-after'] || '', 10)
          if (Number.isFinite(retrySec) && (retrySec as number) > 0) {
            delay = Math.min(MAX_DELAY_MS, Math.max(delay, (retrySec as number) * 1000))
          } else {
            delay = Math.min(MAX_DELAY_MS, delay * 2)
          }
        }
        /* other transient poll errors are ignored (same as before) */
      }
      if (tries >= maxTries) {
        stopped = true
        resolve({ completed: false, profile: null })
        return
      }
      setTimeout(step, delay)
    }
    setTimeout(step, delay)
  })
}
