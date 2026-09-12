import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Globe, Upload, CheckCircle, Copy, ExternalLink, Sparkles, FileText, Loader2, Link as LinkIcon, Layout, Eye, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import type { ResumeData, PortfolioData } from '../types/resume'
import { loadResume, loadPortfolio, savePortfolio } from '../lib/resumeStorage'
import { buildPortyImportUrl, buildPortyPublicUrl, PORTY_BASE, normalizePortfolioUrl, isValidPortfolioUrl, isPortyUrl } from '../lib/porty'
import { userAPI } from '../lib/api'
import ThemeGrid from '../components/portfolio/ThemeGrid'
import PortyFrame from '../components/portfolio/PortyFrame'
import { PremiumHero } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'

export default function PortfolioStudioPage() {
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
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
  const [savingExternal, setSavingExternal] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [showExternalPreview, setShowExternalPreview] = useState(false)
  const iframeAnchorRef = useRef<HTMLDivElement>(null)

  // Derive backend portfolioUrl if already saved on user profile
  const backendPortfolioUrl = (user as any)?.portfolioUrl as string | null | undefined

  useEffect(() => {
    const r = loadResume(userId)
    setResumeData(r)
    const p = loadPortfolio(userId)
    let nextP: PortfolioData | null = p
    if (p) {
      // Repair legacy Porty entries: older code stored publicUrl as https://porty-eight.vercel.app/<slug> or truncated https://porty-eight.vercel.app/p
      if (p.slug && p.slug !== 'p') {
        const expected = buildPortyPublicUrl(p.slug)
        if (p.publicUrl !== expected && isPortyUrl(p.publicUrl || '')) {
          nextP = { ...p, publicUrl: expected }
          try { savePortfolio(userId, nextP) } catch {}
        }
      }
      setPublished(nextP)
      if (nextP?.themeId) setSelectedTheme(nextP.themeId)
    }
    // If no local published but backend has portfolioUrl (any website), bootstrap published from it
    if (!p && backendPortfolioUrl) {
      const normalized = normalizePortfolioUrl(backendPortfolioUrl)
      if (normalized) {
        const synthetic: PortfolioData = {
          id: `portfolio-ext-${Date.now()}`,
          userId,
          resumeId: null,
          themeId: 'external',
          slug: null,
          publicUrl: normalized,
          importedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          data: r as any,
        }
        setPublished(synthetic)
        // also hydrate input
        setManualSlug(normalized)
      }
    }
    if (r && autoImport && !isImported) {
      setIsImported(true)
      toast.success('Imported from Resume')
    }
    // Steps 1 & 2 hidden for now — auto-enable import & default theme (skip 01,02)
    const hasData = Boolean(r && (r.personalInfo.fullName || r.skills.length || r.projects.length))
    if (hasData) {
      setIsImported(true)
      if (!p?.themeId) {
        setSelectedTheme(prev => prev || 'theme-03')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, autoImport, backendPortfolioUrl])

  // Also hydrate after backendPortfolioUrl arrives later (login fetch)
  useEffect(() => {
    if (backendPortfolioUrl && !published?.publicUrl) {
      const normalized = normalizePortfolioUrl(backendPortfolioUrl)
      if (normalized) {
        const synthetic: PortfolioData = {
          id: `portfolio-ext-${Date.now()}`,
          userId,
          resumeId: null,
          themeId: 'external',
          slug: null,
          publicUrl: normalized,
          importedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          data: resumeData as any,
        }
        setPublished(synthetic)
        setManualSlug(normalized)
      }
    }
  }, [backendPortfolioUrl, published?.publicUrl, userId, resumeData])

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
    // Steps 1 & 2 hidden — auto-resolve import/theme so preview works without manual steps
    const themeToUse = selectedTheme || published?.themeId || 'theme-03'
    if (!isImported) setIsImported(true)
    if (!selectedTheme) setSelectedTheme(themeToUse)
    const url = buildPortyImportUrl(resumeData, themeToUse)
    if (url.length > 7000) {
      toast('Data is large — preview may be slow', { icon: '⚠️' })
    }
    setImportUrl(url)
    setTimeout(() => iframeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
  }

  const syncToBackend = async (publicUrl: string) => {
    try {
      const res = await userAPI.updateProfile({ portfolioUrl: publicUrl })
      // update auth store so PublicProfile and header reflect immediately
      if (res?.portfolioUrl) {
        updateUser({ portfolioUrl: res.portfolioUrl } as any)
      } else {
        updateUser({ portfolioUrl: publicUrl } as any)
      }
    } catch (e: any) {
      // don't block local save if backend fails — show warning
      const msg = e?.response?.data?.error || 'Could not sync to profile — saved locally'
      toast(msg, { icon: '⚠️' })
    }
  }

  const handlePublished = useCallback(async (rawSlug: string) => {
    if (!resumeData) return
    // Normalize slug: strip leading "/","p/", query, hash — Porty may send "p/xyz" or "xyz"
    const slug = rawSlug.replace(/^\/+/, '').replace(/^p\/+/, '').split('?')[0].split('#')[0].trim()
    if (!slug || slug === 'p') {
      toast.error('Invalid portfolio slug received from Porty')
      return
    }
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
    // also showcase on public profile — sync to backend portfolioUrl
    await syncToBackend(publicUrl)
  }, [resumeData, userId, selectedTheme, published])

  const handleManualSave = async () => {
    const raw = manualSlug.trim()
    if (!raw) {
      setUrlError('Paste a URL — e.g., https://your-portfolio.com')
      toast.error('Paste a URL or slug')
      return
    }
    // Reset error
    setUrlError(null)

    // If it looks like a Porty URL, handle as Porty slug extraction (back-compat)
    if (isPortyUrl(raw)) {
      let slug = raw
      try {
        if (raw.startsWith('http')) {
          const u = new URL(raw.startsWith('http') ? raw : 'https://' + raw)
          const parts = u.pathname.split('/').filter(Boolean) // e.g. "/p/<slug>" -> ["p","<slug>"]
          if (parts.length === 0) slug = ''
          else if (parts[0] === 'p' && parts[1]) slug = parts[1]
          else slug = parts[parts.length - 1]
          slug = slug.split('?')[0].split('#')[0]
        } else {
          const clean = raw.replace(/^\/+/, '')
          const parts = clean.split('/').filter(Boolean) // handles "p/slug" or "slug" or "/p/slug"
          if (parts.length === 0) slug = ''
          else if (parts[0] === 'p' && parts[1]) slug = parts[1]
          else slug = parts[parts.length - 1] || parts[0]
          slug = slug.split('?')[0].split('#')[0]
        }
      } catch {}
      // Also strip any stray "p/" prefix left
      slug = slug.replace(/^p\/+/, '').trim()
      if (!slug || slug === 'p') {
        setUrlError('Invalid Porty URL — paste your full portfolio URL (https://porty-eight.vercel.app/p/your-slug)')
        toast.error('Invalid URL — paste your full portfolio URL or slug')
        return
      }
      await handlePublished(slug)
      setManualSlug(buildPortyPublicUrl(slug))
      return
    }

    // Otherwise — treat as ANY portfolio website (generic). Validate https URL.
    const normalized = normalizePortfolioUrl(raw)
    if (!normalized) {
      setUrlError('Enter a valid URL, e.g., https://your-portfolio.com or https://rohit.dev')
      toast.error('Invalid URL — must be https://your-portfolio.com')
      return
    }
    // Additional guard: allow any domain, not just Porty
    // Ensure it looks like a website (has dot)
    try {
      const u = new URL(normalized)
      if (!u.hostname.includes('.') && u.hostname !== 'localhost') {
        setUrlError('Enter a valid website URL with a domain (e.g., https://myportfolio.com)')
        toast.error('Invalid domain — e.g., https://myportfolio.com')
        return
      }
    } catch {
      setUrlError('Enter a valid URL starting with https://')
      toast.error('Invalid URL')
      return
    }

    setSavingExternal(true)
    try {
      // Save locally as portfolioData with external URL so PublicProfile can showcase
      const data: PortfolioData = {
        id: published?.id || `portfolio-${Date.now()}`,
        userId,
        resumeId: null,
        themeId: published?.themeId || selectedTheme || 'external',
        slug: null,
        publicUrl: normalized,
        importedAt: published?.importedAt || new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        data: resumeData as any,
      }
      savePortfolio(userId, data)
      setPublished(data)
      // Sync to backend user profile → will appear on /u/:username
      await syncToBackend(normalized)
      toast.success('Portfolio link saved — showcased on your profile!')
      setShowExternalPreview(true)
      // keep input showing saved URL
      setManualSlug(normalized)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save')
    } finally {
      setSavingExternal(false)
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  const handlePreviewExternal = () => {
    if (!published?.publicUrl) {
      toast.error('No portfolio URL saved yet')
      return
    }
    const normalized = normalizePortfolioUrl(published.publicUrl)
    if (!normalized) {
      toast.error('Invalid portfolio URL')
      return
    }
    setShowExternalPreview(true)
    setTimeout(() => iframeAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
  }

  const hasResume = Boolean(resumeData && (resumeData.personalInfo.fullName || resumeData.skills.length || resumeData.projects.length))
  const isExternalPublished = Boolean(published?.publicUrl && !isPortyUrl(published.publicUrl))

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

        {/* Even without resume, allow saving any portfolio link — optional quick capture */}
        <div className="mt-6 bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5 space-y-3">
          <p className="text-sm font-bold text-surface-900 dark:text-night-50 flex items-center gap-2"><LinkIcon size={14}/> Have a portfolio already? Link it here</p>
          <p className="text-xs text-surface-500 dark:text-night-300">Paste any website — <span className="font-mono">https://your-portfolio.com</span>, <span className="font-mono">https://rohit.dev</span>, <span className="font-mono">https://rohit.portfolio.io</span> — and we'll showcase it on your public profile.</p>
          <div className="flex gap-2">
            <input value={manualSlug} onChange={e=>{ setManualSlug(e.target.value); if(urlError) setUrlError(null)}} placeholder="https://your-portfolio.com"
              className="flex-1 px-3 py-2.5 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-sm placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400" />
            <button onClick={handleManualSave} disabled={savingExternal} className="px-5 py-2.5 bg-surface-900 dark:bg-night-700 text-white rounded-xl text-sm font-medium hover:bg-surface-800 disabled:opacity-50 inline-flex items-center gap-2">
              {savingExternal ? <Loader2 size={14} className="animate-spin"/> : null} Save
            </button>
          </div>
          {urlError && <p className="text-xs text-red-600 dark:text-red-400">{urlError}</p>}
          {published?.publicUrl && (
            <a href={published.publicUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600 hover:underline inline-flex items-center gap-1 break-all"><ExternalLink size={12}/> {published.publicUrl}</a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<Layout size={18} />}
        eyebrow="Career · Portfolio"
        title={<>Portfolio Studio</>}
        subtitle="Build your site — 30 themes, live Porty iframe and publish. Or link any portfolio website to showcase on your profile."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white"><Globe size={18}/></div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-surface-900 dark:text-night-50 font-display">Portfolio Studio</h1>
            <p className="text-xs text-surface-500 dark:text-night-300">Preview → publish <span className="text-surface-400 dark:text-zinc-500">(or link any site)</span></p>
          </div>
        </div>
        <button onClick={()=>navigate('/resume-studio')} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200">
          <FileText size={14}/> Edit Resume
        </button>
      </div>

      {/* Published success card — shows full URL with copy button, supports Porty + any custom domain */}
      {published?.publicUrl && (() => {
        const isTruncated = !isExternalPublished && (published.slug === 'p' || published.publicUrl === `${PORTY_BASE}/p` || published.publicUrl === `${PORTY_BASE}/p/` || (published.publicUrl!.endsWith('/p') && !published.publicUrl!.includes('/p/') ))
        const displayLabel = isExternalPublished ? 'Your portfolio is linked!' : 'Your portfolio is live!'
        const subLabel = isExternalPublished ? 'Showcased on your public profile' : `Published ${published.publishedAt ? new Date(published.publishedAt).toLocaleString() : ''}`
        return (
          <div className={`rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border ${isExternalPublished ? 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20' : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'}`}>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 ${isExternalPublished ? 'bg-sky-600' : 'bg-emerald-600'}`}>{isExternalPublished ? <Globe size={18}/> : <CheckCircle size={18}/>}</div>
              <div className="min-w-0">
                <p className={`text-sm font-bold ${isExternalPublished ? 'text-sky-800 dark:text-sky-300' : 'text-emerald-800 dark:text-emerald-300'}`}>{displayLabel}</p>
                <a href={published.publicUrl!} target="_blank" rel="noopener noreferrer" title={published.publicUrl!} className={`text-sm hover:underline break-all inline-flex items-center gap-1 max-w-full ${isExternalPublished ? 'text-sky-700 dark:text-sky-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  <span className="break-all">{published.publicUrl}</span> <ExternalLink size={12} className="shrink-0"/>
                </a>
                <p className={`text-xs ${isExternalPublished ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{subLabel}</p>
                {isExternalPublished && (
                  <p className="mt-1.5 text-xs text-sky-700 dark:text-sky-300 inline-flex items-center gap-1"><ShieldCheck size={12}/> Visible at <span className="font-mono font-semibold">/u/{user?.username || 'your-handle'}</span> — showcase to recruiters</p>
                )}
                {isTruncated && (
                  <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-2.5 py-1.5">
                    ⚠️ This link looks truncated (ends with /p without slug). Paste your full URL below to fix.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={()=>handleCopy(published.publicUrl!)} className={`px-4 py-2 rounded-xl text-white text-sm font-medium inline-flex items-center gap-2 ${isExternalPublished ? 'bg-sky-600 hover:bg-sky-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                <Copy size={14}/> Copy
              </button>
              <a href={published.publicUrl!} target="_blank" rel="noopener noreferrer" className={`px-4 py-2 rounded-xl bg-white dark:bg-night-800 border text-sm font-medium inline-flex items-center gap-2 ${isExternalPublished ? 'border-sky-200 dark:border-sky-500/20 text-sky-700 dark:text-sky-300' : 'border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300'}`}>
                <ExternalLink size={14}/> Open
              </a>
              {isExternalPublished && (
                <button onClick={handlePreviewExternal} className="px-4 py-2 rounded-xl bg-surface-900 dark:bg-night-700 text-white text-sm font-medium inline-flex items-center gap-2 hover:bg-surface-800">
                  <Eye size={14}/> Preview
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Show backend portfolioUrl mismatch hint */}
      {backendPortfolioUrl && published?.publicUrl && backendPortfolioUrl !== published.publicUrl && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Your profile showcases <span className="font-mono font-semibold">{backendPortfolioUrl}</span> — but local preview shows {published.publicUrl}. Save again to sync.
        </div>
      )}

      {/* Steps 1 & 2 temporarily hidden — placeholder for mention (Import from Resume + Pick Theme removed per request) */}
      <div className="hidden" aria-hidden="true">
        <button onClick={handleImport} className="hidden" />
        <ThemeGrid selectedId={selectedTheme} onSelect={setSelectedTheme} />
      </div>

      {/* Preview & Publish — steps 1 & 2 hidden, mention placeholder above */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-surface-900 dark:text-night-50">Preview & Publish</h2>
          <span className="text-xs text-surface-400 dark:text-night-400">— Porty import + any custom site</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={handlePreview} className="px-6 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center gap-2">
            <Sparkles size={16}/> Preview Portfolio
          </button>
          <span className="text-xs text-surface-400 dark:text-night-400 self-center">— opens inside CampusFlow. Then click Publish inside the preview.</span>
        </div>

        <div ref={iframeAnchorRef} />
        {importUrl && <PortyFrame importUrl={importUrl} onPublished={handlePublished} />}

        {/* Manual fallback — NOW supports ANY portfolio website */}
        <div className="border-t border-surface-100 dark:border-night-700 pt-4 space-y-3">
          <p className="text-xs font-semibold text-surface-700 dark:text-night-200 flex items-center gap-1.5"><LinkIcon size={12}/> Already published but we didn't catch it? Or have your own site? Paste your portfolio URL here</p>
          <div className="flex gap-2">
            <input
              value={manualSlug}
              onChange={e=>{ setManualSlug(e.target.value); if(urlError) setUrlError(null)}}
              onKeyDown={e=> { if(e.key==='Enter') handleManualSave() }}
              placeholder="https://your-portfolio.com"
              className={`flex-1 px-3 py-2.5 rounded-xl border bg-white dark:bg-night-850 text-sm placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${urlError ? 'border-red-300 dark:border-red-500/40 focus:border-red-400' : 'border-surface-200 dark:border-night-600 focus:border-primary-400'}`}
            />
            <button onClick={handleManualSave} disabled={savingExternal} className="px-5 py-2.5 bg-surface-900 dark:bg-night-700 text-white rounded-xl text-sm font-medium hover:bg-surface-800 disabled:opacity-50 inline-flex items-center gap-2 shrink-0">
              {savingExternal ? <Loader2 size={14} className="animate-spin"/> : null} Save
            </button>
            {isExternalPublished && published?.publicUrl && (
              <button onClick={handlePreviewExternal} className="px-4 py-2.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-medium inline-flex items-center gap-1.5 hover:bg-surface-50">
                <Eye size={14}/> Preview
              </button>
            )}
          </div>
          {urlError && <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-2.5 py-1.5">{urlError}</p>}
          <p className="text-[11px] text-surface-400 dark:text-night-400 flex items-center gap-1"><ShieldCheck size={10}/> Hit <span className="font-semibold">Preview</span> to see your portfolio embedded below, or <span className="font-semibold">Save</span> to showcase it publicly. Your link stays on your profile for recruiters.</p>
        </div>

        {/* External portfolio preview (any website) — iframe + fallback link */}
        {showExternalPreview && isExternalPublished && published?.publicUrl && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-surface-700 dark:text-night-200 inline-flex items-center gap-1.5"><Eye size={12}/> Live preview — {published.publicUrl}</p>
              <button onClick={()=>setShowExternalPreview(false)} className="text-xs text-surface-400 hover:text-surface-600">Hide</button>
            </div>
            <div className="relative rounded-2xl overflow-hidden border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 shadow-sm" style={{ height: 520 }}>
              <iframe
                src={published.publicUrl}
                title="Portfolio preview"
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                loading="lazy"
              />
              <a href={published.publicUrl} target="_blank" rel="noopener noreferrer" className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-surface-900 text-white text-xs font-medium inline-flex items-center gap-1 shadow-lg hover:bg-black">
                <ExternalLink size={12}/> Open full
              </a>
            </div>
            <p className="text-[11px] text-surface-400 dark:text-night-400 text-center">If the preview stays blank, the site blocks embedding — use “Open full” to view.</p>
          </motion.div>
        )}

        {isImported && selectedTheme && !importUrl && !isExternalPublished && (
          <p className="text-xs text-surface-500 dark:text-night-300 text-center">Hit Preview to see your portfolio with {selectedTheme}.</p>
        )}
      </div>

      {/* Previous portfolio footer */}
      {published && (
        <div className="text-center text-xs text-surface-400 dark:text-night-400">
          Last publish: {published.publishedAt ? new Date(published.publishedAt).toLocaleString() : '—'} · <button onClick={()=>handleCopy(published.publicUrl||'')} className="underline hover:text-primary-600">Copy link</button>
          {published.publicUrl && <> · <a href={published.publicUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary-600 inline-flex items-center gap-1">Open <ExternalLink size={10}/></a></>}
          {backendPortfolioUrl && <><span className="mx-1">·</span> Showcased on <a href={`/u/${user?.username || ''}`} className="underline hover:text-primary-600">/u/{user?.username || 'profile'}</a></>}
        </div>
      )}

      <div className="flex justify-center">
        <button onClick={()=>navigate('/resume-studio')} className="text-xs text-surface-500 dark:text-night-400 hover:text-primary-600 inline-flex items-center gap-1"><FileText size={12}/> Back to Resume Studio</button>
      </div>
    </div>
  )
}
