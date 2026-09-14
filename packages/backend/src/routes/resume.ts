import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import multer from 'multer'
import { generateResumeLatex } from '../services/resumeLatex'
import { generateVectorPdfBuffer, generateResumePdfBuffer, generateResumePdfWithMeta } from '../services/resumePdf'
import { convertFileToLatex, getResumeGlobalModelInfo, getCanvasAvailable } from '../services/resumeConvert'
import { scrapeJdUrl, heuristicCoverLetter, fetchGithubRepos } from '../services/resumeDepth'
import { aiChat, aiChatWithUserKey } from '../ai/client'
import { config } from '../config'
import { authenticate, AuthRequest } from '../middleware/auth'
import { aiQuota } from '../middleware/aiQuota'
import { validateUploadMagicBytes } from '../utils/uploadScan'
import prisma from '../config/db'
import { logger } from '../utils/logger'

// Helper: extract per-user Groq API key from request (header X-GROQ-API-KEY or body field)
// Per spec: user/student adds their own Groq key in Settings → AI; remaining features work without it.
// Backend reads from header X-GROQ-API-KEY (set by frontend from localStorage campusflow:groq-key) or from
// authenticated user's stored preferences/UserIntegration if available. Superadmin's AI Manager provides global model.
function extractUserGroqKey(req: Request): string | null {
  const h = (req.headers['x-groq-api-key'] || req.headers['x-groq-key'] || req.headers['x-groq-apikey'] || '') as string
  if (h && String(h).trim().length > 10) return String(h).trim()
  // Body fields (for JSON uploads)
  const bodyKey = (req.body as any)?.groqApiKey || (req.body as any)?.groqKey || (req.body as any)?.userGroqKey
  if (bodyKey && String(bodyKey).trim().length > 10) return String(bodyKey).trim()
  // Query param fallback
  const q = (req.query as any)?.groqApiKey || (req.query as any)?.groqKey
  if (q && String(q).trim().length > 10) return String(q).trim()
  return null
}

async function extractUserGroqKeyWithDb(req: AuthRequest): Promise<string | null> {
  const fromHeader = extractUserGroqKey(req as Request)
  if (fromHeader) return fromHeader
  // Try fetching from authenticated user's preferences (User.preferences JSON may contain groqApiKey)
  // or UserIntegration type 'groq'
  if (req.userId) {
    try {
      // HALF2: parallel independent reads (was 2 sequential awaits) + narrow selects preserved
      const [user, integ] = await Promise.all([
        prisma.user.findUnique({ where: { id: req.userId }, select: { preferences: true } as any }),
        prisma.userIntegration.findFirst({ where: { userId: req.userId, type: 'groq' } as any }).catch(()=>null),
      ])
      const userTyped: any = user
      if (userTyped?.preferences) {
        try {
          const prefs = typeof userTyped.preferences === 'string' ? JSON.parse(userTyped.preferences) : userTyped.preferences
          if (prefs?.groqApiKey && String(prefs.groqApiKey).trim().length > 10) return String(prefs.groqApiKey).trim()
          if (prefs?.aiConfig?.groqApiKey && String(prefs.aiConfig.groqApiKey).trim().length > 10) return String(prefs.aiConfig.groqApiKey).trim()
        } catch {}
      }
      if ((integ as any)?.accessToken && String((integ as any).accessToken).trim().length > 10) return String((integ as any).accessToken).trim()
    } catch {}
  }
  return null
}

const router = Router()

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resume exports, please slow down' },
})

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests, please slow down' },
})

const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many parse requests, please slow down' },
})

const convertLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many convert requests, please slow down' },
})

const jdScrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many JD fetch requests, please slow down' },
})

const githubReposLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many GitHub requests, please slow down' },
})

const personalInfoSchema = z.object({
  fullName: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  headline: z.string().default(''),
  summary: z.string().default(''),
  links: z
    .array(z.object({ label: z.string(), url: z.string() }))
    .default([])
    .catch([]),
})

const projectSchema = z.object({
  id: z.string(),
  title: z.string().default(''),
  description: z.string().default(''),
  tech: z.array(z.string()).default([]),
  link: z.string().optional().or(z.literal('')),
  date: z.string().optional().or(z.literal('')),
})

const experienceSchema = z.object({
  id: z.string(),
  role: z.string().default(''),
  company: z.string().default(''),
  location: z.string().optional().or(z.literal('')),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  bullets: z.array(z.string()).default([]),
})

const educationSchema = z.object({
  id: z.string(),
  degree: z.string().default(''),
  school: z.string().default(''),
  location: z.string().optional().or(z.literal('')),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  cgpa: z.string().optional().or(z.literal('')),
})

const certificationSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  issuer: z.string().optional().or(z.literal('')),
  date: z.string().optional().or(z.literal('')),
  url: z.string().optional().or(z.literal('')),
})

// Helper to treat empty string / null as undefined so zod defaults fire (FormData sends "" for cleared fields, frontend may send null)
const emptyStrToUndef = (v: unknown) => (v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? undefined : v)

const resumeSchema = z.object({
  personalInfo: personalInfoSchema,
  skills: z.array(z.string()).default([]),
  projects: z.array(projectSchema).default([]),
  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  certifications: z.array(certificationSchema).optional().default([]),
  template: z.preprocess(emptyStrToUndef, z.enum(['classic', 'modern', 'minimal', 'source-split', 'compact', 'custom']).optional().default('source-split')),
  updatedAt: z.string().optional(),
})

function safeFilename(name: string, ext: string): string {
  const base = (name || 'Resume').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'Resume'
  return `${base}_Resume${ext}`
}

// ===================== AI HELPERS =====================

const NOT_CONFIGURED = 'AI provider not configured. Please set up a provider in AI Manager.'

