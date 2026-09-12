/**
 * CampusFlow — Resume Convert to LaTeX service
 * Converts PDF / Image / DOCX / TXT into LaTeX source for 1:1 line mapping inside LatexSourceEditor.
 * 
 * Strategy (MVP reliable):
 *  1) Image (png/jpg/webp/bmp/tiff) -> Groq Vision (qwen vision) -> LaTeX, fallback to placeholder latex.
 *  2) PDF / DOCX / TXT -> extract raw text (pdf-parse / mammoth), then:
 *     2a) try AI text->LaTeX (aiChat) for faithful structure, 
 *     2b) fallback to heuristic parse + generateResumeLatex (template classic/source-split).
 *
 * Research notes (websearch 2025):
 *  - Best OSS: pdf2tex / gptpdf_LaTeX use YOLO figure detection + VLM (GPT-4o/Qwen) to produce LaTeX.
 *  - Groq docs: qwen/qwen3.6-27b & qwen/qwen3.8-27b support vision image_url + JSON mode.
 *  - For scanned PDFs, text extraction is empty -> vision path recommended; for now we degrade to placeholder latex + hint.
 */
import { aiChatWithUserKey, visionCompletionWithUserKey } from '../ai/client'
import { getProviderForFeature, getProvidersForFeature } from '../services/ai-manager'
import { generateResumeLatex } from './resumeLatex'
import { logger } from '../utils/logger'

const NOT_CONFIGURED = 'AI provider not configured. Please set up a provider in AI Manager.'

// Helper to check if canvas is available (optional dep)
let canvasAvailableCache: boolean | null = null
async function isCanvasAvailable(): Promise<boolean> {
  if (canvasAvailableCache !== null) return canvasAvailableCache
  try {
    const mod: any = await import('canvas')
    const ok = Boolean(mod.createCanvas || mod.Canvas || mod.default?.createCanvas)
    canvasAvailableCache = ok
    return ok
  } catch {
    canvasAvailableCache = false
    return false
  }
}
export async function getCanvasAvailable(): Promise<boolean> { return isCanvasAvailable() }

// Global model info for resume feature (superadmin's AI Manager)
// vision -> qwen/qwen3-32b default (spec mentions qwen/qwen3.6-27b), text -> openai/gpt-oss-120b
export async function getResumeGlobalModelInfo(): Promise<{ visionModel: string; textModel: string; visionBaseUrl: string; textBaseUrl: string }> {
  try {
    const providersVision = await getProvidersForFeature('resume-vision').catch(()=>[] as any)
    const providersResume = await getProvidersForFeature('resume').catch(()=>[] as any)
    const visionProv = (providersVision[0] || providersResume.find((p:any)=> String(p.model).toLowerCase().includes('qwen')) || providersResume[0]) as any
    const textProv = providersResume[0] as any
    const visionModel = visionProv?.model || 'qwen/qwen3-32b'
    const textModel = textProv?.model || 'openai/gpt-oss-120b'
    const visionBaseUrl = visionProv?.baseUrl || 'https://api.groq.com/openai/v1'
    const textBaseUrl = textProv?.baseUrl || 'https://api.groq.com/openai/v1'
    return { visionModel, textModel, visionBaseUrl, textBaseUrl }
  } catch {
    return { visionModel: 'qwen/qwen3-32b', textModel: 'openai/gpt-oss-120b', visionBaseUrl: 'https://api.groq.com/openai/v1', textBaseUrl: 'https://api.groq.com/openai/v1' }
  }
}

function sanitizeUserKey(k?: string | null): string {
  const s = String(k || '').trim()
  if (!s || s.length < 10) return ''
  return s
}

function isValidLatex(s: string): boolean {
  if (!s || s.trim().length < 40) return false
  const t = s.trim()
  // Must contain document structure
  if (t.includes('\\begin{document}') && t.includes('\\end{document}')) return true
  if (t.includes('\\documentclass') && t.length > 200) return true
  // Some models return markdown-wrapped latex
  if (t.includes('```')) {
    const inner = t.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
    if (inner.includes('\\begin{document}')) return true
  }
  return false
}

