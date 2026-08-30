import { Router, Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import multer from 'multer'
import { generateResumeLatex } from '../services/resumeLatex'
import { generateVectorPdfBuffer, generateResumePdfBuffer, generateResumePdfWithMeta } from '../services/resumePdf'
import { aiChat } from '../ai/client'
import { config } from '../config'
import { authenticate, AuthRequest } from '../middleware/auth'

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
  template: z.preprocess(emptyStrToUndef, z.enum(['classic', 'modern', 'minimal', 'source-split', 'compact']).optional().default('source-split')),
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
    console.warn('[resume ai] fallback due to error', e)
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
      console.error('[resume/latex pdf] generation failed', err)
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
router.post('/ai-upgrade', aiLimiter, async (req: Request, res: Response) => {
  const parsed = aiUpgradeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() })
    return
  }
  const { data, mode, jobDescription, prompt, targetId } = parsed.data

  // If GROQ not configured, we still provide heuristic enhancement but flag it
  const hasGroq = Boolean(config.groqApiKey && config.groqApiKey !== 'your-groq-api-key-here')
  // Try AI first
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
    aiResult = await tryAI(baseSystem, userPrompt, { temperature: 0.7, max_tokens: 600 })
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
    // heuristic
    const enhanced = heuristicEnhanceSummary(data.personalInfo.summary || '')
    res.json({ mode, usedAI: false, hasGroq, result: { summary: enhanced }, heuristic: true })
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
    aiResult = await tryAI(baseSystem, userPrompt, { temperature: 0.6, max_tokens: 1000 })
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
    res.json({ mode, usedAI: false, hasGroq, result: { bullets: improved }, heuristic: true })
    return
  }

  if (mode === 'skills') {
    const jd = (jobDescription || prompt || '').slice(0, 4000)
    const userPrompt = `Given resume skills: ${data.skills.join(', ') || '(none)'} and JD: """${jd}"""
Suggest 10-15 ATS keywords to add (only truthful extensions, no hallucination). Return JSON: { "suggestedSkills": ["skill1", ...], "reason": "why" }`
    aiResult = await tryAI(baseSystem, userPrompt, { temperature: 0.5, max_tokens: 800 })
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
    // heuristic suggestion
    const pool = ['React', 'TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'MongoDB', 'Docker', 'AWS', 'Git', 'REST APIs', 'Tailwind CSS', 'Next.js']
    const missing = pool.filter(s => !data.skills.map((x: string) => x.toLowerCase()).includes(s.toLowerCase())).slice(0, 8)
    res.json({ mode, usedAI: false, hasGroq, result: { suggestedSkills: missing, reason: 'Heuristic — add missing baseline stack where you have experience' }, heuristic: true })
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
    aiResult = await tryAI(baseSystem, userPrompt, { temperature: 0.6, max_tokens: 2200 })
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
    // heuristic tailor: boost JD keywords in summary/skills
    const jdTokens = jd.toLowerCase().match(/[a-z0-9+#.]{3,}/g) || []
    const uniq = Array.from(new Set(jdTokens.filter(t => t.length > 3))).slice(0, 12)
    const tailoredSummary = heuristicEnhanceSummary(data.personalInfo.summary || '') + (uniq.length ? ` Aligned with ${uniq.slice(0, 4).join(', ')}.` : '')
    const boostedSkills = Array.from(new Set([...uniq.slice(0, 6).map(s => s.charAt(0).toUpperCase() + s.slice(1)), ...data.skills])).slice(0, 14)
    res.json({ mode, usedAI: false, hasGroq, result: { personalInfo: { summary: tailoredSummary, headline: data.personalInfo.headline }, skills: boostedSkills, experience: data.experience, suggestions: ['Heuristic tailor — for best results configure GROQ_API_KEY or AI Manager provider'] }, heuristic: true })
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
    aiResult = await tryAI(baseSystem, userPrompt, { temperature: 0.6, max_tokens: 3000 })
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
        console.warn('full upgrade JSON parse failed', e)
      }
    }
    // heuristic full
    const upgradedHeuristic = {
      ...data,
      personalInfo: { ...data.personalInfo, summary: heuristicEnhanceSummary(data.personalInfo.summary || '') },
      skills: Array.from(new Set([...data.skills, 'React', 'Node.js', 'TypeScript'].filter(Boolean))).slice(0, 15),
      experience: data.experience.map(exp => ({ ...exp, bullets: heuristicImproveBullets(exp.bullets) })),
      updatedAt: new Date().toISOString(),
    }
    res.json({ mode: 'full', usedAI: false, hasGroq, result: { data: upgradedHeuristic }, heuristic: true, note: 'Configure GROQ_API_KEY for higher quality LLM upgrade' })
    return
  }
})