function heuristicAtsScore(data: any, jd?: string) {
  let score = 0
  const breakdown: Record<string, number> = {}
  const suggestions: string[] = []
  const max = 100

  // Personal info completeness 15
  const p = data.personalInfo || {}
  let personalScore = 0
  if (p.fullName?.trim()) personalScore += 4
  else suggestions.push('Add your full name')
  if (p.email?.trim()) personalScore += 4
  else suggestions.push('Add email address')
  if (p.phone?.trim()) personalScore += 2
  if (p.headline?.trim()) personalScore += 3
  else suggestions.push('Add a headline (e.g., B.Tech CSE | Frontend Developer)')
  if (p.links?.some((l: any) => l.url?.trim())) personalScore += 2
  else suggestions.push('Add LinkedIn/GitHub links')
  breakdown['Contact & Links'] = personalScore
  score += personalScore

  // Summary 10
  let summaryScore = 0
  if (p.summary?.trim()) {
    const len = p.summary.trim().length
    if (len < 80) {
      summaryScore = 5
      suggestions.push('Expand summary to 2-3 impactful lines with quantified strengths')
    } else if (len > 400) {
      summaryScore = 6
      suggestions.push('Shorten summary — keep it to 3 lines max, avoid filler')
    } else summaryScore = 10
  } else {
    suggestions.push('Add a 2-3 line summary tailored to your target role')
  }
  breakdown['Summary'] = summaryScore
  score += summaryScore

  // Skills 15
  let skillsScore = 0
  const skills = data.skills || []
  if (skills.length === 0) suggestions.push('Add at least 8-12 relevant skills')
  else if (skills.length < 5) {
    skillsScore = 7
    suggestions.push('Add more relevant skills — aim for 8-12 covering tools + domain')
  } else if (skills.length > 20) {
    skillsScore = 12
    suggestions.push('Trim skills to most relevant 12-15 — avoid keyword stuffing')
  } else skillsScore = 15
  breakdown['Skills'] = skillsScore
  score += skillsScore

  // Experience 25
  let expScore = 0
  const exps = data.experience || []
  if (exps.length === 0) {
    suggestions.push('Add experience/internships — even academic or volunteer work')
  } else {
    const bullets = exps.flatMap((e: any) => e.bullets || []).filter(Boolean)
    if (bullets.length === 0) {
      expScore = 8
      suggestions.push('Add bullets with STAR + metrics (e.g., Built X, improved Y by Z%)')
    } else if (bullets.length < 3) {
      expScore = 14
      suggestions.push('Add 3-5 quantified bullets per role using action verbs')
    } else {
      const hasMetrics = bullets.some((b: string) => /\d+%|\d+\+|increased|reduced|built|led|improved/i.test(b))
      expScore = hasMetrics ? 25 : 18
      if (!hasMetrics) suggestions.push('Quantify bullets — add numbers, %, or impact (e.g., reduced load time by 30%)')
    }
  }
  breakdown['Experience'] = expScore
  score += expScore

  // Projects 15
  let projScore = 0
  const projs = data.projects || []
  if (projs.length === 0) suggestions.push('Add 2-3 projects with tech stack + links')
  else if (projs.length === 1) projScore = 8
  else projScore = 15
  if (projs.length > 0) {
    const missingTech = projs.some((p: any) => !p.tech?.length)
    const missingLink = projs.some((p: any) => !p.link?.trim())
    const missingDesc = projs.some((p: any) => !p.description?.trim())
    if (missingTech) suggestions.push('Add tech stack per project (helps ATS keyword match)')
    if (missingLink) suggestions.push('Add GitHub/demo links for projects')
    if (missingDesc) suggestions.push('Add 1-2 line description per project')
  }
  // only add if not set
  if (projs.length > 0 && projScore === 0) projScore = 8
  if (projs.length >= 2) projScore = 15
  breakdown['Projects'] = projScore
  score += projScore

  // Education 10
  let eduScore = 0
  const edus = data.education || []
  if (edus.length === 0) {
    suggestions.push('Add education with degree, school, and CGPA')
  } else {
    const hasCGPA = edus.some((e: any) => e.cgpa?.trim())
    eduScore = hasCGPA ? 10 : 7
    if (!hasCGPA) suggestions.push('Add CGPA/percentage for education — recruiters filter on it')
  }
  breakdown['Education'] = eduScore
  score += eduScore

  // Formatting 10
  let fmtScore = 10
  if (skills.length > 25) fmtScore -= 2
  if ((p.summary?.length || 0) > 600) fmtScore -= 2
  breakdown['Formatting'] = fmtScore
  score += fmtScore

  // Clamp
  score = Math.max(0, Math.min(100, score))

  // JD keyword overlap boost/suggestion
  let jdBonus = 0
  let jdKeywords: string[] = []
  if (jd?.trim()) {
    const jdTokens = jd.toLowerCase().match(/[a-z0-9+#.]{2,}/g) || []
    const stop = new Set(['and','the','for','with','you','are','will','have','this','that','from','role','work','team','experience','required','preferred'])
    const jdSet = new Set(jdTokens.filter(t => t.length > 2 && !stop.has(t)))
    jdKeywords = Array.from(jdSet).slice(0, 30)
    const resumeText = JSON.stringify(data).toLowerCase()
    const matched = jdKeywords.filter(k => resumeText.includes(k))
    const missing = jdKeywords.filter(k => !resumeText.includes(k)).slice(0, 8)
    jdBonus = Math.round((matched.length / Math.max(1, jdKeywords.length)) * 10)
    // Don't add to score, but report
    if (missing.length) suggestions.unshift(`JD keywords missing: ${missing.join(', ')} — add where truthful`)
    if (matched.length) suggestions.push(`JD match: ${matched.length}/${jdKeywords.length} keywords present — good`)
  }

  let level: string
  if (score >= 85) level = 'Excellent — ready to apply'
  else if (score >= 70) level = 'Good — minor tweaks will push to 85+'
  else if (score >= 50) level = 'Average — address suggestions to improve ATS pass rate'
  else level = 'Needs work — follow suggestions top to bottom'

  return {
    score,
    level,
    breakdown,
    suggestions: suggestions.slice(0, 10),
    jdKeywords,
    jdBonus,
    max,
  }
}

function heuristicEnhanceSummary(summary: string): string {
  if (!summary?.trim()) {
    return 'Results-driven B.Tech student with hands-on experience building full-stack web apps (React, Node.js, PostgreSQL). Passionate about clean code, performance, and shipping user-centric features. Seeking SDE intern role to deliver measurable impact.'
  }
  // Polish: trim filler, add action, ensure 2-3 lines
  let s = summary.trim().replace(/\s+/g, ' ')
  if (!/[.]$/.test(s)) s += '.'
  // If short, append value add
  if (s.length < 120) {
    s += ' Focused on scalable architecture, collaborative teamwork, and continuous learning.'
  }
  // Capitalize first letter
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function heuristicImproveBullets(bullets: string[]): string[] {
  const verbs = ['Built', 'Developed', 'Implemented', 'Optimized', 'Designed', 'Automated', 'Led', 'Improved']
  return bullets.map((b, i) => {
    let t = (b || '').trim()
    if (!t) return 'Contributed to team deliverables and improved code quality via reviews and testing.'
    // Ensure starts with verb
    if (!/^[A-Z]/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1)
    if (!/^(Built|Developed|Implemented|Designed|Optimized|Led|Managed|Created|Automated|Improved|Increased|Reduced)/i.test(t)) {
      t = `${verbs[i % verbs.length]} ${t.charAt(0).toLowerCase() + t.slice(1)}`
    }
    // Add quantification hint if missing numbers
    if (!/\d/.test(t) && t.length < 80) {
      t += ' — delivered on time with 100% test coverage.'
    }
    if (!/[.]$/.test(t)) t += '.'
    return t
  })
}

function heuristicParseTextToResumeData(rawText: string, fallbackName?: string): any {
  const text = rawText || ''
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Extract email
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const email = emailMatch ? emailMatch[0] : ''

  // Phone
  const phoneMatch = text.match(/(\+91[\s-]?)?[6-9]\d{9}|\(\d{3}\)\s*\d{3}-\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/)
  const phone = phoneMatch ? phoneMatch[0].trim() : ''

  // Links
  const urlRegex = /https?:\/\/[^\s)]+/g
  const urls = (text.match(urlRegex) || []).slice(0, 6)
  const links = urls.map((url, idx) => {
    let label = 'Link'
    if (url.includes('linkedin')) label = 'LinkedIn'
    else if (url.includes('github')) label = 'GitHub'
    else if (url.includes('portfolio')) label = 'Portfolio'
    else label = `Link ${idx + 1}`
    return { label, url: url.replace(/[.,;]+$/, '') }
  })
  if (links.length === 0) links.push({ label: 'LinkedIn', url: '' })

  // Name: heuristic — first line with 2 words and mostly letters, not containing email/phone
  let fullName = fallbackName || ''
  if (!fullName) {
    for (const l of lines.slice(0, 5)) {
      if (l.length > 40) continue
      if (email && l.includes(email)) continue
      if (/@/.test(l)) continue
      if (/^\d/.test(l)) continue
      if (/(resume|cv|curriculum)/i.test(l)) continue
      const words = l.split(/\s+/).filter(Boolean)
      if (words.length >= 2 && words.length <= 4 && /^[A-Za-z\s'.-]+$/.test(l) && l === l.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').split(' ').join(' ') ) {
        // Check caps pattern lenient
        fullName = l
        break
      }
      if (words.length >= 2 && words.length <= 4 && /^[A-Za-z\s'.-]+$/.test(l)) {
        // fallback pick first plausible
        if (!fullName) fullName = l
      }
    }
    if (!fullName && lines[0] && lines[0].length < 40) fullName = lines[0]
  }

  // Location heuristic — look for city, India pattern
  const locMatch = text.match(/\b(Delhi|Mumbai|Bengaluru|Bangalore|Hyderabad|Chennai|Pune|Kolkata|Noida|Gurgaon|Jaipur|Ahmedabad|India)\b[^.\n]{0,20}/i)
  const location = locMatch ? locMatch[0].trim().slice(0, 60) : ''

  // Headline heuristic — line after name that looks like role
  let headline = ''
  if (fullName) {
    const idx = lines.findIndex(l => l === fullName)
    if (idx >= 0 && lines[idx + 1] && lines[idx + 1].length < 80 && /(developer|engineer|student|intern|designer|analyst|science|technology|frontend|backend|full.stack)/i.test(lines[idx + 1])) {
      headline = lines[idx + 1].slice(0, 100)
    }
  }

  // Summary — gather paragraph after SUMMARY heading or first 2-3 sentences after headline
  let summary = ''
  const summaryIdx = lines.findIndex(l => /^summary|objective|about/i.test(l))
  if (summaryIdx >= 0) {
    summary = lines.slice(summaryIdx + 1, summaryIdx + 4).join(' ').slice(0, 500)
  } else if (lines.length > 3) {
    // Take early paragraph that is longer
    const candidate = lines.find(l => l.split(' ').length > 12 && l.length > 80 && l.length < 500)
    if (candidate) summary = candidate.slice(0, 500)
  }

  // Skills — hunt for SKILLS section
  let skills: string[] = []
  const skillsIdx = lines.findIndex(l => /^skills/i.test(l))
  if (skillsIdx >= 0) {
    const skillLines = lines.slice(skillsIdx + 1, skillsIdx + 5).join(' ')
    // Split by comma, bullet, pipe
    skills = skillLines.split(/[,•|·;/\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 20)
    // Filter out obvious non-skills (long sentences)
    skills = skills.filter(s => s.length < 30 && s.split(' ').length <= 3)
  } else {
    // Fallback: extract known tech tokens
    const known = ['JavaScript','TypeScript','React','Node.js','Express','Python','Java','C++','C','SQL','PostgreSQL','MongoDB','Docker','AWS','Git','HTML','CSS','Tailwind','Next.js','Vue','Angular','Spring','Django','Flask','Kubernetes','GraphQL','REST','Redux','Prisma','NestJS','Figma','Photoshop']
    const lowerText = text.toLowerCase()
    skills = known.filter(k => lowerText.includes(k.toLowerCase())).slice(0, 15)
  }

  // Simple section splitters for experience/projects/education — keep heuristic minimal, let AI refine if available
  // We'll leave those empty for user to fill, but try to scrape experience headers
  const projects: any[] = []
  const projIdx = lines.findIndex(l => /^projects?/i.test(l))
  if (projIdx >= 0) {
    // Grab next lines as project titles until next heading
    let count = 0
    for (let i = projIdx + 1; i < lines.length && count < 3; i++) {
      const l = lines[i]
      if (/^(experience|education|skills|certifications|achievements)/i.test(l)) break
      if (l.length < 5 || l.length > 80) continue
      if (/^(•|-)/.test(l)) continue
      projects.push({ id: Date.now().toString() + count, title: l.slice(0, 80), description: '', tech: [], link: '', date: '' })
      count++
    }
  }

  const experience: any[] = []
  const expIdx = lines.findIndex(l => /^(experience|work)/i.test(l))
  if (expIdx >= 0) {
    let count = 0
    for (let i = expIdx + 1; i < lines.length && count < 2; i++) {
      const l = lines[i]
      if (/^(education|projects?|skills)/i.test(l)) break
      if (l.length < 10 || l.length > 100) continue
      experience.push({ id: (Date.now()+100+count).toString(), role: l.slice(0, 60), company: '', location: '', startDate: '', endDate: '', bullets: [''] })
      count++
    }
  }

  const education: any[] = []
  const eduIdx = lines.findIndex(l => /^education/i.test(l))
  if (eduIdx >= 0) {
    let count = 0
    for (let i = eduIdx + 1; i < lines.length && count < 2; i++) {
      const l = lines[i]
      if (/^(experience|projects?|skills|certifications)/i.test(l)) break
      if (l.length < 8 || l.length > 100) continue
      // Look for degree keywords
      if (/(b\.?tech|m\.?tech|bachelor|master|b\.?sc|m\.?sc|mba|bca|mca)/i.test(l) || count === 0) {
        education.push({ id: (Date.now()+200+count).toString(), degree: l.slice(0, 80), school: lines[i+1]?.slice(0, 80) || '', location: '', startDate: '', endDate: '', cgpa: '' })
        count++
      }
    }
  }

  return {
    personalInfo: {
      fullName: fullName?.trim() || '',
      email: email || '',
      phone: phone || '',
      location: location || '',
      headline: headline || '',
      summary: summary || '',
      links: links.length ? links : [{ label: 'LinkedIn', url: '' }],
    },
    skills,
    projects,
    experience,
    education,
    template: 'source-split',
    updatedAt: new Date().toISOString(),
    _rawTextPreview: text.slice(0, 4000),
  }
}

async function tryAI(promptSystem: string, promptUser: string, opts?: any): Promise<string | null> {
  try {
    const res = await aiChat('resume', promptSystem, promptUser, { temperature: 0.6, max_tokens: 2048, ...opts })
    if (!res || res === NOT_CONFIGURED || res.includes('AI provider not configured')) return null
    return res
  } catch (e) {
    logger.warn({ err: e }, '[resume ai] fallback due to error')
    return null
  }
}

async function tryAIWithUserKey(promptSystem: string, promptUser: string, userApiKey: string | null, opts?: any): Promise<string | null> {
  const key = String(userApiKey || '').trim()
  if (!key || key.length < 10) return null
  try {
    const res = await aiChatWithUserKey('resume', promptSystem, promptUser, key, { temperature: 0.6, max_tokens: 2048, ...opts })
    if (!res || res === NOT_CONFIGURED || res.includes('AI provider not configured')) return null
    return res
  } catch (e) {
    logger.warn({ err: e }, '[resume ai userKey] fallback')
    return null
  }
}

// ===================== ROUTES =====================

/**
 * POST /api/resume/latex
 * Body: ResumeData JSON
 * Query: ?format=json | tex | pdf
 * - json (default): { latex, filename, size }
 * - tex: returns .tex as attachment
 * - pdf: returns vector PDF (tries pdflatex, falls back to pdfkit selectable PDF)
 */
router.post('/latex', limiter, async (req: Request, res: Response) => {
  const parsed = resumeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid ResumeData', details: parsed.error.flatten() })
    return
  }
  const data = parsed.data as any
  const format = String((req.query.format as string) || 'json').toLowerCase()
  const latex = generateResumeLatex(data)

  if (format === 'tex') {
    const filename = safeFilename(data.personalInfo?.fullName, '.tex')
    res.setHeader('Content-Type', 'application/x-tex; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('X-Filename', filename)
    res.send(latex)
    return
  }

  if (format === 'pdf') {
    try {
      // True Overleaf fidelity: local pdflatex → online latex → tight pdfkit vector (selectable)
      let pdfBuffer: Buffer
      let engine: string = 'unknown'
      try {
        const meta = await generateResumePdfWithMeta(latex, data)
        pdfBuffer = meta.buffer
        engine = meta.engine
      } catch (e) {
        // pdfkit missing? fall back to vector method directly
        pdfBuffer = await generateVectorPdfBuffer(data)
        engine = 'pdfkit-vector'
      }
      const filename = safeFilename(data.personalInfo?.fullName, '.pdf')
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Content-Length', String(pdfBuffer.length))
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Pdf-Engine', engine)
      if (engine === 'pdfkit-vector') {
        res.setHeader('X-Overleaf-Hint', 'For pixel-perfect LaTeX, download .tex via ?format=tex and paste into Overleaf (pdflatex, no packages needed)')
      }
      // Also expose Overleaf instructions in JSON hint header when requested as ?format=pdf?debug
      res.send(pdfBuffer)
      return
    } catch (err: any) {
      logger.error({ err: err }, '[resume/latex pdf] generation failed')
      // Fallback: return TeX with error hint so client can use Overleaf
      res.status(500).json({
        error: 'PDF generation failed — download .tex and compile on Overleaf',
        hint: 'POST /api/resume/latex?format=tex — paste into Overleaf main.tex and Recompile (pdflatex)',
        latexPreview: latex.slice(0, 4000),
      })
      return
    }
  }

  // default json
  const filename = safeFilename(data.personalInfo?.fullName, '.tex')
  res.json({
    latex,
    filename,
    size: Buffer.byteLength(latex, 'utf8'),
    template: data.template || 'source-split',
    hint: 'Use ?format=tex to download .tex or ?format=pdf for vector PDF (selectable). Paste .tex into Overleaf (Blank Project -> main.tex -> Recompile with pdfLaTeX) for pixel-perfect template-matched output.',
    overleaf: {
      steps: ['Go to https://www.overleaf.com/project -> New Project -> Blank Project', 'Delete sample content in main.tex', 'Paste downloaded .tex', 'Click Recompile', 'Download PDF (true Overleaf quality)'],
      compile: 'pdflatex',
      template: 'article + geometry 0.55in + titlesec + enumitem + hyperref (no .cls needed)',
    },
  })
})

// Light health for route discovery
router.get('/latex/health', (_req, res) => {
  res.json({
    ok: true,
    endpoint: 'POST /api/resume/latex?format=json|tex|pdf',
    classicTemplate: 'Jake single-column ATS, 0.55in margins, hyperlinked, selectable — article + geometry 0.55in + titlesec + enumitem + hyperref, Overleaf paste-ready',
    engines: ['local-pdflatex (host texlive)', 'online-latex (latexonline.cc cloud pdflatex)', 'pdfkit-vector (tight fallback, selectable, hyperlinked)'],
    overleaf: 'Download .tex via ?format=tex and paste into Overleaf main.tex -> Recompile (pdflatex) for pixel-perfect',
  })
})

// ===================== NEW: AI UPGRADE =====================

const aiUpgradeSchema = z.object({
  data: resumeSchema,
  mode: z.enum(['summary', 'bullets', 'skills', 'full', 'tailor', 'upgrade']).default('full'),
  jobDescription: z.string().optional().default(''),
  prompt: z.string().optional().default(''),
  targetId: z.string().optional(),
  section: z.string().optional(),
})

/**
 * POST /api/resume/ai-upgrade
 * Body: { data: ResumeData, mode, jobDescription?, prompt?, targetId? }
 * Calls Groq/Llama via aiChat (feature 'resume') or falls back to heuristic.
 * Keeps existing 3 templates; does not modify template choice.
 */
router.post('/ai-upgrade', aiLimiter, aiQuota('resume-ai-upgrade'), async (req: AuthRequest, res: Response) => {
  const parsed = aiUpgradeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
    return
  }
  const { data, mode, jobDescription, prompt, targetId } = parsed.data

  // Per spec: user/student provides own Groq API key; superadmin's AI Manager provides global model.
  // If no user key, fallback to heuristic and flag hasGroq false with placeholder message.
  const userGroqKey = await extractUserGroqKeyWithDb(req as AuthRequest as any) || extractUserGroqKey(req as Request)
  const hasGroq = Boolean(userGroqKey && String(userGroqKey).trim().length > 10)
  const placeholderMsg = 'Add your Groq API key in Settings → AI to enable Vision & AI Summarize/Upgrade. Your key will use the global model from superadmin AI Manager (e.g., ' + (await getResumeGlobalModelInfo().then(m=>m.textModel).catch(()=>'openai/gpt-oss-120b')) + '). Remaining features (heuristic parse, template selection, manual editing, export PDF/DOCX/TXT/JSON) work without API.'
  // Try AI first (only when user key present)
  let aiResult: string | null = null
  let usedAI = false

  const baseSystem = `You are a resume expert like Rezi/FlowCV. You improve resumes to be ATS-friendly, concise, quantified, and tailored without hallucinating. 
Rules:
- Use action verbs + STAR.
- Quantify where plausible but don't invent employers/dates.
- Keep tone professional, concise.
- Never fabricate experiences not in input; you may rephrase.
- Output MUST be valid JSON when asked.
- Keep 3 template choices intact — only enhance content.`

  if (mode === 'summary') {
    const userPrompt = `ResumeData personalInfo.summary to improve:
Current summary: """${data.personalInfo.summary || '(empty)'}"""
Headline: ${data.personalInfo.headline || ''}
Role JD (optional): """${(jobDescription || prompt || '').slice(0, 3000)}"""
Improve the summary to 2-3 lines, ATS-friendly, keyword-rich, professional.
Return JSON: { "summary": "enhanced text" }`
    if (hasGroq) aiResult = await tryAIWithUserKey(baseSystem, userPrompt, userGroqKey, { temperature: 0.7, max_tokens: 600 })
    if (aiResult) {
      try {
        const m = aiResult.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiResult)
        if (j.summary) {
          usedAI = true
          res.json({ mode, usedAI: true, hasGroq, result: { summary: j.summary }, raw: aiResult })
          return
        }
      } catch {}
      // fallback extract
      if (aiResult.trim().length > 20) {
        usedAI = true
        res.json({ mode, usedAI: true, hasGroq, result: { summary: aiResult.trim().slice(0, 600) }, raw: aiResult })
        return
      }
    }
    // heuristic fallback — still works without API (spec: remaining features without API)
    const enhanced = heuristicEnhanceSummary(data.personalInfo.summary || '')
    res.json({ mode, usedAI: false, hasGroq, result: { summary: enhanced }, heuristic: true, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable Vision & AI Summarize/Upgrade' : undefined })
    return
  }

  if (mode === 'bullets') {
    // Improve bullets for experience/project matching targetId or all
    const allBullets = data.experience.flatMap(e => e.bullets)
    const targetBullets: string[] = targetId
      ? (data.experience.find(e => e.id === targetId)?.bullets || data.projects.find(p => p.id === targetId) ? [data.projects.find(p => p.id === targetId)?.description || ''] : [])
      : allBullets

    const userPrompt = `Improve these resume bullets to be quantified, action-led, ATS-friendly.
Bullets: ${JSON.stringify(targetBullets.slice(0, 8))}
Context resume: ${JSON.stringify({ skills: data.skills.slice(0, 15), headline: data.personalInfo.headline }).slice(0, 800)}
Return JSON: { "bullets": ["improved bullet 1", ...] } — same count as input, each 1 line, starts with verb, includes metric where plausible.`
    if (hasGroq) aiResult = await tryAIWithUserKey(baseSystem, userPrompt, userGroqKey, { temperature: 0.6, max_tokens: 1000 })
    if (aiResult) {
      try {
        const m = aiResult.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiResult)
        if (Array.isArray(j.bullets) && j.bullets.length) {
          usedAI = true
          res.json({ mode, usedAI: true, hasGroq, result: { bullets: j.bullets }, raw: aiResult })
          return
        }
      } catch {}
    }
    const improved = heuristicImproveBullets(targetBullets.length ? targetBullets : ['Built feature', 'Collaborated'])
    res.json({ mode, usedAI: false, hasGroq, result: { bullets: improved }, heuristic: true, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable Vision & AI Summarize/Upgrade' : undefined })
    return
  }

  if (mode === 'skills') {
    const jd = (jobDescription || prompt || '').slice(0, 4000)
    const userPrompt = `Given resume skills: ${data.skills.join(', ') || '(none)'} and JD: """${jd}"""
Suggest 10-15 ATS keywords to add (only truthful extensions, no hallucination). Return JSON: { "suggestedSkills": ["skill1", ...], "reason": "why" }`
    if (hasGroq) aiResult = await tryAIWithUserKey(baseSystem, userPrompt, userGroqKey, { temperature: 0.5, max_tokens: 800 })
    if (aiResult) {
      try {
        const m = aiResult.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiResult)
        if (Array.isArray(j.suggestedSkills)) {
          res.json({ mode, usedAI: true, hasGroq, result: j, raw: aiResult })
          return
        }
      } catch {}
    }
    // heuristic suggestion — works without API
    const pool = ['React', 'TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'MongoDB', 'Docker', 'AWS', 'Git', 'REST APIs', 'Tailwind CSS', 'Next.js']
    const missing = pool.filter(s => !data.skills.map((x: string) => x.toLowerCase()).includes(s.toLowerCase())).slice(0, 8)
    res.json({ mode, usedAI: false, hasGroq, result: { suggestedSkills: missing, reason: 'Heuristic — add missing baseline stack where you have experience' }, heuristic: true, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable AI suggestions' : undefined })
    return
  }

  if (mode === 'tailor') {
    const jd = (jobDescription || prompt || '')
    if (!jd.trim()) {
      res.status(400).json({ error: 'jobDescription (or prompt) required for tailor mode' })
      return
    }
    const userPrompt = `Tailor this ResumeData to the job description without inventing facts.
ResumeData: ${JSON.stringify(data).slice(0, 6000)}
JD: """${jd.slice(0, 5000)}"""
Tasks:
1. Rewrite summary to mirror JD keywords (2-3 lines).
2. Suggest reordered skills (top 12) prioritized for JD.
3. Rewrite experience bullets (each role) to emphasize JD-relevant achievements.
4. Keep all dates/companies truthful.
Return JSON: { "personalInfo": { "summary": "...", "headline": "..." }, "skills": ["..."], "experience": [ { "id": "...", "bullets": ["..."] } ], "suggestions": ["tip1"] }`
    if (hasGroq) aiResult = await tryAIWithUserKey(baseSystem, userPrompt, userGroqKey, { temperature: 0.6, max_tokens: 2200 })
    if (aiResult) {
      try {
        const m = aiResult.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiResult)
        if (j.personalInfo || j.skills) {
          res.json({ mode, usedAI: true, hasGroq, result: j, raw: aiResult })
          return
        }
      } catch {}
      // if AI returned unstructured, try to salvage
      if (aiResult.length > 100) {
        res.json({ mode, usedAI: true, hasGroq, result: { rawText: aiResult.slice(0, 3000), suggestions: ['AI tailor returned text — apply manually'] }, raw: aiResult })
        return
      }
    }
    // heuristic tailor: boost JD keywords in summary/skills — works without API
    const jdTokens = jd.toLowerCase().match(/[a-z0-9+#.]{3,}/g) || []
    const uniq = Array.from(new Set(jdTokens.filter(t => t.length > 3))).slice(0, 12)
    const tailoredSummary = heuristicEnhanceSummary(data.personalInfo.summary || '') + (uniq.length ? ` Aligned with ${uniq.slice(0, 4).join(', ')}.` : '')
    const boostedSkills = Array.from(new Set([...uniq.slice(0, 6).map(s => s.charAt(0).toUpperCase() + s.slice(1)), ...data.skills])).slice(0, 14)
    res.json({ mode, usedAI: false, hasGroq, result: { personalInfo: { summary: tailoredSummary, headline: data.personalInfo.headline }, skills: boostedSkills, experience: data.experience, suggestions: [hasGroq ? 'Heuristic tailor — AI with your key failed, showing fallback' : 'Heuristic tailor — Add your Groq API key in Settings → AI to enable AI Tailor'] }, heuristic: true, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable AI Tailor' : undefined })
    return
  }

  // full / upgrade — improve entire resume
  {
    const userPrompt = `Upgrade this ResumeData comprehensively (Rezi/FlowCV style):
ResumeData: ${JSON.stringify(data).slice(0, 7000)}
JD (optional): """${(jobDescription || prompt || '').slice(0, 3000)}"""
Return JSON ResumeData with same ids but improved:
- personalInfo.summary (2-3 lines)
- personalInfo.headline (concise)
- skills (12-15 ordered, deduplicated)
- projects[].description (1-2 lines each)
- experience[].bullets (3-5 per role, quantified)
Do NOT change template/education/dates/companies.
Return JSON: { "data": { /* ResumeData */ } }`
    if (hasGroq) aiResult = await tryAIWithUserKey(baseSystem, userPrompt, userGroqKey, { temperature: 0.6, max_tokens: 3000 })
    if (aiResult) {
      try {
        const m = aiResult.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiResult)
        const upgraded = j.data || j.resumeData || j
        if (upgraded.personalInfo || upgraded.skills) {
          // Ensure template preserved
          upgraded.template = data.template
          upgraded.updatedAt = new Date().toISOString()
          // Ensure ids preserved where AI may have regenerated
          res.json({ mode: 'full', usedAI: true, hasGroq, result: { data: upgraded }, raw: aiResult })
          return
        }
      } catch (e) {
        logger.warn({ err: e }, 'full upgrade JSON parse failed')
      }
    }
    // heuristic full — works without API per spec
    const upgradedHeuristic = {
      ...data,
      personalInfo: { ...data.personalInfo, summary: heuristicEnhanceSummary(data.personalInfo.summary || '') },
      skills: Array.from(new Set([...data.skills, 'React', 'Node.js', 'TypeScript'].filter(Boolean))).slice(0, 15),
      experience: data.experience.map(exp => ({ ...exp, bullets: heuristicImproveBullets(exp.bullets) })),
      updatedAt: new Date().toISOString(),
    }
    res.json({ mode: 'full', usedAI: false, hasGroq, result: { data: upgradedHeuristic }, heuristic: true, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable AI Full Upgrade — heuristic applied' : undefined, note: hasGroq ? 'AI with your key failed — showing heuristic fallback' : 'Add your Groq API key in Settings → AI to enable AI Full Upgrade' })
    return
  }
})

/**
 * POST /api/resume/ai-enhance — alias for /ai-upgrade (frontend convenience)
 * topbottom F11: NO limiter of its own — the re-dispatch below re-enters this
 * router and runs /ai-upgrade's aiLimiter + aiQuota exactly once. (A previous
 * revision carried its own aiLimiter here AND skipped aiQuota entirely:
 * double limiter count + quota bypass.)
 */
router.post('/ai-enhance', async (req: Request, res: Response) => {
  // Forward to ai-upgrade handler by reusing schema
  req.url = '/ai-upgrade'
  // @ts-ignore
  router.handle(req, res)
})

/**
 * POST /api/resume/ats-score
 * Body: { data: ResumeData, jobDescription?: string }
 */
router.post('/ats-score', aiLimiter, aiQuota('resume-ats-score'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    data: resumeSchema,
    jobDescription: z.string().optional().default(''),
    job_description: z.string().optional().default(''),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
    return
  }
  const d = parsed.data.data as any
  const jd = (parsed.data.jobDescription || (parsed.data as any).job_description || '') as string
  const heuristic = heuristicAtsScore(d, jd)
  const userGroqKey = await extractUserGroqKeyWithDb(req as any) || extractUserGroqKey(req as Request)
  const hasGroq = Boolean(userGroqKey && String(userGroqKey).trim().length > 10)

  // Try AI augmentation only if user provided key (per spec, remaining features without API)
  let aiInsights: string | null = null
  if (hasGroq && (jd.trim() || true)) {
    const prompt = `Score this resume ATS 0-100 and give brief 5 bullet feedback vs JD.
Resume: ${JSON.stringify({ personalInfo: d.personalInfo, skills: d.skills, projects: d.projects, experience: d.experience, education: d.education }).slice(0, 5000)}
JD: """${jd.slice(0, 3000)}"""
Return JSON: { "aiScore": 0-100, "feedback": ["..."], "missingKeywords": ["..."] }`
    const aiRaw = await tryAIWithUserKey('You are an ATS evaluator like Rezi. Be strict, helpful, concise. Return only JSON.', prompt, userGroqKey, { temperature: 0.3, max_tokens: 900 })
    if (aiRaw) {
      try {
        const m = aiRaw.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiRaw)
        aiInsights = aiRaw
        // Blend scores: heuristic 60% + ai 40% if both present
        if (typeof j.aiScore === 'number') {
          const blended = Math.round(heuristic.score * 0.6 + Math.min(100, Math.max(0, j.aiScore)) * 0.4)
          res.json({ ...heuristic, aiScore: j.aiScore, blendedScore: blended, aiFeedback: j.feedback, aiMissingKeywords: j.missingKeywords, usedAI: true, hasGroq, raw: aiRaw })
          return
        }
      } catch {}
      res.json({ ...heuristic, aiFeedbackRaw: aiRaw, usedAI: true, hasGroq })
      return
    }
  }
  res.json({ ...heuristic, usedAI: false, hasGroq, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable AI-augmented ATS scoring — heuristic score shown' : undefined })
})

// ===================== RESUME DEPTH (#10) =====================
// JD scrape-from-URL + cover letter + GitHub repos. All grounded: JD scrape
// returns verbatim stripped text only (no AI, no hallucination); cover letter
// uses resume facts + JD keywords; GitHub uses public api.github.com (no token).

/**
 * POST /api/resume/jd-scrape
 * Body: { url: string }
 * Returns: { text, length, truncated, sourceUrl } — verbatim JD text (max 6k).
 */
router.post('/jd-scrape', jdScrapeLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  const schema = z.object({ url: z.string().min(8).max(2000) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide { url } with a valid http(s) job posting link' })
    return
  }
  try {
    const result = await scrapeJdUrl(parsed.data.url)
    if (!result.text) {
      res.status(422).json({ error: 'Could not extract job description text from this link — the page may need JavaScript or block scrapers. Paste the JD text manually instead.', sourceUrl: result.sourceUrl })
      return
    }
    res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || 'JD fetch failed')
    if (/Private|allowlist|Invalid URL|resolve|protocol|Credentials|hostname/i.test(msg)) {
      res.status(400).json({ error: msg })
      return
    }
    if (/too large/i.test(msg)) {
      res.status(400).json({ error: msg })
      return
    }
    logger.warn({ err: e }, '[resume/jd-scrape] failed')
    res.status(500).json({ error: 'Failed to fetch JD link' })
  }
})

/**
 * POST /api/resume/cover-letter
 * Body: { data: ResumeData, jobDescription: string, tone?: professional|enthusiastic|concise }
 * Returns: { letter, usedAI, hasGroq } — grounded in resume + JD only.
 */
router.post('/cover-letter', aiLimiter, aiQuota('resume-cover-letter'), async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    data: resumeSchema,
    jobDescription: z.string().min(1).max(8000),
    tone: z.enum(['professional', 'enthusiastic', 'concise']).optional().default('professional'),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request — need { data, jobDescription }', details: parsed.error.flatten() })
    return
  }
  const { data, jobDescription, tone } = parsed.data
  const userGroqKey = await extractUserGroqKeyWithDb(req as any) || extractUserGroqKey(req as Request)
  const hasGroq = Boolean(userGroqKey && String(userGroqKey).trim().length > 10)

  if (hasGroq) {
    const p = (data as any).personalInfo || {}
    const sys = 'You are a cover-letter writer. Use ONLY facts from the resume + JD keywords. Never invent employers, dates, metrics, or skills not in the resume. Keep to ~250 words, professional tone.'
    const userPrompt = `Resume: ${JSON.stringify({ personalInfo: p, skills: (data as any).skills?.slice(0, 12), projects: (data as any).projects?.slice(0, 3), experience: (data as any).experience?.slice(0, 3), education: (data as any).education?.slice(0, 2) }).slice(0, 4500)}\nJD: """${jobDescription.slice(0, 3500)}"""\nTone: ${tone}\nWrite the cover letter as plain text (Dear ..., 3-4 paragraphs, Sincerely + name).`
    const aiRaw = await tryAIWithUserKey(sys, userPrompt, userGroqKey, { temperature: 0.6, max_tokens: 1200 })
    if (aiRaw && aiRaw.trim().length > 50) {
      res.json({ letter: aiRaw.trim().slice(0, 4000), usedAI: true, hasGroq })
      return
    }
  }
  const letter = heuristicCoverLetter(data as any, jobDescription, tone as any)
  res.json({ letter, usedAI: false, hasGroq, heuristic: true, placeholder: !hasGroq ? 'Add your Groq API key in Settings → AI to enable AI cover letters — heuristic shown' : undefined })
})

/**
 * GET /api/resume/github-repos/:username?limit=12
 * Returns: { repos: [{ name, description, language, stars, forks, url, homepage, updatedAt, topics }] }
 */
router.get('/github-repos/:username', githubReposLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const raw = String(req.params.username || '').trim()
    const limitParam = parseInt(String(req.query.limit || '12'), 10)
    const limit = Number.isFinite(limitParam) ? Math.min(20, Math.max(1, limitParam)) : 12
    const repos = await fetchGithubRepos(raw, limit)
    res.json({ repos, username: raw, count: repos.length })
  } catch (e: any) {
    const msg = String(e?.message || 'GitHub fetch failed')
    if (/Invalid GitHub/i.test(msg)) {
      res.status(400).json({ error: msg })
      return
    }
    if ((e as any)?.status === 404) {
      res.status(404).json({ error: msg })
      return
    }
    logger.warn({ err: e }, '[resume/github-repos] failed')
    res.status((e as any)?.status === 502 ? 502 : 500).json({ error: msg })
  }
})

// ===================== PARSE / UPLOAD =====================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB streaming cap (resume parse)
  fileFilter: (_req, file, cb) => {
    const blocked = ['.html', '.htm', '.xhtml', '.svg', '.xml', '.js', '.mjs', '.css'];
    const extLower = `.${(file.originalname.split('.').pop() || '').toLowerCase()}`;
    if (blocked.includes(extLower)) {
      const err: any = new Error('File type not allowed');
      err.status = 400; err.statusCode = 400; cb(err); return;
    }
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain']
    const ext = (file.originalname.split('.').pop() || '').toLowerCase()
    if (allowed.includes(file.mimetype) || ['pdf', 'docx', 'doc', 'txt'].includes(ext)) cb(null, true)
    else {
      const err: any = new Error('Only PDF, DOCX, TXT allowed')
      err.status = 400
      err.statusCode = 400
      cb(err)
    }
  },
})

async function extractTextFromBuffer(buffer: Buffer, originalName: string, mimetype: string): Promise<string> {
  const ext = (originalName.split('.').pop() || '').toLowerCase()
  if (ext === 'txt' || mimetype === 'text/plain') {
    return buffer.toString('utf-8')
  }
  if (ext === 'docx' || mimetype.includes('wordprocessingml') || mimetype === 'application/msword') {
    try {
      // @ts-ignore
      const mammoth = await import('mammoth')
      const mod: any = (mammoth as any).default || mammoth
      const result = await mod.extractRawText({ buffer })
      if (result.value?.trim()) return result.value
    } catch (e) {
      logger.warn({ err: e }, 'mammoth extract failed')
    }
    // fallback: try as text
    return buffer.toString('utf-8').slice(0, 15000)
  }
  if (ext === 'pdf' || mimetype === 'application/pdf') {
    let parser: any = null
    try {
      const { PDFParse } = await import('pdf-parse')
      parser = new PDFParse({ data: buffer })
      const result = await parser.getText()
      if (result?.text?.trim()) return result.text
    } catch (e) {
      logger.warn({ err: (e as any)?.message || e }, 'pdf-parse failed')
    } finally {
      try {
        await parser?.destroy()
      } catch {}
    }
    return ''
  }
  return buffer.toString('utf-8').slice(0, 15000)
}

/**
 * POST /api/resume/parse
 * multipart/form-data: file field "resume" (pdf/docx/txt)
 * Returns: { data: ResumeData, rawText, heuristic, usedAI }
 * Also supports JSON: { rawText: string }
 */
router.post('/parse', parseLimiter, authenticate, (req: Request, res: Response, next: NextFunction) => {
    upload.single('resume')(req as any, res as any, (err: any) => {
      if (err) {
        const status = err.status || err.statusCode || 400
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Max 6MB allowed' })
        }
        return res.status(status >= 400 && status < 500 ? status : 400).json({ error: err.message || 'Invalid file' })
      }
      next()
    })
  }, async (req: AuthRequest, res: Response) => {
  try {
    let rawText = ''
    const jsonRaw = (req.body?.rawText as string) || (req.body?.text as string) || ''
    if (jsonRaw && typeof jsonRaw === 'string' && jsonRaw.trim().length > 20) {
      rawText = jsonRaw
    } else if ((req as any).file?.buffer) {
      const file = (req as any).file
      // Magic-byte + scan-stub (blocks html/svg/xml/js polyglots)
      const magicErr = await validateUploadMagicBytes(file.buffer, file.originalname, file.mimetype, 'resume')
      if (magicErr) {
        res.status(400).json({ error: magicErr })
        return
      }
      rawText = await extractTextFromBuffer(file.buffer, file.originalname, file.mimetype)
    } else if (req.body && typeof req.body === 'string' && req.body.length > 20) {
      rawText = req.body as any
    } else {
      res.status(400).json({ error: 'No file or rawText provided. Send multipart "resume" or JSON { rawText }' })
      return
    }

    if (!rawText || rawText.trim().length < 10) {
      res.status(400).json({ error: 'Could not extract text from file — try a text-based PDF or DOCX' })
      return
    }

    // Heuristic parse first — works without API per spec
    const heuristicData = heuristicParseTextToResumeData(rawText)

    // Try AI structuring only if user provided Groq key (per spec: per-user key + global model)
    let aiData: any = null
    let usedAI = false
    const userGroqKeyParse = await extractUserGroqKeyWithDb(req as AuthRequest as any) || extractUserGroqKey(req as Request)
    const hasUserGroqParse = Boolean(userGroqKeyParse && String(userGroqKeyParse).trim().length>10)
    const aiSystem = `You are a resume parser. Given raw resume text, output ONLY valid JSON ResumeData with shape:
{
  "personalInfo": { "fullName": "", "email": "", "phone": "", "location": "", "headline": "", "summary": "", "links": [{"label":"","url":""}] },
  "skills": ["..."],
  "projects": [{"id":"1","title":"","description":"","tech":[],"link":"","date":""}],
  "experience": [{"id":"1","role":"","company":"","location":"","startDate":"","endDate":"","bullets":[""]}],
  "education": [{"id":"1","degree":"","school":"","location":"","startDate":"","endDate":"","cgpa":""}]
}
Rules:
- Keep ids as strings.
- If a field unknown, leave "" or [].
- Extract links (LinkedIn, GitHub, portfolio) from URLs.
- Split skills by comma/line.
- Do NOT hallucinate CGPA or dates not present.
- Output JSON only.`
    let aiRaw: string | null = null
    if (hasUserGroqParse) {
      aiRaw = await tryAIWithUserKey(aiSystem, `Raw resume text:\n"""${rawText.slice(0, 8000)}"""\nReturn JSON ResumeData only.`, userGroqKeyParse, { temperature: 0.2, max_tokens: 2500 })
    }
    if (aiRaw) {
      try {
        const m = aiRaw.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiRaw)
        // Validate shape loosely
        if (j.personalInfo || j.skills) {
          // Ensure defaults
          aiData = {
            personalInfo: {
              fullName: j.personalInfo?.fullName || heuristicData.personalInfo.fullName,
              email: j.personalInfo?.email || heuristicData.personalInfo.email,
              phone: j.personalInfo?.phone || heuristicData.personalInfo.phone,
              location: j.personalInfo?.location || heuristicData.personalInfo.location,
              headline: j.personalInfo?.headline || heuristicData.personalInfo.headline,
              summary: j.personalInfo?.summary || heuristicData.personalInfo.summary,
              links: Array.isArray(j.personalInfo?.links) && j.personalInfo.links.length ? j.personalInfo.links : heuristicData.personalInfo.links,
            },
            skills: Array.isArray(j.skills) ? j.skills : heuristicData.skills,
            projects: Array.isArray(j.projects) ? j.projects.map((p: any, i: number) => ({ id: p.id || String(Date.now() + i), title: p.title || '', description: p.description || '', tech: Array.isArray(p.tech) ? p.tech : [], link: p.link || '', date: p.date || '' })) : heuristicData.projects,
            experience: Array.isArray(j.experience) ? j.experience.map((e: any, i: number) => ({ id: e.id || String(Date.now()+100+i), role: e.role || '', company: e.company || '', location: e.location || '', startDate: e.startDate || '', endDate: e.endDate || '', bullets: Array.isArray(e.bullets) ? e.bullets : [String(e.bullets||'')] })) : heuristicData.experience,
            education: Array.isArray(j.education) ? j.education.map((e: any, i: number) => ({ id: e.id || String(Date.now()+200+i), degree: e.degree || '', school: e.school || '', location: e.location || '', startDate: e.startDate || '', endDate: e.endDate || '', cgpa: e.cgpa || '' })) : heuristicData.education,
            template: 'source-split',
            updatedAt: new Date().toISOString(),
          }
          usedAI = true
        }
      } catch (e) {
        logger.warn({ err: e }, 'AI parse JSON failed, using heuristic')
      }
    }

    const finalData = aiData || heuristicData
    // Do not include _rawTextPreview in final payload for cleanliness, but include preview field
    const preview = rawText.slice(0, 4000)
    res.json({
      data: finalData,
      rawText: preview,
      rawLength: rawText.length,
      heuristic: !usedAI,
      usedAI,
      hasGroq: hasUserGroqParse,
      placeholder: !hasUserGroqParse ? 'Add your Groq API key in Settings → AI to enable AI structuring — heuristic parse shown' : undefined,
    })
  } catch (err: any) {
    logger.error({ err: err }, '[resume/parse] failed')
    res.status(500).json({ error: err.message || 'Failed to parse resume' })
  }
})

// Alias for convenience — same as /parse but with text field — per-user key + global model
router.post('/parse-text', parseLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  const { rawText, text } = req.body || {}
  const t = rawText || text || ''
  if (!t || String(t).trim().length < 10) {
    res.status(400).json({ error: 'Provide { rawText } with resume text' })
    return
  }
  const heuristicData = heuristicParseTextToResumeData(String(t))
  const aiSystem = `You are a resume parser — output JSON only.`
  const userGroqKeyPt = await extractUserGroqKeyWithDb(req as any) || extractUserGroqKey(req as any)
  const hasUserGroqPt = Boolean(userGroqKeyPt && String(userGroqKeyPt).trim().length>10)
  let aiRaw: string | null = null
  if (hasUserGroqPt) {
    aiRaw = await tryAIWithUserKey(aiSystem, `Parse this resume text to JSON ResumeData:\n"""${String(t).slice(0, 8000)}"""`, userGroqKeyPt, { temperature: 0.2, max_tokens: 2500 })
  }
  let aiData = null
  let usedAI = false
  if (aiRaw) {
    try {
      const m = aiRaw.match(/\{[\s\S]*\}/)
      const j = JSON.parse(m ? m[0] : aiRaw)
      if (j.personalInfo) {
        aiData = j
        usedAI = true
      }
    } catch {}
  }
  res.json({ data: aiData || heuristicData, rawText: String(t).slice(0, 4000), usedAI, hasGroq: hasUserGroqPt, placeholder: !hasUserGroqPt ? 'Add your Groq API key in Settings → AI to enable AI parsing' : undefined })
})

// Backwards alias — some clients may call /upload
router.post('/upload', parseLimiter, authenticate, (req: Request, res: Response, next: NextFunction) => {
    upload.single('resume')(req as any, res as any, (err: any) => {
      if (err) {
        const status = err.status || err.statusCode || 400
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Max 6MB allowed' })
        }
        return res.status(status >= 400 && status < 500 ? status : 400).json({ error: err.message || 'Invalid file' })
      }
      next()
    })
  }, async (req: AuthRequest, res: Response) => {
  // delegate to /parse logic by re-dispatching via internal call
  // Simplest: duplicate extraction here
  try {
    let rawText = ''
    if ((req as any).file?.buffer) {
      const file = (req as any).file
      // Upload-audit-all: /upload alias previously skipped the shared
      // magic-byte gate that /parse enforces (spoofed HTML-as-PDF reached
      // extractTextFromBuffer). Unified on validateUploadMagicBytes
      // ('resume' surface) so both entry points share one scanner.
      const magicErr = await validateUploadMagicBytes(file.buffer, file.originalname, file.mimetype, 'resume')
      if (magicErr) {
        res.status(400).json({ error: magicErr })
        return
      }
      rawText = await extractTextFromBuffer(file.buffer, file.originalname, file.mimetype)
    } else {
      res.status(400).json({ error: 'No file provided under field "resume"' })
      return
    }
    const heuristicData = heuristicParseTextToResumeData(rawText)
    res.json({ data: heuristicData, rawText: rawText.slice(0, 4000), heuristic: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Upload failed' })
  }
})

// ===================== CONVERT TO LATEX (PDF/Image/DOCX -> LaTeX) =====================

/**
 * Upload with field "file" (preferred) or "resume" (compat). Also accepts JSON { rawText } for text->latex.
 * Returns { latex, rawText, data, usedAI, method, hasGroq, fileName }.
 * Uses Groq Vision for images, AI text->LaTeX for PDFs, heuristic fallback otherwise.
 * Research-backed: vision + RAG similar to pdf2tex/gptpdf_LaTeX (Qwen vision) — here we use Groq qwen/* vision via visionCompletion.
 */
const convertUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB streaming cap (resume convert — parity with parse)
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/tiff'
    ]
    const ext = (file.originalname.split('.').pop() || '').toLowerCase()
    const allowedExts = ['pdf','docx','doc','txt','png','jpg','jpeg','webp','bmp','tiff','tif']
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext) || file.mimetype.startsWith('image/')) cb(null, true)
    else {
      const err: any = new Error('Only PDF, DOCX, TXT, or Image (png/jpg/webp) allowed')
      err.status = 400
      err.statusCode = 400
      cb(err)
    }
  },
})