function extractLatexFromMaybeMarkdown(s: string): string {
  if (!s) return s
  let t = s.trim()
  // Remove markdown fences
  if (t.includes('```')) {
    const m = t.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i)
    if (m && m[1]) t = m[1].trim()
    else {
      t = t.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
    }
  }
  // If model wrapped in JSON { latex: "..." }
  if (t.startsWith('{') && t.includes('latex')) {
    try {
      const j = JSON.parse(t)
      if (j.latex && typeof j.latex === 'string' && j.latex.includes('\\')) {
        return j.latex
      }
    } catch {}
    const m2 = t.match(/\{[\s\S]*\}/)
    if (m2) {
      try {
        const j2 = JSON.parse(m2[0])
        if (j2.latex) return String(j2.latex)
      } catch {}
    }
  }
  return t
}

function sanitizeLatexOutput(s: string): string {
  let t = extractLatexFromMaybeMarkdown(s)
  // Ensure we have at least document begin/end
  // If truncated, return as-is but valid check will handle
  return t
}

// ---------------- Heuristic parse (mirrors resume route, kept in sync) ----------------
function heuristicParseTextToResumeData(rawText: string, fallbackName?: string): any {
  const text = rawText || ''
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const email = emailMatch ? emailMatch[0] : ''

  const phoneMatch = text.match(/(\+91[\s-]?)?[6-9]\d{9}|\(\d{3}\)\s*\d{3}-\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/)
  const phone = phoneMatch ? phoneMatch[0].trim() : ''

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

  let fullName = fallbackName || ''
  if (!fullName) {
    for (const l of lines.slice(0, 5)) {
      if (l.length > 40) continue
      if (email && l.includes(email)) continue
      if (/@/.test(l)) continue
      if (/^\d/.test(l)) continue
      if (/(resume|cv|curriculum)/i.test(l)) continue
      const words = l.split(/\s+/).filter(Boolean)
      if (words.length >= 2 && words.length <= 4 && /^[A-Za-z\s'.-]+$/.test(l)) {
        if (!fullName) fullName = l
      }
    }
    if (!fullName && lines[0] && lines[0].length < 40) fullName = lines[0]
  }

  const locMatch = text.match(/\b(Delhi|Mumbai|Bengaluru|Bangalore|Hyderabad|Chennai|Pune|Kolkata|Noida|Gurgaon|Jaipur|Ahmedabad|India)\b[^.\n]{0,20}/i)
  const location = locMatch ? locMatch[0].trim().slice(0, 60) : ''

  let headline = ''
  if (fullName) {
    const idx = lines.findIndex(l => l === fullName)
    if (idx >= 0 && lines[idx + 1] && lines[idx + 1].length < 80 && /(developer|engineer|student|intern|designer|analyst|science|technology|frontend|backend|full.stack)/i.test(lines[idx + 1])) {
      headline = lines[idx + 1].slice(0, 100)
    }
  }

  let summary = ''
  const summaryIdx = lines.findIndex(l => /^summary|objective|about/i.test(l))
  if (summaryIdx >= 0) {
    summary = lines.slice(summaryIdx + 1, summaryIdx + 4).join(' ').slice(0, 500)
  } else if (lines.length > 3) {
    const candidate = lines.find(l => l.split(' ').length > 12 && l.length > 80 && l.length < 500)
    if (candidate) summary = candidate.slice(0, 500)
  }

  let skills: string[] = []
  const skillsIdx = lines.findIndex(l => /^skills/i.test(l))
  if (skillsIdx >= 0) {
    const skillLines = lines.slice(skillsIdx + 1, skillsIdx + 5).join(' ')
    skills = skillLines.split(/[,•|·;/\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 20)
    skills = skills.filter(s => s.length < 30 && s.split(' ').length <= 3)
  } else {
    const known = ['JavaScript','TypeScript','React','Node.js','Express','Python','Java','C++','C','SQL','PostgreSQL','MongoDB','Docker','AWS','Git','HTML','CSS','Tailwind','Next.js','Vue','Angular','Spring','Django','Flask','Kubernetes','GraphQL','REST','Redux','Prisma','NestJS','Figma','Photoshop']
    const lowerText = text.toLowerCase()
    skills = known.filter(k => lowerText.includes(k.toLowerCase())).slice(0, 15)
  }

  const projects: any[] = []
  const projIdx = lines.findIndex(l => /^projects?/i.test(l))
  if (projIdx >= 0) {
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

async function tryAI(promptSystem: string, promptUser: string, userApiKey?: string, opts?: any): Promise<string | null> {
  const key = sanitizeUserKey(userApiKey)
  if (!key) return null
  try {
    const res = await aiChatWithUserKey('resume', promptSystem, promptUser, key, { temperature: 0.3, max_tokens: 8192, ...opts })
    if (!res || res === NOT_CONFIGURED || res.includes('AI provider not configured')) return null
    return res
  } catch (e) {
    logger.warn({ err: e }, '[resumeConvert ai] fallback')
    return null
  }
}

async function extractTextFromBuffer(buffer: Buffer, originalName: string, mimetype: string): Promise<string> {
  const ext = (originalName.split('.').pop() || '').toLowerCase()
  if (ext === 'txt' || mimetype === 'text/plain') {
    return buffer.toString('utf-8')
  }
  if (ext === 'docx' || mimetype.includes('wordprocessingml') || mimetype === 'application/msword') {
    try {
      const mammoth: any = await import('mammoth')
      const mod: any = (mammoth as any).default || mammoth
      const result = await mod.extractRawText({ buffer })
      if (result.value?.trim()) return result.value
    } catch (e) {
      logger.warn({ err: e }, 'mammoth extract failed')
    }
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
      try { await parser?.destroy() } catch {}
    }
    return ''
  }
  // For other types (image will be handled separately)
  return buffer.toString('utf-8').slice(0, 15000)
}

function buildTextToLatexPrompt(rawText: string): { system: string; user: string } {
  const system = `You are an expert LaTeX resume engineer (like Overleaf templates). Convert raw resume text into compilable, ATS-friendly LaTeX.
Rules:
- Output ONLY valid LaTeX code, no markdown, no explanation, no fences.
- Use classic Jake single-column ATS style: \\documentclass[11pt,a4paper]{article} with geometry 0.55in, lmodern, enumitem, titlesec, xcolor, hyperref hidelinks, no custom .cls.
- Structure: centered header (name small caps Huge), headline italic, contact line with hyperlinks separated by $|$, then sections: Summary, Skills, Experience, Projects, Education, Certifications (only include sections that have content).
- Skills: inline comma list. Experience: \\textbf{Role} --- \\textit{Company} \\hfill Date \\\\ + itemize bullets (each bullet 1 line, action verb, quantify if possible). Projects: \\textbf{Title} + italic tech + description + href link. Education: degree --- school \\hfill date.
- Escape LaTeX special chars (& % $ # _ { } ~ ^ \\ ) correctly. Use \\& \\% \\$ etc.
- Keep dates/companies truthful - do not hallucinate employers. You may rephrase bullets but keep meaning.
- Ensure document compiles with pdflatex (no missing packages).
- Return between \\documentclass and \\end{document} inclusive.`

  const user = `Raw resume text to convert to LaTeX (preserve all info, do not invent):
"""${rawText.slice(0, 12000)}"""

Return ONLY LaTeX code. Start with \\documentclass and end with \\end{document}.`
  return { system, user }
}

function buildVisionPrompt(): string {
  return `You are an expert LaTeX OCR. Convert this resume image/PDF page into compilable LaTeX code.
Rules:
- Output ONLY LaTeX code, no markdown fences, no explanation.
- Replicate structure faithfully: preserve sections, headings, bullets, contact details, dates.
- Use Jake single-column ATS: \\documentclass[11pt,a4paper]{article} + geometry 0.55in + lmodern + enumitem + titlesec + xcolor + hyperref hidelinks. No custom cls.
- Center header (name Huge scshape), headline italic, contact line with hyperlinks ($|$ separator).
- Experience: role/company + bullets. Projects: title + tech + description + links. Education: degree/school/date.
- Escape & % $ # _ { } ~ ^ \\ correctly.
- Keep facts truthful; do not hallucinate missing data.
- Ensure pdflatex compilable. Return \\documentclass to \\end{document}.`
}

async function aiTextToLatex(rawText: string, userApiKey?: string): Promise<string | null> {
  const key = sanitizeUserKey(userApiKey)
  if (!key) return null
  const { system, user } = buildTextToLatexPrompt(rawText)
  const raw = await tryAI(system, user, key, { temperature: 0.2, max_tokens: 8192 })
  if (!raw) return null
  const cleaned = sanitizeLatexOutput(raw)
  if (isValidLatex(cleaned)) return cleaned
  // Try once more with stricter instruction if first attempt invalid
  if (cleaned.length > 200 && cleaned.includes('\\')) {
    // Accept even if not perfect but looks like latex
    return cleaned
  }
  return null
}

async function aiVisionToLatex(base64: string, mimeType: string, userApiKey?: string): Promise<string | null> {
  const key = sanitizeUserKey(userApiKey)
  if (!key) return null
  try {
    const dataUrl = `data:${mimeType || 'image/png'};base64,${base64}`
    const system = buildVisionPrompt()
    const userText = `Convert this resume image to LaTeX. Return ONLY LaTeX code (\\documentclass ... \\end{document}), no markdown.`
    // Use visionCompletionWithUserKey — per-user key + global model (superadmin's AI Manager)
    const messages: any[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
    // Pass to vision feature that prefers qwen vision model when superadmin configured it
    // Try 'resume-vision' first (vision model), fallback to 'resume'
    let res: string | null = null
    try {
      res = await visionCompletionWithUserKey('resume-vision', messages as any, key, { temperature: 0.1, max_tokens: 16384 })
    } catch {}
    if (!res || res === NOT_CONFIGURED || res.includes('AI provider not configured')) {
      res = await visionCompletionWithUserKey('resume', messages as any, key, { temperature: 0.1, max_tokens: 16384 })
    }
    if (!res || res === NOT_CONFIGURED || res.includes('AI provider not configured')) return null
    const cleaned = sanitizeLatexOutput(res)
    if (isValidLatex(cleaned)) return cleaned
    if (cleaned.length > 200 && cleaned.includes('\\begin')) return cleaned
    logger.warn({ err: cleaned.slice(0, 300) }, '[resumeConvert vision] invalid latex, preview:')
    return null
  } catch (e) {
    logger.warn({ err: e }, '[resumeConvert vision] failed')
    return null
  }
}

export type ConvertResult = {
  latex: string
  rawText: string
  data: any
  usedAI: boolean
  method: 'vision' | 'ai-text' | 'heuristic' | 'fallback-placeholder'
  hasGroq: boolean
  fileName: string
  mimeType: string
}

export async function convertFileToLatex(buffer: Buffer, fileName: string, mimeType: string, userApiKey?: string): Promise<ConvertResult> {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  const isImage = mimeType.startsWith('image/') || ['png','jpg','jpeg','webp','bmp','tiff','tif'].includes(ext)
  const sanitizedKey = sanitizeUserKey(userApiKey)
  const hasGroq = Boolean(sanitizedKey)
  const globalModelInfo = await getResumeGlobalModelInfo().catch(()=>({ visionModel:'qwen/qwen3-32b', textModel:'openai/gpt-oss-120b', visionBaseUrl:'', textBaseUrl:'' }))

  // Image path: vision — requires per-user Groq key (spec: placeholder if missing)
  if (isImage) {
    if (!hasGroq) {
      const heuristicData = heuristicParseTextToResumeData(`Image file ${fileName} — vision unavailable. Replace this placeholder.`)
      const fallbackLatex = generateResumeLatex(heuristicData)
      const withComment = `% Image: ${fileName} — Vision AI unavailable.\n% Add your Groq API key in Settings → AI to enable Vision & AI Summarize/Upgrade.\n% Your key will use the global model (${globalModelInfo.visionModel}) configured by superadmin in AI Manager.\n% Original image preserved as as-is asset; LaTeX below is editable placeholder. Remaining features (heuristic parse, manual edit, export PDF/DOCX/TXT/JSON) work without API.\n` + fallbackLatex
      return { latex: withComment, rawText: `[Image without AI — Add Groq API key in Settings → AI] ${fileName}`, data: heuristicData, usedAI: false, method: 'fallback-placeholder', hasGroq, fileName, mimeType }
    }
    const base64 = buffer.toString('base64')
    let latex = await aiVisionToLatex(base64, mimeType || `image/${ext || 'png'}`, sanitizedKey)
    if (latex) {
      const heuristicData = heuristicParseTextToResumeData(`Image resume ${fileName}`)
      return { latex, rawText: `[Image vision -> LaTeX via ${globalModelInfo.visionModel}] ${latex.slice(0, 4000)}`, data: heuristicData, usedAI: true, method: 'vision', hasGroq, fileName, mimeType }
    }
    // Fallback placeholder when vision failed even with key
    const heuristicData = heuristicParseTextToResumeData(`Image file ${fileName} — vision unavailable. Replace this placeholder.`)
    const fallbackLatex = generateResumeLatex(heuristicData)
    const withComment = `% Image: ${fileName} — Groq Vision failed with your key (model ${globalModelInfo.visionModel}).\n% Try again, or edit this placeholder LaTeX or re-upload a text PDF/DOCX.\n% Original image preserved as as-is asset.\n` + fallbackLatex
    return { latex: withComment, rawText: `[Image vision failed] ${fileName}`, data: heuristicData, usedAI: false, method: 'fallback-placeholder', hasGroq, fileName, mimeType }
  }

  // Scanned PDF vision helper — optional canvas dynamic import with graceful fallback
  // If canvas not available, placeholder: "Scanned PDF detected — add Groq key and ensure canvas available or upload text-based PDF"
  async function tryScannedPdfVision(pdfBuffer: Buffer): Promise<string | null> {
    try {
      // Vision requires per-user Groq key — if missing, skip to placeholder
      if (!hasGroq) return null
      const canvasOk = await isCanvasAvailable()
      if (!canvasOk) {
        logger.warn('[resumeConvert] canvas not available for scanned PDF vision — fallback to placeholder')
        return null
      }
      let pdfjs: any = null
      try {
        pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      } catch {
        try {
          pdfjs = await import('pdfjs-dist')
        } catch (e) {
          logger.warn({ err: e }, '[resumeConvert] pdfjs-dist not available')
          return null
        }
      }
      const actual = pdfjs.default || pdfjs
      let createCanvas: any = null
      try {
        const canvasMod: any = await import('canvas')
        createCanvas = canvasMod.createCanvas || canvasMod.default?.createCanvas || canvasMod.Canvas
      } catch (e) {
        logger.warn({ err: (e as any)?.message || e }, '[resumeConvert] canvas not available for scanned PDF vision')
        return null
      }
      if (!createCanvas) return null
      const data = new Uint8Array(pdfBuffer)
      // Disable worker for Node stability
      const loadingTask = actual.getDocument({ data, useSystemFonts: true, disableWorker: true } as any)
      const pdfDoc: any = await loadingTask.promise
      // Render first page (most resumes are 1 page; rendering 1 page keeps token/latency bounded)
      const page = await pdfDoc.getPage(1)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas = createCanvas(viewport.width, viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        try { await pdfDoc.destroy() } catch {}
        return null
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx as any, viewport } as any).promise
      const dataUrl: string = canvas.toDataURL('image/png')
      const base64 = dataUrl.split(',')[1]
      try { await pdfDoc.destroy() } catch {}
      if (!base64) return null
      const visionLatex = await aiVisionToLatex(base64, 'image/png', sanitizedKey)
      return visionLatex
    } catch (e) {
      logger.warn({ err: (e as any)?.message || e }, '[resumeConvert] tryScannedPdfVision failed')
      return null
    }
  }

  // Non-image: extract text
  let rawText = ''
  try {
    rawText = await extractTextFromBuffer(buffer, fileName, mimeType)
  } catch (e) {
    logger.warn({ err: e }, 'extractText failed')
    rawText = ''
  }

  // If scanned PDF (empty text) but is PDF, try vision rendering via pdfjs canvas before placeholder for true 1:1 line mapping
  if (!rawText || rawText.trim().length < 20) {
    if (ext === 'pdf') {
      // Vision path: pdfjs getPage -> canvas -> base64 -> visionCompletion (Groq qwen/qwen3.6) for true 1:1 mapping
      try {
        const visionLatex = await tryScannedPdfVision(buffer)
        if (visionLatex && isValidLatex(visionLatex)) {
          const heuristicData = heuristicParseTextToResumeData(`Scanned PDF vision ${fileName}`)
          // Extract a rawText preview from vision latex for UI (strip latex tags roughly)
          const previewText = visionLatex.replace(/\\[a-zA-Z]+\{[^}]*\}/g, ' ').replace(/[\\{}]/g, ' ').slice(0, 4000)
          return { latex: visionLatex, rawText: previewText || `[Vision extracted ${fileName}]`, data: heuristicData, usedAI: true, method: 'vision', hasGroq, fileName, mimeType }
        }
      } catch (e) {
        logger.warn({ err: e }, '[resumeConvert] scanned PDF vision fallback')
      }
      // Fallback placeholder if vision unavailable/failed — per spec, show placeholder when user key missing
      const canvasOk2 = await isCanvasAvailable().catch(()=>false)
      const hint = !hasGroq
        ? 'Add your Groq API key in Settings → AI to enable Vision & AI Summarize/Upgrade. Your key will use the global model (' + globalModelInfo.visionModel + ') from superadmin AI Manager.'
        : !canvasOk2
          ? 'Scanned PDF detected — add Groq key and ensure canvas available or upload text-based PDF. Canvas package not available on this deploy.'
          : 'Groq Vision with your key failed or returned invalid LaTeX — edit this LaTeX directly or upload text-based PDF.'
      const heuristicData = heuristicParseTextToResumeData(`Scanned PDF ${fileName} — text extraction empty. Please ensure PDF is text-based or edit LaTeX manually.`)
      const fallbackLatex = generateResumeLatex(heuristicData)
      const withComment = `% Scanned PDF detected: ${fileName} (${(buffer.length/1024).toFixed(0)} KB)\n% pdf-parse found no selectable text. ${hint}\n% Remaining features (heuristic parse, template selection, manual editing, export) work without API.\n% Vision requires pdfjs-dist + optional canvas + your Groq API key, using global model ${globalModelInfo.visionModel}.\n` + fallbackLatex
      return { latex: withComment, rawText: rawText || `[No text extracted from ${fileName} — ${hint}]`, data: heuristicData, usedAI: false, method: 'fallback-placeholder', hasGroq, fileName, mimeType }
    }
    // Generic fallback for empty docx/txt
    const heuristicData = heuristicParseTextToResumeData(rawText || fileName)
    const fallbackLatex = generateResumeLatex(heuristicData)
    return { latex: fallbackLatex, rawText: rawText || '', data: heuristicData, usedAI: false, method: 'heuristic', hasGroq, fileName, mimeType }
  }

  // Have rawText: try AI text->latex — only if user provided Groq key (per spec, per-user key + global model)
  let latexAI: string | null = null
  if (hasGroq) {
    latexAI = await aiTextToLatex(rawText, sanitizedKey)
  }
  if (latexAI) {
    const heuristicData = heuristicParseTextToResumeData(rawText)
    return { latex: latexAI, rawText, data: heuristicData, usedAI: true, method: 'ai-text', hasGroq, fileName, mimeType }
  }

  // Fallback heuristic -> template
  const heuristicData = heuristicParseTextToResumeData(rawText)
  const latexHeuristic = generateResumeLatex(heuristicData)
  return { latex: latexHeuristic, rawText, data: heuristicData, usedAI: false, method: 'heuristic', hasGroq, fileName, mimeType }
}

// Also export helpers for route reuse
export { heuristicParseTextToResumeData, extractTextFromBuffer }
