import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Download, Save, Trash2, Copy, Globe, FileText, Loader2, Share2, FileCode, Layers, Upload, BarChart3, Target, FileUp, X, Lightbulb, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import type { ResumeData } from '../types/resume'
import { DEFAULT_TEMPLATE } from '../types/resume'
import { loadResume, saveResume, clearResume, emptyResumeData } from '../lib/resumeStorage'
import ResumePreview from '../components/resume/ResumePreview'
import ResumeForm from '../components/resume/ResumeForm'
import { resumeAPI } from '../lib/api'
import { generateResumeLatex, downloadTexFile } from '../lib/resumeLatex'
import { generateVectorPdfBlob } from '../lib/resumeVectorPdf'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'

export default function ResumeStudioPage() {
  const user = useAuthStore(s => s.user)
  const userId = user?.id || 'default'
  const navigate = useNavigate()
  const [data, setData] = useState<ResumeData>(() => emptyResumeData(user ? { name: user.name, email: user.email } : undefined))
  const [saving, setSaving] = useState(false)
  const [exportingVector, setExportingVector] = useState(false)
  const [exportingTex, setExportingTex] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [aiLoading, setAiLoading] = useState<string | null>(null)
  const [atsLoading, setAtsLoading] = useState(false)
  const [atsResult, setAtsResult] = useState<any | null>(null)
  const [showAtsModal, setShowAtsModal] = useState(false)
  const [showJDModal, setShowJDModal] = useState(false)
  const [jdText, setJdText] = useState('')
  const [jdMode, setJdMode] = useState<'tailor' | 'ats'>('tailor')
  const [uploading, setUploading] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Portal anchor — export dropdown must escape Layout stacking
  const exportBtnRef = useRef<HTMLButtonElement>(null)
  const [exportMenuRect, setExportMenuRect] = useState<DOMRect | null>(null)

  // Keep portal dropdown positioned correctly (resize/scroll)
  const updateExportRect = useCallback(() => {
    if (exportBtnRef.current) setExportMenuRect(exportBtnRef.current.getBoundingClientRect())
  }, [])
  useEffect(() => {
    if (!showExportMenu) return
    updateExportRect()
    window.addEventListener('resize', updateExportRect)
    window.addEventListener('scroll', updateExportRect, true)
    return () => {
      window.removeEventListener('resize', updateExportRect)
      window.removeEventListener('scroll', updateExportRect, true)
    }
  }, [showExportMenu, updateExportRect])
  // Keep body locked when any modal portal is open (prevents main scroll bleed)
  useEffect(() => {
    const anyModal = showAtsModal || showJDModal
    if (anyModal) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [showAtsModal, showJDModal])
  // Keep dropdown in sync immediately when opening
  useEffect(() => { if (showExportMenu) updateExportRect() }, [showExportMenu, updateExportRect])

  // Load on mount — ensure template always reflects selection (default DEFAULT_TEMPLATE)
  useEffect(() => {
    const stored = loadResume(userId)
    if (stored) {
      if (!stored.template) stored.template = DEFAULT_TEMPLATE
      setData(stored)
    } else {
      setData(emptyResumeData(user ? { name: user.name, email: user.email } : undefined))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Auto-save debounce
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        saveResume(userId, { ...data, updatedAt: new Date().toISOString() })
      } catch {}
    }, 800)
    return () => clearTimeout(t)
  }, [data, userId])

  const handleManualSave = () => {
    setSaving(true)
    try {
      saveResume(userId, { ...data, updatedAt: new Date().toISOString() })
      toast.success('Resume saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setTimeout(()=>setSaving(false), 400)
    }
  }

  const handleClear = () => {
    if (!window.confirm('Clear all resume data? This cannot be undone.')) return
    const fresh = emptyResumeData(user ? { name: user.name, email: user.email } : undefined)
    setData(fresh)
    clearResume(userId)
    toast.success('Cleared')
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      toast.success('Copied JSON to clipboard')
    } catch {
      toast.error('Copy failed')
    }
  }

  // ====== Client-side text extraction (fallback if backend parse fails) ======
  const extractTextClient = useCallback(async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (ext === 'txt' || file.type.includes('text')) {
      return await file.text()
    }
    if (ext === 'docx') {
      try {
        const mammoth: any = await import('mammoth')
        const mod = mammoth.default || mammoth
        const ab = await file.arrayBuffer()
        const result = await mod.extractRawText({ arrayBuffer: ab })
        if (result.value?.trim()) return result.value
      } catch (e) {
        console.warn('mammoth client failed', e)
      }
      // fallback to trying text
      return await file.text()
    }
    if (ext === 'pdf') {
      try {
        const pdfjs: any = await import('pdfjs-dist')
        // set worker — use CDN if not set
        if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`
        }
        const ab = await file.arrayBuffer()
        const loading = pdfjs.getDocument({ data: ab })
        const pdf = await loading.promise
        let full = ''
        for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          const strings = (content.items as any[]).map((it: any) => it.str || '').join(' ')
          full += strings + '\n'
        }
        if (full.trim().length > 20) return full
      } catch (e) {
        console.warn('pdfjs client failed, falling back to backend', e)
      }
      // Let backend try more robust pdf-parse
      throw new Error('PDF client extraction failed — will try server parse')
    }
    return await file.text()
  }, [])

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['pdf','docx','doc','txt']
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!allowed.includes(ext)) {
      toast.error('Upload PDF, DOCX or TXT only')
      return
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error('File too large — max 6MB')
      return
    }
    setUploading(true)
    try {
      // Try backend parse first (pdf-parse + mammoth + AI)
      try {
        const parsed = await resumeAPI.parseResume(file)
        const incoming = parsed.data
        if (incoming) {
          // Merge heuristic: keep template, but fill fields if non-empty
          const merged: ResumeData = {
            personalInfo: {
              fullName: incoming.personalInfo?.fullName || data.personalInfo.fullName,
              email: incoming.personalInfo?.email || data.personalInfo.email,
              phone: incoming.personalInfo?.phone || data.personalInfo.phone,
              location: incoming.personalInfo?.location || data.personalInfo.location,
              headline: incoming.personalInfo?.headline || data.personalInfo.headline,
              summary: incoming.personalInfo?.summary || data.personalInfo.summary,
              links: (incoming.personalInfo?.links?.length ? incoming.personalInfo.links : data.personalInfo.links),
            },
            skills: incoming.skills?.length ? incoming.skills : data.skills,
            projects: incoming.projects?.length ? incoming.projects : data.projects,
            experience: incoming.experience?.length ? incoming.experience : data.experience,
            education: incoming.education?.length ? incoming.education : data.education,
            certifications: (incoming as any).certifications?.length ? (incoming as any).certifications : (data.certifications || []),
            template: data.template,
            updatedAt: new Date().toISOString(),
          }
          setData(merged)
          saveResume(userId, merged)
          toast.success(`Resume imported — ${parsed.usedAI ? 'AI parsed ✓' : 'heuristic parsed'}${incoming.personalInfo?.fullName ? ` • ${incoming.personalInfo.fullName}` : ''}`)
          if (fileInputRef.current) fileInputRef.current.value = ''
          return
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error || err.message
        console.warn('backend parse failed, trying client fallback', msg)
        // fall through to client extraction + parse-text
      }

      // Client extraction + backend parse-text (or local heuristic)
      try {
        const raw = await extractTextClient(file)
        if (raw && raw.trim().length > 20) {
          try {
            const parsed2 = await resumeAPI.parseText(raw)
            const incoming2 = parsed2.data
            if (incoming2) {
              const merged2: ResumeData = {
                personalInfo: {
                  fullName: incoming2.personalInfo?.fullName || data.personalInfo.fullName,
                  email: incoming2.personalInfo?.email || data.personalInfo.email,
                  phone: incoming2.personalInfo?.phone || data.personalInfo.phone,
                  location: incoming2.personalInfo?.location || data.personalInfo.location,
                  headline: incoming2.personalInfo?.headline || data.personalInfo.headline,
                  summary: incoming2.personalInfo?.summary || data.personalInfo.summary,
                  links: incoming2.personalInfo?.links?.length ? incoming2.personalInfo.links : data.personalInfo.links,
                },
                skills: incoming2.skills?.length ? incoming2.skills : data.skills,
                projects: incoming2.projects?.length ? incoming2.projects : data.projects,
                experience: incoming2.experience?.length ? incoming2.experience : data.experience,
                education: incoming2.education?.length ? incoming2.education : data.education,
                certifications: (incoming2 as any).certifications?.length ? (incoming2 as any).certifications : (data.certifications || []),
                template: data.template,
                updatedAt: new Date().toISOString(),
              }
              setData(merged2)
              saveResume(userId, merged2)
              toast.success('Resume imported from client-extracted text ✅')
              if (fileInputRef.current) fileInputRef.current.value = ''
              return
            }
          } catch (e2: any) {
            console.warn('parseText failed', e2)
            // ultimate fallback: heuristic only, just set raw text into summary for user to edit
            toast.error('Could not auto-parse fully — extracted text added to summary for editing')
            const mergedFallback: ResumeData = {
              ...data,
              personalInfo: { ...data.personalInfo, summary: raw.slice(0, 600) },
              updatedAt: new Date().toISOString(),
            }
            setData(mergedFallback)
            return
          }
        }
      } catch (extractErr: any) {
        console.error(extractErr)
        toast.error(extractErr.message || 'Failed to read file')
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [data, userId, extractTextClient])

  // ===== AI Handlers — quick pills (Enhance Summary / Bullets / Skills / Full) + Tailor =====
  const handleAIUpgrade = useCallback(async (mode: string, extra?: { jd?: string; targetId?: string }) => {
    setAiLoading(mode)
    try {
      const payload: any = { data, mode, jobDescription: extra?.jd || '', prompt: extra?.jd || '', targetId: extra?.targetId || undefined }
      const res = await resumeAPI.aiUpgrade(payload)
      const result = res.result
      if (!result) {
        toast.error('AI did not return a result')
        return
      }
      if (mode === 'summary' && result.summary) {
        setData(prev => ({ ...prev, personalInfo: { ...prev.personalInfo, summary: result.summary }, updatedAt: new Date().toISOString() }))
        toast.success('Summary enhanced by AI ✨')
      } else if (mode === 'bullets' && result.bullets) {
        const improved = result.bullets as string[]
        const targetId = (extra as any)?.targetId
        if (targetId) {
          // Per-section targeted improve
          const isExp = data.experience.some(e=>e.id===targetId)
          if (isExp) {
            setData(prev => ({ ...prev, experience: prev.experience.map(e=> e.id===targetId ? { ...e, bullets: improved } : e), updatedAt: new Date().toISOString() }))
            toast.success('Bullets improved by AI ✨')
          } else {
            const isProj = data.projects.some(p=>p.id===targetId)
            if (isProj) {
              setData(prev => ({ ...prev, projects: prev.projects.map(p=> p.id===targetId ? { ...p, description: improved[0]?.slice(0,300) || p.description } : p), updatedAt: new Date().toISOString() }))
              toast.success('Project description improved ✨')
            } else {
              toast.success('AI bullets: ' + improved.join(' • ').slice(0,160))
            }
          }
        } else if (data.experience.length > 0) {
          setData(prev => {
            const exps = [...prev.experience]
            let idx = 0
            for (let i = 0; i < exps.length && idx < improved.length; i++) {
              const count = exps[i].bullets.length || 1
              exps[i] = { ...exps[i], bullets: improved.slice(idx, idx + count) }
              idx += count
            }
            if (idx < improved.length && exps.length > 0) {
              exps[0] = { ...exps[0], bullets: improved.slice(0, exps[0].bullets.length) }
            }
            return { ...prev, experience: exps, updatedAt: new Date().toISOString() }
          })
          toast.success('Bullets improved by AI ✨')
        } else if (data.projects.length > 0) {
          const first = improved[0] || ''
          if (first) {
            setData(prev => ({ ...prev, projects: prev.projects.map((p,i)=> i===0 ? { ...p, description: first.slice(0,200)} : p), updatedAt: new Date().toISOString() }))
            toast.success('Project description improved ✨')
          }
        } else {
          toast.success('AI suggestion: ' + improved.join(' • ').slice(0, 160))
        }
      } else if (mode === 'skills' && result.suggestedSkills) {
        const suggested = result.suggestedSkills as string[]
        const mergedSkills = Array.from(new Set([...data.skills, ...suggested])).slice(0, 16)
        setData(prev => ({ ...prev, skills: mergedSkills, updatedAt: new Date().toISOString() }))
        toast.success(`Added ${suggested.length} AI-suggested skills ✨`)
      } else if ((mode === 'full' || mode === 'upgrade') && result.data) {
        const incoming = result.data as ResumeData
        // Preserve template choice
        const merged: ResumeData = {
          personalInfo: incoming.personalInfo || data.personalInfo,
          skills: incoming.skills?.length ? incoming.skills : data.skills,
          projects: incoming.projects?.length ? incoming.projects : data.projects,
          experience: incoming.experience?.length ? incoming.experience : data.experience,
          education: incoming.education?.length ? incoming.education : data.education,
          certifications: (incoming as any).certifications?.length ? (incoming as any).certifications : (data.certifications || []),
          template: data.template,
          updatedAt: new Date().toISOString(),
        }
        setData(merged)
        toast.success('Resume fully upgraded by AI 🚀')
      } else if (mode === 'tailor' && result) {
        // result may contain personalInfo, skills, experience
        const incoming = result as any
        const tailored: ResumeData = {
          personalInfo: incoming.personalInfo ? { ...data.personalInfo, ...incoming.personalInfo } : data.personalInfo,
          skills: incoming.skills?.length ? incoming.skills : data.skills,
          experience: Array.isArray(incoming.experience) ? incoming.experience.map((e:any, i:number)=>{
            const orig = data.experience[i]
            if (!orig) return e
            return { ...orig, bullets: e.bullets || orig.bullets }
          }) : data.experience,
          projects: data.projects,
          education: data.education,
          certifications: incoming.certifications?.length ? incoming.certifications : (data.certifications || []),
          template: data.template,
          updatedAt: new Date().toISOString(),
        }
        // Handle case where AI returned rawText suggestions only
        if (incoming.rawText) {
          toast.success('AI tailored suggestions ready — apply manually')
          // show raw in toast? We'll keep data but also notify
          setData(prev => ({ ...prev, personalInfo: { ...prev.personalInfo, summary: incoming.rawText.slice(0,400) }, updatedAt: new Date().toISOString() }))
        } else {
          setData(tailored)
          toast.success('Resume tailored to JD ✨')
        }
        if (incoming.suggestions) {
          const tip = incoming.suggestions[0]
          if (tip) toast(tip, { icon: '💡' })
        }
      } else {
        // generic
        toast.success('AI enhancement applied ✨')
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e.message || 'AI upgrade failed'
      toast.error(msg)
      console.error(e)
    } finally {
      setAiLoading(null)
    }
  }, [data])

  const handleATS = useCallback(async (jd?: string) => {
    setAtsLoading(true)
    try {
      const res = await resumeAPI.atsScore({ data, jobDescription: jd || '' })
      setAtsResult(res)
      setShowAtsModal(true)
      toast.success(`ATS Score: ${res.score ?? res.blendedScore ?? 0}/100`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'ATS scoring failed')
    } finally {
      setAtsLoading(false)
    }
  }, [data])

  const handleTailorSubmit = useCallback(async () => {
    if (!jdText.trim()) {
      toast.error('Paste a job description first')
      return
    }
    setShowJDModal(false)
    if (jdMode === 'tailor') {
      await handleAIUpgrade('tailor', { jd: jdText })
    } else {
      await handleATS(jdText)
    }
  }, [jdText, jdMode, handleAIUpgrade, handleATS])

  // PDF export — selectable text, hyperlinked.

  const handleExportVector = useCallback(async () => {
    setExportingVector(true)
    try {
      // Prefer backend PDF. If backend fails, fallback to client jsPDF — ensures download always works.
      try {
        await resumeAPI.downloadVectorPdf(data)
        toast.success('Download started')
        return
      } catch (err: any) {
        const msg = String(err?.message || err?.response?.data?.error || '')
        const isAbort = err?.code === 'ERR_CANCELED'
        if (isAbort) throw err
        console.warn('[ResumeStudio] backend PDF failed, falling back to client', msg, err)
      }
      const blob = await generateVectorPdfBlob(data)
      const tpl = (data.template || DEFAULT_TEMPLATE) as string
      const suffixMap: Record<string, string> = { 'source-split': 'SourceSplit', compact: 'Compact', classic: 'Classic', modern: 'Modern', minimal: 'Minimal' }
      const suffix = suffixMap[tpl] || 'SourceSplit'
      const safeName2 = (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeName2}_Resume_${suffix}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.success('Download started')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Download failed')
    } finally {
      setExportingVector(false)
    }
  }, [data])

  const handleDownloadTex = useCallback(async () => {
    setExportingTex(true)
    try {
      try {
        await resumeAPI.downloadTex(data)
        toast.success('Download started')
        return
      } catch (err: any) {
        const msg = String(err?.message || '')
        const isAbort = err?.code === 'ERR_CANCELED'
        if (isAbort) throw err
        console.warn('[ResumeStudio] backend tex fallback -> local', msg, err)
      }
      const latex = generateResumeLatex(data)
      downloadTexFile(data, latex)
      toast.success('Download started')
    } catch (e: any) {
      console.error(e)
      try {
        downloadTexFile(data)
        toast.success('Download started')
      } catch {
        toast.error('Download failed')
      }
    } finally {
      setExportingTex(false)
    }
  }, [data])

  const canExport = Boolean(data.personalInfo.fullName || data.skills.length || data.projects.length)
  // kept for legacy but template now defaults to source-split; preview and PDF both dispatch via data.template
  const _isClassic = (data.template || DEFAULT_TEMPLATE) === 'classic'

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white">
            <FileText size={18} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-surface-900 dark:text-night-50 font-display">Resume Studio</h1>
            <p className="text-xs text-surface-500 dark:text-night-300">Build a job-ready resume → tailor to JD → export PDF → turn into portfolio</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Upload */}
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={handleUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border-2 border-dashed border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-sm font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-100 disabled:opacity-50">
            {uploading ? <Loader2 size={14} className="animate-spin"/> : <FileUp size={14}/>} {uploading ? 'Parsing...' : 'Upload Resume'}
          </button>

          <button onClick={handleManualSave} disabled={saving} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={handleCopy} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700">
            <Copy size={14} /> Copy Data
          </button>
          <button onClick={handleClear} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-danger-200 text-sm font-medium text-danger-600 hover:bg-danger-50">
            <Trash2 size={14} /> Clear
          </button>

          {/* Export group */}
          <div className="relative">
            <div className="flex rounded-xl overflow-hidden shadow-sm border border-primary-600">
              <button
                onClick={handleExportVector}
                disabled={exportingVector}
                className="inline-flex items-center gap-2 px-5 min-h-[40px] bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                title="Download PDF"
              >
                {exportingVector ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
              </button>
              <button
                ref={exportBtnRef}
                onClick={() => { updateExportRect(); setShowExportMenu(v => !v) }}
                className="px-2.5 min-h-[40px] bg-primary-700 hover:bg-primary-800 text-white border-l border-primary-500 flex items-center justify-center"
                aria-label="More export options"
                aria-expanded={showExportMenu}
              >
                <Download size={14} />
              </button>
            </div>
            {showExportMenu && typeof document !== 'undefined' && createPortal(
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setShowExportMenu(false)} aria-hidden />
                <div
                  className="fixed w-72 bg-white dark:bg-night-800 rounded-2xl shadow-2xl border border-surface-200 dark:border-night-600 overflow-hidden z-[9999]"
                  style={{
                    top: exportMenuRect ? Math.min(exportMenuRect.bottom + 8, typeof window !== 'undefined' ? window.innerHeight - 360 : 9999) : 120,
                    left: exportMenuRect ? Math.max(12, Math.min(exportMenuRect.right - 288, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 288 - 12)) : undefined,
                    right: exportMenuRect ? undefined : 16,
                  }}
                  role="menu"
                >
                <button
                  onClick={() => { setShowExportMenu(false); handleExportVector() }}
                  disabled={exportingVector}
                  className="w-full text-left px-4 py-3 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 flex items-center gap-3 disabled:opacity-50"
                >
                  <span className="w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-500/20 flex items-center justify-center text-primary-600"><Layers size={16} /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-surface-900 dark:text-night-50">Download PDF</span>
                    <span className="block text-xs text-surface-500 dark:text-night-400">A4, selectable text</span>
                  </span>
                </button>
                <button
                  onClick={() => { setShowExportMenu(false); handleDownloadTex() }}
                  disabled={exportingTex}
                  className="w-full text-left px-4 py-3 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 flex items-center gap-3 disabled:opacity-50 border-t border-surface-100 dark:border-night-700"
                >
                  <span className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-500/15 flex items-center justify-center text-amber-600"><FileCode size={16} /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-surface-900 dark:text-night-50 flex items-center gap-2">Download TeX {exportingTex && <Loader2 size={12} className="animate-spin" />}</span>
                    <span className="block text-xs text-surface-500 dark:text-night-400">TeX source for Overleaf</span>
                  </span>
                </button>
                <div className="px-4 py-2 bg-surface-50 dark:bg-night-900 text-[11px] text-surface-500 dark:text-night-300">
                  5 templates: Source Split · Compact · Classic · Modern · Minimal — each with PDF & TeX.
                </div>
                </div>
              </>,
              document.body
            )}
          </div>
        </div>
      </div>

      {/* Resume Tools Bar — AI Quick Pills (no dropdown) + ATS & Tailor — always visible pill row */}
      <div className="mb-4 bg-gradient-to-br from-violet-600 via-indigo-600 to-primary-600 rounded-2xl p-[1px] shadow-e2">
        <div className="bg-white dark:bg-night-800 rounded-[15px] p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow"><Sparkles size={16}/></span>
              <div>
                <p className="text-sm font-bold text-surface-900 dark:text-night-50 flex items-center gap-2">Resume Tools <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-500/15 border border-violet-200 dark:border-violet-500/25 text-[10px] font-bold tracking-widest uppercase text-violet-700 dark:text-violet-300">AI Quick</span></p>
                <p className="text-xs text-surface-500 dark:text-night-300">Enhance, tailor & score — instant pills, no menus</p>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <button onClick={()=>handleAIUpgrade('summary')} disabled={!!aiLoading || atsLoading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-xs font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/15 disabled:opacity-50">
              {aiLoading==='summary' ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12}/>} Enhance Summary
            </button>
            <button onClick={()=>handleAIUpgrade('bullets')} disabled={!!aiLoading || atsLoading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/15 disabled:opacity-50">
              {aiLoading==='bullets' ? <Loader2 size={12} className="animate-spin"/> : <Layers size={12}/>} Improve Bullets
            </button>
            <button onClick={()=>handleAIUpgrade('skills')} disabled={!!aiLoading || atsLoading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/20 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/15 disabled:opacity-50">
              {aiLoading==='skills' ? <Loader2 size={12} className="animate-spin"/> : <Lightbulb size={12}/>} Suggest Skills
            </button>
            <button onClick={()=>handleAIUpgrade('full')} disabled={!!aiLoading || atsLoading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold hover:from-violet-700 hover:to-indigo-700 shadow-sm disabled:opacity-50">
              {aiLoading==='full' || aiLoading==='upgrade' ? <Loader2 size={12} className="animate-spin"/> : <Sparkles size={12}/>} Full Upgrade
            </button>
            <span className="hidden sm:inline-block w-px h-6 bg-surface-200 dark:bg-night-600 mx-1" aria-hidden />
            <button onClick={()=>{ setJdMode('tailor'); setShowJDModal(true)}} disabled={!!aiLoading} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-50">
              {aiLoading==='tailor' ? <Loader2 size={12} className="animate-spin"/> : <Target size={12}/>} Tailor to JD
            </button>
            <button
              onClick={() => atsResult ? setShowAtsModal(true) : handleATS()}
              disabled={atsLoading || !!aiLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {atsLoading ? <Loader2 size={12} className="animate-spin"/> : <BarChart3 size={12}/>} ATS Score {atsResult?.score != null && <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">{atsResult.score ?? atsResult.blendedScore}</span>}
            </button>
            <button onClick={()=>{ setJdMode('ats'); setShowJDModal(true)}} className="inline-flex items-center gap-1 px-3 py-2 rounded-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-xs font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700">ATS vs JD</button>
          </div>
        </div>
      </div>

      {!canExport && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <Upload size={14}/> Upload an existing PDF/DOCX to prefill, or add your name + at least one skill/project to enable export. Tip: use “Upload Resume” if you already have one.
        </div>
      )}

      {/* Quick export bar */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/15 border border-primary-200 dark:border-primary-500/20 font-medium text-primary-700 dark:text-primary-300">
          <Layers size={12} /> Download PDF
        </span>
        <button onClick={handleDownloadTex} disabled={exportingTex} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/20 font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 disabled:opacity-50">
          <FileCode size={12} /> Download TeX
        </button>
        <span className="inline-flex items-center gap-1 text-surface-400 dark:text-night-400">
          Templates: Source Split · Compact · Classic · Modern · Minimal
        </span>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
        {/* Left: Form */}
        <div className="space-y-4">
          <ResumeForm data={data} onChange={setData} />

          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-night-50">Ready to publish a portfolio?</p>
              <p className="text-xs text-surface-500 dark:text-night-300">Use the same data — pick a theme in 30 seconds.</p>
            </div>
            <button onClick={()=>navigate('/portfolio-studio?import=1')} className="inline-flex items-center gap-2 px-5 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold">
              <Globe size={16} /> Create Portfolio →
            </button>
          </div>

          <div className="flex flex-col items-center gap-1.5 text-xs text-surface-400 dark:text-night-400 justify-center py-2">
            <span className="inline-flex items-center gap-2">
              <Share2 size={12} /> <strong>PDF</strong> = selectable text. <strong>TeX</strong> = paste into Overleaf & compile.
            </span>
            <span className="inline-flex items-center gap-2">
              <FileUp size={12} /> Upload • <BarChart3 size={12}/> ATS Score • <Target size={12}/> Tailor to JD
            </span>
          </div>
        </div>

        {/* Right: Live Preview - sticky */}
        <div className="lg:sticky lg:top-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Live Preview</p>
            <span className="inline-flex items-center gap-2 text-xs text-surface-400">A4 · {data.template} <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">PDF</span></span>
          </div>
          <div className="bg-surface-100 dark:bg-night-900 rounded-2xl p-3 sm:p-4 border border-surface-200 dark:border-night-700">
            <div id="resume-print-area" className="resume-print-area bg-white rounded-xl overflow-hidden shadow-sm" style={{ colorScheme: 'light' }}>
              <ResumePreview ref={previewRef} data={data} template={data.template} />
            </div>
          </div>
            <p className="text-xs text-center text-surface-400 dark:text-night-400">
            Live preview matches PDF. Switch template to see options — each exports PDF & TeX.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button onClick={handleExportVector} disabled={exportingVector} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold disabled:opacity-50">
              {exportingVector ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download PDF
            </button>
            <button onClick={handleDownloadTex} disabled={exportingTex} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 disabled:opacity-50">
              {exportingTex ? <Loader2 size={12} className="animate-spin" /> : <FileCode size={12} />} Download TeX
            </button>
          </div>
        </div>
      </div>

      {/* JD Modal — Tailor / ATS vs JD — portal to body to escape Layout transform/overflow stacking */}
      {showJDModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm isolate" onClick={()=>setShowJDModal(false)}>
          <div className="bg-white dark:bg-night-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-200 dark:border-night-700 flex items-center justify-between">
              <h3 className="font-bold text-surface-900 dark:text-night-50 flex items-center gap-2">
                {jdMode==='tailor' ? <><Target size={18} className="text-amber-600"/> Tailor to Job Description</> : <><BarChart3 size={18} className="text-emerald-600"/> ATS Score vs JD</>}
              </h3>
              <button onClick={()=>setShowJDModal(false)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-night-700"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-3 overflow-auto">
              <p className="text-xs text-surface-500 dark:text-night-300">
                {jdMode==='tailor' ? 'Paste the JD — AI will rewrite summary, reorder skills, and rephrase bullets to mirror keywords without hallucinating.' : 'Paste JD to get ATS match score + missing keywords.'}
              </p>
              <textarea value={jdText} onChange={e=>setJdText(e.target.value)} placeholder="Paste job description here... (e.g., We are hiring Frontend Developer — React, TypeScript, Tailwind, REST APIs... )" rows={10}
                className="w-full px-3 py-3 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
              />
              <div className="flex items-center gap-2 text-xs text-surface-400 dark:text-night-400">
                <Lightbulb size={12}/> Tip: include Required Skills + Responsibilities for best tailoring. ATS works even without JD (generic score).
              </div>
            </div>
            <div className="px-5 py-4 border-t border-surface-200 dark:border-night-700 flex justify-end gap-2">
              <button onClick={()=>setShowJDModal(false)} className="px-4 py-2 rounded-xl border border-surface-200 dark:border-night-600 text-sm font-medium">Cancel</button>
              <button onClick={handleTailorSubmit} disabled={!!aiLoading || atsLoading} className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50">
                {(aiLoading || atsLoading) ? <Loader2 size={14} className="animate-spin"/> : jdMode==='tailor' ? <Target size={14}/> : <BarChart3 size={14}/>} {jdMode==='tailor' ? 'Tailor Resume' : 'Score ATS'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ATS Score Modal — portal to body */}
      {showAtsModal && atsResult && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm isolate" onClick={()=>setShowAtsModal(false)}>
          <div className="bg-white dark:bg-night-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-surface-200 dark:border-night-700 flex items-center justify-between">
              <h3 className="font-bold text-surface-900 dark:text-night-50 flex items-center gap-2"><BarChart3 size={18} className="text-emerald-600"/> ATS Score</h3>
              <button onClick={()=>setShowAtsModal(false)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-night-700"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-4 overflow-auto">
              <div className="flex items-center gap-4">
                <div className={`w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center shrink-0 ${(atsResult.score ?? atsResult.blendedScore ?? 0) >= 85 ? 'border-emerald-500 dark:border-emerald-400' : (atsResult.score ?? 0) >= 70 ? 'border-amber-500 dark:border-amber-400' : 'border-red-500 dark:border-red-400'}`}>
                  <span className="text-2xl font-extrabold text-surface-900 dark:text-night-50">{atsResult.blendedScore ?? atsResult.score ?? 0}</span>
                  <span className="text-[11px] font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">/ 100</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-surface-900 dark:text-night-50">{atsResult.level}</p>
                  <p className="text-xs text-surface-500 dark:text-night-300 mt-1">{atsResult.usedAI ? 'Scored with AI + heuristic (blended)' : 'Scored with heuristic — configure Groq for AI-augmented feedback'}</p>
                  {atsResult.aiScore != null && <p className="text-xs text-surface-500 dark:text-night-400">Heuristic {atsResult.score} · AI {atsResult.aiScore} · Blended {atsResult.blendedScore}</p>}
                </div>
              </div>

              {atsResult.breakdown && (
                <div className="space-y-2">
                  <p className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400">Breakdown</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(atsResult.breakdown as Record<string, number>).map(([k,v])=>(
                      <div key={k} className="bg-surface-50 dark:bg-night-700 rounded-xl px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-surface-700 dark:text-night-200">{k}</span>
                        <span className="text-xs font-bold text-surface-900 dark:text-night-50">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!(atsResult.suggestions || atsResult.aiFeedback)?.length && (
                <div>
                  <p className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400 mb-2">Suggestions</p>
                  <ul className="space-y-1.5">
                    {(atsResult.suggestions || atsResult.aiFeedback || []).slice(0,8).map((s:string,i:number)=>(
                      <li key={i} className="flex gap-2 text-xs text-surface-700 dark:text-night-200 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                        <span className="text-amber-600 mt-0.5"><Lightbulb size={12}/></span><span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!!atsResult.aiMissingKeywords?.length && (
                <div>
                  <p className="text-xs font-bold tracking-widest uppercase text-surface-400 dark:text-night-400 mb-2">Missing keywords (AI)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {atsResult.aiMissingKeywords.map((k:string)=>(
                      <span key={k} className="px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs font-medium text-red-700 dark:text-red-300">{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {!!atsResult.jdKeywords?.length && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-surface-600 dark:text-night-300">JD keywords detected ({atsResult.jdKeywords.length})</summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {atsResult.jdKeywords.slice(0,20).map((k:string)=>(
                      <span key={k} className="px-2 py-1 rounded-full bg-surface-100 dark:bg-night-700 text-xs text-surface-600 dark:text-night-300">{k}</span>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={()=>{ setShowAtsModal(false); setJdMode('tailor'); setShowJDModal(true)}} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold">Tailor to JD → Improve score</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