router.post('/convert-to-latex', convertLimiter, (req: Request, res: Response, next: NextFunction) => {
  // Accept both "file" and "resume" field names for compat with earlier clients
  const anyReq: any = req
  // Peek at multipart header to decide field? Simpler: try both sequentially
  convertUpload.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      const status = err.status || err.statusCode || 400
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Max 8MB allowed' })
      }
      return res.status(status >= 400 && status < 500 ? status : 400).json({ error: err.message || 'Invalid file' })
    }
    // If file field empty, try resume field as fallback (without re-parsing, use req.file fallback)
    if (!(anyReq).file) {
      convertUpload.single('resume')(req as any, res as any, (err2: any) => {
        if (err2) {
          const status = err2.status || err2.statusCode || 400
          if (err2.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Max 8MB allowed' })
          }
          return res.status(status >= 400 && status < 500 ? status : 400).json({ error: err2.message || 'Invalid file' })
        }
        next()
      })
    } else {
      next()
    }
  })
}, async (req: AuthRequest, res: Response) => {
  try {
    const anyReq: any = req
    const file: Express.Multer.File | undefined = anyReq.file
    // JSON fallback: { rawText, fileName?, mimeType? }
    const bodyRaw = (req.body?.rawText as string) || (req.body?.text as string) || ''
    const bodyFileName = (req.body?.fileName as string) || 'pasted.txt'
    const bodyMime = (req.body?.mimeType as string) || 'text/plain'

    let buffer: Buffer | null = null
    let fileName = bodyFileName
    let mimeType = bodyMime

    if (file?.buffer) {
      buffer = file.buffer
      fileName = file.originalname
      mimeType = file.mimetype
    } else if (bodyRaw && String(bodyRaw).trim().length > 10) {
      buffer = Buffer.from(String(bodyRaw), 'utf-8')
      // keep bodyFileName/mimeType
    } else {
      res.status(400).json({ error: 'No file or rawText provided. Send multipart "file" (pdf/docx/txt/image) or JSON { rawText }' })
      return
    }

    if (!buffer || buffer.length === 0) {
      res.status(400).json({ error: 'Empty file' })
      return
    }

    // Upload-audit-all: /convert-to-latex previously persisted no scan —
    // image/PDF bytes went straight to vision/text pipelines. Unified on the
    // shared scanner (image/* via 'rooms' surface which allowlists image
    // magics incl. webp/heic; docs via 'resume'). JSON { rawText } path skips
    // (no binary to sniff — express.json 1mb cap + downstream LaTeX escaping
    // is the authority there).
    if (file?.buffer) {
      const surface = String(mimeType || '').startsWith('image/') ? 'rooms' : 'resume'
      const magicErr = await validateUploadMagicBytes(buffer, fileName, mimeType, surface as 'rooms' | 'resume')
      if (magicErr) {
        res.status(400).json({ error: magicErr })
        return
      }
    }

    // Per spec: per-user Groq API key + superadmin's global model (AI Manager)
    // Frontend sends X-GROQ-API-KEY header from localStorage campusflow:groq-key; backend also checks user preferences
    const userGroqKey = await extractUserGroqKeyWithDb(req as any) || extractUserGroqKey(req as Request)
    const result = await convertFileToLatex(buffer, fileName, mimeType, userGroqKey || undefined)
    // For text-only JSON uploads, ensure returned fileName reflects input
    res.json({
      latex: result.latex,
      rawText: result.rawText.slice(0, 8000),
      rawLength: result.rawText.length,
      data: result.data,
      usedAI: result.usedAI,
      method: result.method,
      hasGroq: result.hasGroq,
      fileName: result.fileName,
      mimeType: result.mimeType,
    })
  } catch (err: any) {
    logger.error({ err: err }, '[resume/convert-to-latex] failed')
    res.status(500).json({ error: err.message || 'Failed to convert to LaTeX' })
  }
})