/**
 * POST /api/resume/ai-enhance — alias for /ai-upgrade (frontend convenience)
 */
router.post('/ai-enhance', aiLimiter, async (req: Request, res: Response) => {
  // Forward to ai-upgrade handler by reusing schema
  req.url = '/ai-upgrade'
  // @ts-ignore
  router.handle(req, res)
})

/**
 * POST /api/resume/ats-score
 * Body: { data: ResumeData, jobDescription?: string }
 */
router.post('/ats-score', aiLimiter, async (req: Request, res: Response) => {
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

  // Try AI augmentation if available
  let aiInsights: string | null = null
  if (jd.trim() || true) {
    const prompt = `Score this resume ATS 0-100 and give brief 5 bullet feedback vs JD.
Resume: ${JSON.stringify({ personalInfo: d.personalInfo, skills: d.skills, projects: d.projects, experience: d.experience, education: d.education }).slice(0, 5000)}
JD: """${jd.slice(0, 3000)}"""
Return JSON: { "aiScore": 0-100, "feedback": ["..."], "missingKeywords": ["..."] }`
    const aiRaw = await tryAI('You are an ATS evaluator like Rezi. Be strict, helpful, concise. Return only JSON.', prompt, { temperature: 0.3, max_tokens: 900 })
    if (aiRaw) {
      try {
        const m = aiRaw.match(/\{[\s\S]*\}/)
        const j = JSON.parse(m ? m[0] : aiRaw)
        aiInsights = aiRaw
        // Blend scores: heuristic 60% + ai 40% if both present
        if (typeof j.aiScore === 'number') {
          const blended = Math.round(heuristic.score * 0.6 + Math.min(100, Math.max(0, j.aiScore)) * 0.4)
          res.json({ ...heuristic, aiScore: j.aiScore, blendedScore: blended, aiFeedback: j.feedback, aiMissingKeywords: j.missingKeywords, usedAI: true, hasGroq: Boolean(config.groqApiKey), raw: aiRaw })
          return
        }
      } catch {}
      res.json({ ...heuristic, aiFeedbackRaw: aiRaw, usedAI: true, hasGroq: Boolean(config.groqApiKey) })
      return
    }
  }
  res.json({ ...heuristic, usedAI: false, hasGroq: Boolean(config.groqApiKey) })
})

// ===================== PARSE / UPLOAD =====================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
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
      console.warn('mammoth extract failed', e)
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
      console.warn('pdf-parse failed', (e as any)?.message || e)
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

    // Heuristic parse first
    const heuristicData = heuristicParseTextToResumeData(rawText)

    // Try AI structuring if available
    let aiData: any = null
    let usedAI = false
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
    const aiRaw = await tryAI(aiSystem, `Raw resume text:\n"""${rawText.slice(0, 8000)}"""\nReturn JSON ResumeData only.`, { temperature: 0.2, max_tokens: 2500 })
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
        console.warn('AI parse JSON failed, using heuristic', e)
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
      hasGroq: Boolean(config.groqApiKey),
    })
  } catch (err: any) {
    console.error('[resume/parse] failed', err)
    res.status(500).json({ error: err.message || 'Failed to parse resume' })
  }
})

// Alias for convenience — same as /parse but with text field
router.post('/parse-text', parseLimiter, authenticate, async (req: AuthRequest, res: Response) => {
  const { rawText, text } = req.body || {}
  const t = rawText || text || ''
  if (!t || String(t).trim().length < 10) {
    res.status(400).json({ error: 'Provide { rawText } with resume text' })
    return
  }
  const heuristicData = heuristicParseTextToResumeData(String(t))
  const aiSystem = `You are a resume parser — output JSON only.`
  const aiRaw = await tryAI(aiSystem, `Parse this resume text to JSON ResumeData:\n"""${String(t).slice(0, 8000)}"""`, { temperature: 0.2, max_tokens: 2500 })
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
  res.json({ data: aiData || heuristicData, rawText: String(t).slice(0, 4000), usedAI, hasGroq: Boolean(config.groqApiKey) })
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

export default router
