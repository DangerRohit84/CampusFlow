import { useEffect, useState, useRef } from 'react'
import type { ResumeData } from '../../types/resume'
import { generateResumeLatex } from '../../lib/resumeLatex'

type Props = {
  data: ResumeData
  onChange: (next: ResumeData) => void
}

export default function LatexSourceEditor({ data, onChange }: Props) {
  const [local, setLocal] = useState<string>(() => data.latexSource || '')
  const [dirty, setDirty] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])

  // Keep local in sync with external data when not dirty / not focused
  // FIX: prevent clobbering cursor while typing — only sync if external differs and textarea not focused
  useEffect(() => {
    const external = data.latexSource || ''
    // If user is currently typing (focused), don't overwrite
    const isFocused = document.activeElement === textareaRef.current
    if (isFocused) return
    // If dirty and local already differs from external, keep user's edits
    // Only reset when external changed externally (e.g., upload or sync button)
    if (external !== local) {
      // If we are dirty, it means user has unsaved edits — don't blindly overwrite unless external is clearly newer and user not interacting
      // Heuristic: if dirty is true and local !== external, keep local unless external was just generated after upload (updatedAt changed)
      // We use updatedAt as signal: if updatedAt changed and external !== local, sync
      // Simpler: if not focused and external !== local, sync and clear dirty
      setLocal(external)
      setDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.latexSource, data.updatedAt])

  // Initialize with generated LaTeX if empty (ensures left side always editable)
  useEffect(() => {
    if (!data.latexSource || data.latexSource.trim().length < 10) {
      try {
        const fresh = generateResumeLatex(data)
        if (fresh && fresh !== data.latexSource) {
          // Only auto-init if local also empty to avoid overwriting user edits
          if (!local || local.trim().length < 10) {
            setLocal(fresh)
            setDirty(false)
            // Don't auto-call onChange here immediately — let user see generated source and save via debounce
            // But we do want data.latexSource to be persisted for preview sync — schedule microtask
            // Defer to next tick so parent doesn't loop
            setTimeout(() => {
              if (dataRef.current.latexSource !== fresh) {
                onChangeRef.current?.({ ...dataRef.current, latexSource: fresh, updatedAt: new Date().toISOString() })
              }
            }, 0)
          }
        }
      } catch {}
    }
    // run once on mount / when data changes significantly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // FIX: Auto-sync to preview via debounced onChange — ensures left edits immediately reflect in data (and thus preview if needed)
  // This satisfies requirement: left side LaTeX source should be editable and sync to preview
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      // Only sync if local differs from external
      if (local !== (dataRef.current.latexSource || '')) {
        onChangeRef.current?.({ ...dataRef.current, latexSource: local, updatedAt: new Date().toISOString() })
        setDirty(false)
      }
    }, 450)
    return () => clearTimeout(t)
  }, [local, dirty])

  const handleSave = () => {
    onChange({ ...data, latexSource: local, updatedAt: new Date().toISOString() })
    setDirty(false)
  }

  const handleSyncFromData = () => {
    try {
      const fresh = generateResumeLatex(data)
      setLocal(fresh)
      onChange({ ...data, latexSource: fresh, updatedAt: new Date().toISOString() })
      setDirty(false)
      textareaRef.current?.focus()
    } catch (e) {
      console.error(e)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([local || data.latexSource || ''], { type: 'application/x-tex;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safe = (data.personalInfo.fullName || 'Resume').replace(/\s+/g, '_')
    a.download = `${safe}_Resume.tex`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const lineCount = local.split('\n').length

  return (
    <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 overflow-hidden flex flex-col">
      <div className="px-3 py-2.5 border-b border-surface-200 dark:border-night-700 flex flex-wrap items-center justify-between gap-2 bg-surface-50/50 dark:bg-night-900/30">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded-full bg-amber-500 text-white text-[10px] font-bold tracking-widest uppercase">LaTeX</span>
          <span className="text-xs font-semibold text-surface-700 dark:text-night-200">Source — left side editable (auto-sync)</span>
          <span className="text-[11px] text-surface-500 dark:text-night-400 hidden sm:inline">{lineCount} lines</span>
          {dirty && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-bold animate-pulse">Editing… auto-saving</span>}
          {!dirty && local !== (data.latexSource || '') && <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">Synced</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={handleSyncFromData} className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 text-xs font-medium text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700 cursor-pointer">Sync from Data ↻</button>
          <button onClick={handleSave} disabled={!dirty} className="px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold cursor-pointer">Save LaTeX</button>
          <button onClick={handleDownload} className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-medium hover:bg-amber-100 cursor-pointer">Download .tex</button>
        </div>
      </div>

      <div className="relative flex-1 flex">
        {/* Line numbers gutter — sync scroll with textarea */}
        <div className="hidden sm:block w-12 shrink-0 bg-surface-50 dark:bg-night-900 border-r border-surface-200 dark:border-night-700 py-3 text-right pr-2 select-none overflow-hidden" aria-hidden>
          {Array.from({ length: Math.min(lineCount, 900) }).map((_, i) => (
            <div key={i} className="text-[11px] leading-5 font-mono text-surface-400 dark:text-night-500">{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={local}
          onChange={e => {
            const v = e.target.value
            setLocal(v)
            setDirty(v !== (dataRef.current.latexSource || ''))
          }}
          onFocus={() => {
            // ensure cursor visible
            if (textareaRef.current) textareaRef.current.style.cursor = 'text'
          }}
          placeholder={`% Paste or edit LaTeX here — this is your as-is source.
% Example:
\\documentclass[10pt,a4paper]{article}
\\begin{document}
Hello ${data.personalInfo.fullName || 'Your Name'}
\\end{document}

% Tip: Click "Sync from Data" to regenerate from structured fields.
% Right preview (Original — As Is) stays byte-identical to uploaded PDF unless you recompile.
% Edits auto-sync to preview every 500ms — borders preserved.`}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="flex-1 w-full min-h-[520px] max-h-[720px] p-3 font-mono text-[12px] leading-5 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-300 resize-y cursor-text selection:bg-amber-200/50"
          style={{ tabSize: 2, pointerEvents: 'auto', caretColor: '#4f46e5' }}
        />
      </div>

      <div className="px-3 py-2 border-t border-surface-200 dark:border-night-700 bg-surface-50 dark:bg-night-900 flex flex-wrap items-center justify-between gap-2 text-[11px] text-surface-500 dark:text-night-400">
        <span>Edits here are preserved as <code className="px-1 py-0.5 bg-white dark:bg-night-800 rounded border text-[10px]">latexSource</code> — auto-sync on typing (500ms debounce) + <b>Save</b> persists immediately. Export via header <b>Download TeX</b>.</span>
        <span className="hidden sm:inline">Monospace • Overleaf-ready • cursor: text • editable</span>
      </div>
    </div>
  )
}