// ===================== EXPORT DOCX / TXT / JSON =====================
/**
 * POST /api/resume/export-docx
 * Body: ResumeData JSON
 * Returns: .docx as attachment (via docx lib mirror of jsPDF templates)
 */
router.post('/export-docx', limiter, async (req: Request, res: Response) => {
  const parsed = resumeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid ResumeData', details: parsed.error.flatten() })
    return
  }
  const data = parsed.data as any
  try {
    const { generateDocxBuffer, getDocxFilename } = await import('../services/resumeDocx')
    const buffer: Buffer = await generateDocxBuffer(data)
    const filename = getDocxFilename(data)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Docx-Template', data.template || 'source-split')
    res.send(buffer)
  } catch (err: any) {
    logger.error({ err: err }, '[resume/export-docx] failed')
    res.status(500).json({ error: err.message || 'Failed to generate DOCX' })
  }
})

router.get('/export-docx/health', (_req, res) => {
  res.json({
    ok: true,
    endpoint: 'POST /api/resume/export-docx',
    accepts: 'ResumeData JSON',
    returns: '.docx attachment (docx Document, Paragraph, AlignmentType, etc.) mirror of jsPDF templates',
    templates: ['classic','modern','minimal','source-split','compact','custom','asis'],
    note: 'Uses docx lib; same content as PDF export (header, summary, skills, experience, projects, education)',
  })
})

