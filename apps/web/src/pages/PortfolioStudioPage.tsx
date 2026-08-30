import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Globe, Upload, CheckCircle, Copy, ExternalLink, Sparkles, FileText, Loader2, Link as LinkIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import type { ResumeData, PortfolioData } from '../types/resume'
import { loadResume, loadPortfolio, savePortfolio } from '../lib/resumeStorage'
import { buildPortyImportUrl, buildPortyPublicUrl } from '../lib/porty'
import ThemeGrid from '../components/portfolio/ThemeGrid'
import PortyFrame from '../components/portfolio/PortyFrame'

export default function PortfolioStudioPage() {
  const user = useAuthStore(s => s.user)
  const userId = user?.id || 'default'
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const autoImport = searchParams.get('import') === '1'

  const [resumeData, setResumeData] = useState<ResumeData | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const [importUrl, setImportUrl] = useState<string | null>(null)
  const [published, setPublished] = useState<PortfolioData | null>(null)
  const [isImported, setIsImported] = useState(false)
  const [manualSlug, setManualSlug] = useState('')
  const iframeAnchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const r = loadResume(userId)
    setResumeData(r)
    const p = loadPortfolio(userId)
    if (p) {
      setPublished(p)
      if (p.themeId) setSelectedTheme(p.themeId)
    }
    if (r && autoImport && !isImported) {
      setIsImported(true)
      toast.success('Imported from Resume')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, autoImport])

  const handleImport = () => {
    if (!resumeData) {
      toast.error('No resume found')
      return
    }
    setIsImported(true)
    toast.success('Imported resume data')
    if (!selectedTheme) {
      toast('Pick a theme and hit Preview', { icon: '🎨' })
    }
  }

  const handlePreview = () => {
    if (!resumeData) {
      toast.error('Create a resume first')
      return
    }
    if (!isImported) {
      toast.error('Click Import from Resume first')
      return
    }
    if (!selectedTheme) {
      toast.error('Pick a theme first')
      return
    }
    const url = buildPortyImportUrl(resumeData, selectedTheme)
    if (url.length > 7000) {
      toast('Data is large — preview may be slow', { icon: '⚠️' })
    }
    setImportUrl(url)
    setTimeout(() => iframeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
  }

  const handlePublished = useCallback((slug: string) => {
    if (!resumeData) return
    const publicUrl = buildPortyPublicUrl(slug)
    const data: PortfolioData = {
      id: published?.id || `portfolio-${Date.now()}`,
      userId,
      resumeId: null,
      themeId: selectedTheme || published?.themeId || 'theme-01',
      slug,
      publicUrl,
      importedAt: published?.importedAt || new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      data: resumeData,
    }
    savePortfolio(userId, data)
    setPublished(data)
    toast.success('Portfolio published!')
  }, [resumeData, userId, selectedTheme, published])

  const handleManualSave = () => {
    const raw = manualSlug.trim()
    if (!raw) {
      toast.error('Paste a URL or slug')
      return
    }
    let slug = raw
    try {
      if (raw.startsWith('http')) {
        const u = new URL(raw)
        slug = u.pathname.replace(/^\/+/, '').split('/')[0]
      } else {
        slug = raw.replace(/^\/+/, '').split('/')[0]
      }
    } catch {}
    if (!slug) {
      toast.error('Invalid URL')
      return
    }
    handlePublished(slug)
    setManualSlug('')
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  const hasResume = Boolean(resumeData && (resumeData.personalInfo.fullName || resumeData.skills.length || resumeData.projects.length))

  if (!hasResume) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white"><Globe size={18}/></div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-surface-900 dark:text-night-50 font-display">Portfolio Studio</h1>
            <p className="text-xs text-surface-500 dark:text-night-300">Build your portfolio from your resume in 30 seconds</p>
          </div>
        </div>

        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <FileText className="text-amber-600 dark:text-amber-400" size={28} />
          </div>
          <h2 className="text-lg font-bold text-surface-900 dark:text-night-50">Create your resume first</h2>
          <p className="text-sm text-surface-500 dark:text-night-300 mt-1 max-w-md mx-auto">Portfolio Studio uses your Resume Studio data so you don’t type twice. Build a resume, then come back to pick a theme and publish.</p>
          <button onClick={()=>navigate('/resume-studio')} className="mt-5 px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold inline-flex items-center gap-2">
            <FileText size={16}/> Go to Resume Studio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white"><Globe size={18}/></div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-surface-900 dark:text-night-50 font-display">Portfolio Studio</h1>
            <p className="text-xs text-surface-500 dark:text-night-300">Import resume → pick theme → preview → publish</p>
          </div>
        </div>
        <button onClick={()=>navigate('/resume-studio')} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200">
          <FileText size={14}/> Edit Resume
        </button>
      </div>

      {/* Published success card */}
      {published?.publicUrl && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shrink-0"><CheckCircle size={18}/></div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Your portfolio is live!</p>
              <a href={published.publicUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-700 dark:text-emerald-400 hover:underline break-all inline-flex items-center gap-1">
                {published.publicUrl} <ExternalLink size={12}/>
              </a>
              {published.publishedAt && <p className="text-xs text-emerald-600 dark:text-emerald-400">Published {new Date(published.publishedAt).toLocaleString()}</p>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={()=>handleCopy(published.publicUrl!)} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium inline-flex items-center gap-2">
              <Copy size={14}/> Copy
            </button>
            <a href={published.publicUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-xl bg-white dark:bg-night-800 border border-emerald-200 dark:border-emerald-500/20 text-sm font-medium text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-2">
              <ExternalLink size={14}/> Open
            </a>
          </div>
        </div>
      )}

      {/* Step 1: Source */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">1</span>
          <h2 className="text-sm font-bold text-surface-900 dark:text-night-50">Source</h2>
          <span className="text-xs text-surface-400">— your resume</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-50 dark:bg-night-850 rounded-xl p-4 border border-surface-100 dark:border-night-700">
          <div>
            <p className="text-sm font-semibold text-surface-900 dark:text-night-50">{resumeData?.personalInfo.fullName || 'Untitled Resume'} — {resumeData?.projects.length || 0} projects, {resumeData?.skills.length || 0} skills</p>
            <p className="text-xs text-surface-500 dark:text-night-300">Updated {resumeData?.updatedAt ? new Date(resumeData.updatedAt).toLocaleString() : 'just now'} · Theme: {published?.themeId || selectedTheme || 'not picked'}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleImport} className={`px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 ${isImported ? 'bg-emerald-600 text-white' : 'bg-primary-600 hover:bg-primary-700 text-white'}`}>
              {isImported ? <CheckCircle size={16}/> : <Upload size={16}/>} {isImported ? 'Imported ✓' : 'Import from Resume'}
            </button>
          </div>
        </div>
        {!isImported && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Click Import to use your resume data for the portfolio.</p>}
      </div>

      {/* Step 2: Theme picker */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">2</span>
          <h2 className="text-sm font-bold text-surface-900 dark:text-night-50">Pick a theme</h2>
          <span className="text-xs text-surface-400">— 30 to choose from</span>
          {selectedTheme && <span className="ml-auto text-xs font-medium text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/10 px-2 py-1 rounded-full">{selectedTheme} selected</span>}
        </div>
        <ThemeGrid selectedId={selectedTheme} onSelect={setSelectedTheme} />
      </div>

      {/* Step 3: Preview & Publish */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">3</span>
          <h2 className="text-sm font-bold text-surface-900 dark:text-night-50">Preview & Publish</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={handlePreview} disabled={!isImported || !selectedTheme} className="px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center gap-2">
            <Sparkles size={16}/> Preview Portfolio
          </button>
          <span className="text-xs text-surface-400 self-center">— opens inside CampusFlow. Then click Publish inside the preview.</span>
        </div>

        <div ref={iframeAnchorRef} />
        {importUrl && <PortyFrame importUrl={importUrl} onPublished={handlePublished} />}

        {/* Manual fallback */}
        <div className="border-t border-surface-100 dark:border-night-700 pt-4">
          <p className="text-xs font-medium text-surface-600 dark:text-night-300 mb-2 flex items-center gap-1"><LinkIcon size={12}/> Already published but we didn’t catch it? Paste your URL here</p>
          <div className="flex gap-2">
            <input value={manualSlug} onChange={e=>setManualSlug(e.target.value)} placeholder="https://porty-eight.vercel.app/your-slug or just your-slug"
              className="flex-1 px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm placeholder-surface-400" />
            <button onClick={handleManualSave} className="px-5 py-2.5 bg-surface-900 dark:bg-night-700 text-white rounded-xl text-sm font-medium hover:bg-surface-800">
              Save
            </button>
          </div>
        </div>

        {isImported && selectedTheme && !importUrl && (
          <p className="text-xs text-surface-500 dark:text-night-300 text-center">Hit Preview to see your portfolio with {selectedTheme}.</p>
        )}
      </div>

      {/* Previous portfolio footer */}
      {published && (
        <div className="text-center text-xs text-surface-400">
          Last publish: {published.publishedAt ? new Date(published.publishedAt).toLocaleString() : '—'} · <button onClick={()=>handleCopy(published.publicUrl||'')} className="underline hover:text-primary-600">Copy link</button>
        </div>
      )}

      <div className="flex justify-center">
        <button onClick={()=>navigate('/resume-studio')} className="text-xs text-surface-500 hover:text-primary-600 inline-flex items-center gap-1"><FileText size={12}/> Back to Resume Studio</button>
      </div>
    </div>
  )
}
