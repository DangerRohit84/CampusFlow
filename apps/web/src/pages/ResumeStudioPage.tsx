import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Save, Trash2, Copy, Printer, Globe, FileText, Loader2, Share2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import type { ResumeData } from '../types/resume'
import { loadResume, saveResume, clearResume, emptyResumeData } from '../lib/resumeStorage'
import ResumePreview from '../components/resume/ResumePreview'
import ResumeForm from '../components/resume/ResumeForm'

export default function ResumeStudioPage() {
  const user = useAuthStore(s => s.user)
  const userId = user?.id || 'default'
  const navigate = useNavigate()
  const [data, setData] = useState<ResumeData>(() => emptyResumeData(user ? { name: user.name, email: user.email } : undefined))
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  // Load on mount
  useEffect(() => {
    const stored = loadResume(userId)
    if (stored) {
      if (!stored.template) stored.template = 'classic'
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

  const handlePrint = () => {
    window.print()
  }

  const handleExport = useCallback(async () => {
    if (!previewRef.current) {
      toast.error('Preview not ready')
      return
    }
    setExporting(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { default: jsPDF } = await import('jspdf')
      const el = previewRef.current
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
      })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pdfW = pdf.internal.pageSize.getWidth()
      const pdfH = (canvas.height * pdfW) / canvas.width
      const pageH = pdf.internal.pageSize.getHeight()

      if (pdfH <= pageH) {
        pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH)
      } else {
        // Multi-page: slice by adding same image with offset
        let heightLeft = pdfH
        let position = 0
        pdf.addImage(imgData, 'PNG', 0, position, pdfW, pdfH)
        heightLeft -= pageH
        while (heightLeft > 0) {
          position = heightLeft - pdfH
          pdf.addPage()
          pdf.addImage(imgData, 'PNG', 0, position, pdfW, pdfH)
          heightLeft -= pageH
        }
      }
      const safeName = (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_')
      pdf.save(`${safeName}_Resume.pdf`)
      toast.success('PDF downloaded')
    } catch (e) {
      console.error(e)
      toast.error('PDF export failed')
    } finally {
      setExporting(false)
    }
  }, [data.personalInfo.fullName])

  const canExport = Boolean(data.personalInfo.fullName || data.skills.length || data.projects.length)

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white">
            <FileText size={18} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-surface-900 dark:text-night-50 font-display">Resume Studio</h1>
            <p className="text-xs text-surface-500 dark:text-night-300">Build a job-ready resume → export PDF → turn into portfolio</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleManualSave} disabled={saving} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <button onClick={handleCopy} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50">
            <Copy size={14} /> Copy Data
          </button>
          <button onClick={handlePrint} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 text-sm font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50">
            <Printer size={14} /> Print
          </button>
          <button onClick={handleClear} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl border border-danger-200 text-sm font-medium text-danger-600 hover:bg-danger-50">
            <Trash2 size={14} /> Clear
          </button>
          <button onClick={handleExport} disabled={exporting || !canExport} className="inline-flex items-center gap-2 px-5 min-h-[40px] rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export PDF
          </button>
        </div>
      </div>

      {!canExport && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
          Add your name + at least one skill or project to enable PDF export. Save anytime — data is kept locally.
        </div>
      )}

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

          <div className="flex items-center gap-2 text-xs text-surface-400 justify-center py-2">
            <Share2 size={12} /> PDF is image-based (pixel-perfect). Print also works via browser.
          </div>
        </div>

        {/* Right: Live Preview - sticky */}
        <div className="lg:sticky lg:top-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold tracking-widest uppercase text-surface-400">Live Preview</p>
            <span className="text-xs text-surface-400">A4 · {data.template}</span>
          </div>
          <div className="bg-surface-100 dark:bg-night-900 rounded-2xl p-3 sm:p-4 border border-surface-200 dark:border-night-700">
            <div className="bg-white rounded-xl overflow-hidden shadow-sm print:shadow-none" style={{ colorScheme: 'light' }}>
              <ResumePreview ref={previewRef} data={data} />
            </div>
          </div>
          <p className="text-xs text-center text-surface-400">Preview = PDF. What you see is what exports.</p>
        </div>
      </div>
    </div>
  )
}