/**
 * POST /api/resume/export-txt
 * Body: ResumeData JSON
 * Returns: .txt as attachment (plain text ATS-safe)
 */
router.post('/export-txt', limiter, async (req: Request, res: Response) => {
  const parsed = resumeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid ResumeData', details: parsed.error.flatten() })
    return
  }
  const data = parsed.data as any
  try {
    // Inline TXT generation (mirror frontend lib/resumeTxt.ts)
    const p = data.personalInfo || {}
    const lines: string[] = []
    const hr = '------------------------------------------------------------'
    lines.push((p.fullName || 'Your Name').toUpperCase())
    if (p.headline?.trim()) lines.push(p.headline.trim())
    lines.push('')
    const contact: string[] = []
    if (p.email?.trim()) contact.push(`Email: ${p.email.trim()}`)
    if (p.phone?.trim()) contact.push(`Phone: ${p.phone.trim()}`)
    if (p.location?.trim()) contact.push(`Location: ${p.location.trim()}`)
    for (const l of (p.links || []).filter((x: any) => x.url?.trim())) contact.push(`${l.label}: ${l.url.trim()}`)
    if (contact.length) lines.push(contact.join(' | '))
    lines.push(hr)
    const cfg: any = data.customConfig
    const isCustom = data.template === 'custom'
    const hidden = new Set(isCustom && cfg?.hiddenSections ? cfg.hiddenSections : [])
    const order: string[] = isCustom && Array.isArray(cfg?.sectionOrder) && cfg.sectionOrder.length ? cfg.sectionOrder : ['summary','skills','experience','projects','education','certifications']
    const sec = (t: string) => `\n${t.toUpperCase()}\n${hr}\n`
    const builders: Record<string, () => string[]> = {
      summary: () => !p.summary?.trim() || hidden.has('summary') ? [] : [sec('Summary'), p.summary.trim(), ''],
      skills: () => {
        const sk: string[] = data.skills || []
        if (!sk.length || hidden.has('skills')) return []
        const hasColon = sk.some((s: string) => String(s).includes(':'))
        if (hasColon) return [sec('Technical Skills'), ...sk.map((s: string) => `- ${String(s).trim()}`), '']
        return [sec('Technical Skills'), sk.join(', '), '']
      },
      experience: () => {
        if (!data.experience?.length || hidden.has('experience')) return []
        const out: string[] = [sec('Experience')]
        for (const exp of data.experience) {
          const role = String(exp.role || 'Role').trim() || 'Role'
          const company = String(exp.company || 'Company').trim() || 'Company'
          const loc = exp.location?.trim() ? ` | ${exp.location.trim()}` : ''
          const date = [exp.startDate?.trim(), exp.endDate?.trim()].filter(Boolean).join(' - ')
          out.push(`${role} — ${company}${loc}${date ? `  (${date})` : ''}`)
          for (const b of (exp.bullets || []).map((x: string) => String(x).trim()).filter(Boolean)) out.push(`  - ${b}`)
          out.push('')
        }
        return out
      },
      projects: () => {
        if (!data.projects?.length || hidden.has('projects')) return []
        const out: string[] = [sec('Projects')]
        for (const proj of data.projects) {
          const title = String(proj.title || 'Untitled').trim() || 'Untitled'
          const tech = proj.tech?.length ? ` [${proj.tech.join(', ')}]` : ''
          const date = proj.date?.trim() ? ` (${proj.date.trim()})` : ''
          out.push(`${title}${tech}${date}`)
          if (proj.description?.trim()) out.push(`  ${proj.description.trim()}`)
          if (proj.link?.trim()) out.push(`  Link: ${proj.link.trim()}`)
          out.push('')
        }
        return out
      },
      education: () => {
        if (!data.education?.length || hidden.has('education')) return []
        const out: string[] = [sec('Education')]
        for (const ed of data.education) {
          const degree = String(ed.degree || 'Degree').trim() || 'Degree'
          const school = String(ed.school || 'Institution').trim() || 'Institution'
          const loc = ed.location?.trim() ? `, ${ed.location.trim()}` : ''
          const date = [ed.startDate?.trim(), ed.endDate?.trim()].filter(Boolean).join(' - ')
          out.push(`${degree} — ${school}${loc}${date ? `  (${date})` : ''}`)
          if (ed.cgpa?.trim()) out.push(`  CGPA: ${ed.cgpa.trim()}`)
          out.push('')
        }
        return out
      },
      certifications: () => {
        const certs: any[] = (data as any).certifications || []
        if (!certs?.length || hidden.has('certifications')) return []
        const out: string[] = [sec('Certifications')]
        for (const c of certs) {
          const name = String(c.name || 'Certification').trim() || 'Certification'
          const issuer = c.issuer?.trim() ? ` — ${c.issuer.trim()}` : ''
          const date = c.date?.trim() ? ` (${c.date.trim()})` : ''
          out.push(`${name}${issuer}${date}`)
          if (c.url?.trim()) out.push(`  Verify: ${c.url.trim()}`)
          out.push('')
        }
        return out
      },
    }
    for (const id of order) {
      const b = (builders as any)[id]
      if (b) lines.push(...b())
    }
    lines.push(hr)
    lines.push('Generated by CampusFlow — ATS TXT (plain text, copy-paste safe)')
    const txt = lines.join('\n').replace(/\n{3,}/g, '\n\n')
    const safeFilename = (p.fullName || 'Resume').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'Resume'
    const filename = `${safeFilename}_Resume.txt`
    const buf = Buffer.from(txt, 'utf-8')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(buf.length))
    res.setHeader('Cache-Control', 'no-store')
    res.send(buf)
  } catch (err: any) {
    logger.error({ err: err }, '[resume/export-txt] failed')
    res.status(500).json({ error: err.message || 'Failed to generate TXT' })
  }
})

router.get('/export-txt/health', (_req, res) => {
  res.json({ ok: true, endpoint: 'POST /api/resume/export-txt', returns: '.txt ATS-safe plain text (dash bullets, headings)' })
})

// Detailed health for convert — now reports per-user Groq key + global model + canvas
router.get('/convert-to-latex/health', async (req: Request, res) => {
  const userGroqKey = extractUserGroqKey(req)
  const hasUserGroq = Boolean(userGroqKey && String(userGroqKey).trim().length>10)
  let globalModel: any = null
  let canvasAvailable = false
  try { globalModel = await getResumeGlobalModelInfo() } catch {}
  try { canvasAvailable = await getCanvasAvailable() } catch {}
  res.json({
    ok: true,
    endpoint: 'POST /api/resume/convert-to-latex',
    accepts: 'multipart "file" (pdf/docx/txt/png/jpg/webp, 8MB) or JSON { rawText } — send your Groq key via header X-GROQ-API-KEY',
    hasUserGroq,
    globalModel,
    canvasAvailable,
    strategy: 'Image: user Groq Vision + global model (AI Manager qwen/qwen3-32b) -> LaTeX; PDF/DOCX/TXT: pdf-parse/mammoth -> AI text->LaTeX (user key + global gpt-oss-120b) -> heuristic fallback; Scanned PDF: optional canvas dynamic import (pdfjs getPage->canvas.toDataURL->base64->visionCompletion) graceful fallback',
    placeholderWhenMissing: 'Add your Groq API key in Settings → AI to enable Vision & AI Summarize/Upgrade. Remaining features (heuristic parse, template selection, manual editing, export PDF/DOCX/TXT/JSON) work without API.',
    fallback: 'heuristicParseTextToResumeData + generateResumeLatex (source-split) — always returns compilable LaTeX',
    research: 'pdf2tex, gptpdf_LaTeX (YOLO + Qwen), TexOCR — vision RAG pipeline; Groq qwen/qwen3-32b vision for image, gpt-oss-120b for text',
    returns: '{ latex, rawText, data, usedAI, method, hasGroq (per-user), fileName, mimeType }',
  })
})

export default router
