import { useEffect, useRef, useState, useCallback } from 'react'
import type { ResumeData } from '../../types/resume'

type Props = {
  data: ResumeData
  onChange?: (next: ResumeData) => void
  objectUrlOverride?: string | null
}

function isPdfAsset(data: ResumeData): boolean {
  const a = data.originalAsset
  if (!a) return false
  const name = (a.fileName || '').toLowerCase()
  const mime = (a.mimeType || '').toLowerCase()
  return mime.includes('pdf') || name.endsWith('.pdf') || a.dataUrl?.startsWith('data:application/pdf')
}

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  if (dataUrl.startsWith('blob:')) {
    const r = await fetch(dataUrl)
    return await r.arrayBuffer()
  }
  if (dataUrl.startsWith('data:')) {
    const base64 = dataUrl.split(',')[1] || ''
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }
  const r = await fetch(dataUrl)
  return await r.arrayBuffer()
}

export default function AsIsResumePreview({ data, onChange, objectUrlOverride }: Props) {
  const asset = data.originalAsset
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderMode, setRenderMode] = useState<'iframe' | 'canvas'>('canvas')
  const [numPages, setNumPages] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editOverlay, setEditOverlay] = useState(false)
  const [scale, setScale] = useState(1.15)
  const canvasRefs = useRef<HTMLCanvasElement[]>([])
  const [docxHtml, setDocxHtml] = useState<string | null>(null)

  const src = objectUrlOverride || asset?.dataUrl || ''
  const isPdf = isPdfAsset(data)
  const hasAsset = Boolean(asset && src)

  // Keep onChange and data stable via refs to avoid race while still reading latest
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Render generation + cancellation refs to solve StrictMode double-mount and race
  const renderGenRef = useRef(0)
  const pdfDocRef = useRef<any>(null)
  const renderTasksRef = useRef<any[]>([])

  const safeClearContainer = useCallback((container: HTMLElement | null) => {
    if (!container) return
    try {
      if (typeof (container as any).replaceChildren === 'function') {
        ;(container as any).replaceChildren()
        return
      }
    } catch {}
    while (container.firstChild) {
      const child: ChildNode = container.firstChild as ChildNode
      if (child.parentNode !== container) {
        try {
          container.innerHTML = ''
        } catch {}
        break
      }
      try {
        container.removeChild(child)
      } catch {
        try {
          container.innerHTML = ''
        } catch {}
        break
      }
    }
  }, [])

  // For DOCX preview via mammoth
  useEffect(() => {
    if (!asset || isPdf || !src) {
      setDocxHtml(null)
      return
    }
    const name = (asset.fileName || '').toLowerCase()
    if (!(name.endsWith('.docx') || name.endsWith('.doc'))) {
      setDocxHtml(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const ab = await dataUrlToArrayBuffer(src)
        if (cancelled) return
        const mammoth: any = await import('mammoth')
        const mod = mammoth.default || mammoth
        const result = await mod.convertToHtml({ arrayBuffer: ab }, { includeDefaultStyleMap: true })
        if (!cancelled) setDocxHtml(result.value || '<p class="text-sm text-surface-500">No preview available — download original to view.</p>')
      } catch (e: any) {
        if (!cancelled) setDocxHtml(`<p class="text-xs text-red-600">Preview failed: ${String(e?.message || e)}</p>`)
      }
    })()
    return () => { cancelled = true }
  }, [asset, isPdf, src])

  // Render PDF pages via PDF.js canvas for pixel-perfect as-is with optional overlay
  const renderPdfCanvases = useCallback(async () => {
    if (!isPdf || !src) return
    const containerAtCall = containerRef.current
    if (!containerAtCall) return

    const myGen = ++renderGenRef.current
    try {
      for (const t of renderTasksRef.current) {
        try { t.cancel?.() } catch {}
      }
    } catch {}
    renderTasksRef.current = []
    try {
      if (pdfDocRef.current) {
        try { await pdfDocRef.current.destroy?.() } catch {}
        pdfDocRef.current = null
      }
    } catch {}

    setLoading(true)
    setError(null)

    const container = containerRef.current
    if (!container) {
      setLoading(false)
      return
    }

    try {
      const pdfjs: any = await import('pdfjs-dist')
      if (myGen !== renderGenRef.current) return
      if (!containerRef.current || containerRef.current !== container) return
      if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
        const ver = (pdfjs as any).version || '5.4.296'
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${ver}/pdf.worker.min.mjs`
      }
      let dataBuf: ArrayBuffer | null = null
      try {
        dataBuf = await dataUrlToArrayBuffer(src)
      } catch (e) {
        throw new Error('Failed to load PDF bytes: ' + String((e as any)?.message || e))
      }
      if (myGen !== renderGenRef.current) return
      if (!containerRef.current || containerRef.current !== container) return
      if (!dataBuf || (dataBuf as ArrayBuffer).byteLength < 8) throw new Error('Empty PDF')

      const loadingTask = pdfjs.getDocument({ data: dataBuf })
      const pdf = await loadingTask.promise
      if (myGen !== renderGenRef.current) {
        try { await pdf.destroy?.() } catch {}
        return
      }
      if (!containerRef.current || containerRef.current !== container) {
        try { await pdf.destroy?.() } catch {}
        return
      }
      pdfDocRef.current = pdf
      if (myGen === renderGenRef.current && containerRef.current === container) {
        setNumPages(pdf.numPages)
      }

      safeClearContainer(container)
      canvasRefs.current = []

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      for (let i = 1; i <= pdf.numPages; i++) {
        if (myGen !== renderGenRef.current) break
        if (!containerRef.current || containerRef.current !== container) break
        if (container.parentNode === null && !document.body.contains(container)) break

        const page = await pdf.getPage(i)
        if (myGen !== renderGenRef.current) break
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        canvas.className = 'block mx-auto shadow-sm border border-surface-200 bg-white'
        canvas.style.display = 'block'
        canvas.style.margin = '0 auto 12px auto'

        const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
        const renderContext: any = { canvasContext: ctx, viewport, transform }
        const renderTask = page.render(renderContext)
        renderTasksRef.current.push(renderTask)
        try {
          await renderTask.promise
        } catch (e: any) {
          if (e?.name === 'RenderingCancelledException' || String(e).includes('cancelled')) {
            break
          }
          throw e
        } finally {
          renderTasksRef.current = renderTasksRef.current.filter((t) => t !== renderTask)
        }
        if (myGen !== renderGenRef.current) break
        if (!containerRef.current || containerRef.current !== container) break

        const wrapper = document.createElement('div')
        wrapper.className = 'relative mx-auto group/page'
        wrapper.style.width = `${viewport.width}px`
        wrapper.style.margin = '0 auto 12px auto'
        wrapper.appendChild(canvas)

        // If overlay enabled, add text layer with contentEditable spans — FIXED: proper cursor, focus, persistence
        if (editOverlay) {
          try {
            const textContent = await page.getTextContent()
            if (myGen !== renderGenRef.current) break
            const textLayer = document.createElement('div')
            // FIX: allow pointer events so spans can be focused; overlay itself must be interactive
            textLayer.className = 'absolute inset-0'
            textLayer.style.width = `${viewport.width}px`
            textLayer.style.height = `${viewport.height}px`
            textLayer.style.left = '0'
            textLayer.style.top = '0'
            textLayer.style.pointerEvents = onChangeRef.current ? 'auto' : 'none'
            textLayer.style.overflow = 'hidden'
            // Enable text selection cursor across layer
            textLayer.style.cursor = onChangeRef.current ? 'text' : 'default'

            const overlayEdits = (dataRef.current as any)?.pdfOverlayEdits as Record<string, string> | undefined

            let itemIdx = 0
            for (const item of textContent.items as any[]) {
              const originalStr: string = item.str || ''
              if (!originalStr.trim()) {
                itemIdx++
                continue
              }
              const tx = (pdfjs as any).Util.transform(viewport.transform, item.transform)
              const x = tx[4]
              const y = viewport.height - tx[5]
              const fontSize = Math.hypot(tx[0], tx[1])
              if (!isFinite(fontSize) || fontSize < 1) {
                itemIdx++
                continue
              }

              const key = `${i}-${itemIdx}`
              const edited = overlayEdits?.[key]
              const displayText = edited !== undefined ? edited : originalStr

              const span = document.createElement('span')
              span.textContent = displayText
              span.dataset.key = key
              span.dataset.original = originalStr
              // FIX: ensure contentEditable is strictly true when editOverlay ON and onChange exists
              if (onChangeRef.current) {
                span.contentEditable = 'true'
                ;(span as any).spellcheck = false
                span.setAttribute('contenteditable', 'true')
              } else {
                span.contentEditable = 'false'
                span.setAttribute('contenteditable', 'false')
              }
              ;(span as any).spellcheck = false
              span.tabIndex = onChangeRef.current ? 0 : -1
              span.setAttribute('role', 'textbox')
              span.setAttribute('aria-label', 'Editable resume text — click to edit')
              span.style.position = 'absolute'
              span.style.left = `${x}px`
              span.style.top = `${y - fontSize * 0.85}px`
              span.style.fontSize = `${fontSize}px`
              span.style.lineHeight = '1'
              span.style.whiteSpace = 'pre'
              span.style.fontFamily = 'inherit'
              // FIX: start transparent but hover/focus will reveal via JS (inline overrides Tailwind)
              span.style.color = 'transparent'
              span.style.caretColor = '#4f46e5'
              span.style.background = 'transparent'
              span.style.pointerEvents = onChangeRef.current ? 'auto' : 'none'
              span.style.userSelect = 'text'
              span.style.cursor = onChangeRef.current ? 'text' : 'default'
              span.style.minWidth = `${item.width ? Math.max(item.width * viewport.scale * 0.52, 18) : 18}px`
              if (item.width) {
                // use PDF width scaled to CSS — fallback ensures hit area
                const cssW = (item.width * viewport.scale * 0.52)
                if (isFinite(cssW) && cssW > 0) span.style.minWidth = `${Math.max(cssW, 18)}px`
              }
              span.style.minHeight = `${Math.max(fontSize * 1.05, 12)}px`
              span.style.padding = '1px 2px'
              span.style.borderRadius = '3px'
              span.style.border = '1px dashed transparent'
              span.style.outline = 'none'
              span.style.display = 'inline-block'
              span.style.transition = 'color 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s'
              // Keep visual border of canvas intact — overlay border is dashed amber only on hover/focus
              span.title = 'Click to edit — edit in place; changes saved to overlay (original border preserved)'
              // Ensure text layer preserves borders: wrapper retains canvas border, overlay has its own transparent border
              span.style.zIndex = '2'

              if (onChangeRef.current) {
                let isFocused = false

                const applyHover = () => {
                  if (isFocused) return
                  span.style.color = '#92400e' // amber-900
                  span.style.background = 'rgba(254,243,199,0.58)'
                  span.style.borderColor = 'rgba(245,158,11,0.55)'
                  span.style.boxShadow = '0 1px 2px rgba(0,0,0,0.07)'
                }
                const removeHover = () => {
                  if (isFocused) return
                  span.style.color = 'transparent'
                  span.style.background = 'transparent'
                  span.style.borderColor = 'transparent'
                  span.style.boxShadow = 'none'
                }

                span.addEventListener('mouseenter', applyHover)
                span.addEventListener('mouseleave', removeHover)
                span.addEventListener('focus', () => {
                  isFocused = true
                  span.style.color = '#111827'
                  span.style.background = 'rgba(255,255,255,0.97)'
                  span.style.borderColor = '#f59e0b'
                  span.style.borderStyle = 'solid'
                  span.style.boxShadow = '0 0 0 2px rgba(245,158,11,0.22), 0 2px 10px rgba(0,0,0,0.14)'
                  span.style.outline = 'none'
                  span.style.zIndex = '5'
                  // Ensure caret visible — select all on focus for quick edit
                  try {
                    const range = document.createRange()
                    range.selectNodeContents(span)
                    // don't auto-select if already has selection; but place cursor at end
                    // We'll just keep native behavior — user can click to place cursor
                  } catch {}
                })

                const persist = () => {
                  const wasFocused = isFocused
                  isFocused = false
                  const newText = (span.textContent || '').replace(/\u00a0/g, ' ')
                  const original = span.dataset.original || originalStr
                  const keyForPersist = span.dataset.key || key
                  // Always reset visual state first, then decide persistence
                  // If still hovered, keep hover style
                  const isHover = span.matches(':hover')
                  if (isHover) {
                    span.style.color = '#92400e'
                    span.style.background = 'rgba(254,243,199,0.58)'
                    span.style.borderColor = 'rgba(245,158,11,0.55)'
                    span.style.borderStyle = 'dashed'
                    span.style.boxShadow = '0 1px 2px rgba(0,0,0,0.07)'
                  } else {
                    span.style.color = 'transparent'
                    span.style.background = 'transparent'
                    span.style.borderColor = 'transparent'
                    span.style.boxShadow = 'none'
                    span.style.borderStyle = 'dashed'
                  }
                  span.style.zIndex = '2'
                  span.style.outline = 'none'

                  // Compare trimmed but preserve internal spaces
                  const normNew = newText
                  const normOrig = original
                  if (normNew !== normOrig) {
                    // Persist to resumeData via onChange — keep borders, just overlay edits
                    try {
                      const current = dataRef.current as any
                      const existingEdits: Record<string, string> = current.pdfOverlayEdits ? { ...current.pdfOverlayEdits } : {}
                      existingEdits[keyForPersist] = newText
                      const next: ResumeData = {
                        ...current,
                        pdfOverlayEdits: existingEdits,
                        updatedAt: new Date().toISOString(),
                      }
                      // Keep dataset in sync so next blur compares correctly
                      span.dataset.original = newText
                      // Also keep displayText in sync for future renders
                      onChangeRef.current?.(next)
                    } catch (e) {
                      console.warn('persist overlay edit failed', e)
                    }
                  } else if (wasFocused) {
                    // If user reverted to original, ensure we remove stored edit if exists
                    const current = dataRef.current as any
                    if (current.pdfOverlayEdits?.[keyForPersist] !== undefined) {
                      const nextEdits = { ...current.pdfOverlayEdits }
                      // only delete if stored value equals original (means no diff)
                      // Actually if newText === original, we should delete the key to indicate no override
                      if (nextEdits[keyForPersist] !== undefined) {
                        // Check if stored was same as originalStr initial — if now edited back to original, delete
                        // For simplicity, delete when newText === originalStr (the very first original)
                        // Need to compare against the very first originalStr, not dataset.original which may have been updated
                        // So we compare newText to originalStr from closure
                        if (newText === originalStr) {
                          delete nextEdits[keyForPersist]
                          const next: ResumeData = {
                            ...current,
                            pdfOverlayEdits: nextEdits,
                            updatedAt: new Date().toISOString(),
                          }
                          onChangeRef.current?.(next)
                        }
                      }
                    }
                  }
                }

                span.addEventListener('blur', persist)
                span.addEventListener('keydown', (e: KeyboardEvent) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    ;(span as HTMLElement).blur()
                  }
                  if (e.key === 'Escape') {
                    // Revert to last persisted/original
                    const orig = span.dataset.original || originalStr
                    // If there was an edited version stored, revert to originalStr's initial value
                    // We revert to the stored edit's original? For UX, revert to originalStr initial
                    const overlay = (dataRef.current as any)?.pdfOverlayEdits?.[key]
                    const revertTo = overlay !== undefined ? originalStr : orig
                    span.textContent = revertTo
                    e.preventDefault()
                    ;(span as HTMLElement).blur()
                  }
                })
                // Input handler to ensure contentEditable remains responsive and to update visual if needed
                span.addEventListener('input', () => {
                  // Keep focused style while typing
                  if (isFocused) {
                    span.style.color = '#111827'
                    span.style.background = 'rgba(255,255,255,0.97)'
                  }
                })
              }
              textLayer.appendChild(span)
              itemIdx++
            }
            wrapper.appendChild(textLayer)
          } catch {}
        }

        const badge = document.createElement('div')
        badge.textContent = `${i} / ${pdf.numPages}`
        badge.className = 'absolute top-2 right-2 text-[9px] font-bold tracking-widest uppercase bg-black/70 text-white px-1.5 py-0.5 rounded-full pointer-events-none'
        wrapper.appendChild(badge)

        if (myGen !== renderGenRef.current) break
        if (!containerRef.current || containerRef.current !== container) break
        try {
          if (container.isConnected || container.parentNode || document.body.contains(container) || containerRef.current === container) {
            container.appendChild(wrapper)
            canvasRefs.current.push(canvas)
          }
        } catch (appendErr) {
          console.warn('AsIs append cancelled', appendErr)
          break
        }
      }
    } catch (e: any) {
      if (myGen !== renderGenRef.current) return
      if (!containerRef.current) return
      const msg = String(e?.message || e)
      if (msg.includes('cancelled') || msg.includes('RenderingCancelled')) return
      console.error(e)
      setError(msg)
      setRenderMode('iframe')
    } finally {
      if (myGen === renderGenRef.current) {
        setLoading(false)
      }
    }
  }, [isPdf, src, scale, editOverlay, safeClearContainer])

  useEffect(() => {
    if (!hasAsset) return
    if (!isPdf) return
    if (renderMode !== 'canvas') return
    renderPdfCanvases()
    return () => {
      renderGenRef.current++
      for (const t of renderTasksRef.current) {
        try { t.cancel?.() } catch {}
      }
      renderTasksRef.current = []
    }
  }, [hasAsset, isPdf, renderMode, renderPdfCanvases])

  useEffect(() => {
    return () => {
      renderGenRef.current++
      for (const t of renderTasksRef.current) {
        try { t.cancel?.() } catch {}
      }
      renderTasksRef.current = []
      if (pdfDocRef.current) {
        try { pdfDocRef.current.destroy?.() } catch {}
        pdfDocRef.current = null
      }
      const c = containerRef.current
      if (c) {
        try {
          safeClearContainer(c)
        } catch {}
      }
    }
  }, [safeClearContainer])

  if (!hasAsset) {
    return (
      <div className="bg-white rounded-xl border-2 border-dashed border-surface-200 p-8 text-center">
        <p className="text-sm font-semibold text-surface-700">No original file yet</p>
        <p className="text-xs text-surface-500 mt-1">Upload a PDF/DOCX — it will appear here <b>exactly as is</b> with every border, font and spacing preserved. Then toggle <b>Edit</b> or edit LaTeX on the left.</p>
        <p className="text-[11px] text-surface-400 mt-3">Tip: Switch to <b>Custom</b> or other templates if you want to restyle — <b>Original — As Is</b> keeps visual 1:1.</p>
      </div>
    )
  }

  if (!isPdf) {
    const isDocx = (() => {
      const n = (asset!.fileName || '').toLowerCase()
      return n.endsWith('.docx') || n.endsWith('.doc')
    })()
    const displayHtml = (data as any).docxEditedHtml || docxHtml
    return (
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-surface-100 bg-surface-50/50">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded-full bg-amber-500 text-white text-[10px] font-bold tracking-widest uppercase">Original — As Is</span>
            <span className="text-xs font-medium text-surface-700 truncate max-w-[160px]">{asset!.fileName}</span>
            <span className="text-[11px] text-surface-500">{((asset!.size) / 1024).toFixed(0)} KB</span>
            {editOverlay && onChange && <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-bold">EDITABLE — click text to type</span>}
          </div>
          <div className="flex items-center gap-2">
            <a href={src} download={asset!.fileName} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold">Download original</a>
            {onChange && <span className="hidden sm:inline text-[11px] text-surface-500">DOCX preview — download is pixel-perfect.</span>}
          </div>
        </div>
        <div className="p-0">
          {displayHtml ? (
            <div
              contentEditable={editOverlay && !!onChange && isDocx}
              suppressContentEditableWarning
              onBlur={(e) => {
                if (!onChange || !editOverlay) return
                const newHtml = e.currentTarget.innerHTML
                const originalHtml = docxHtml || ''
                // Only persist if changed from last persisted
                const currentEdited = (data as any).docxEditedHtml
                const baseline = currentEdited !== undefined ? currentEdited : originalHtml
                if (newHtml !== baseline) {
                  const next: ResumeData = {
                    ...(dataRef.current as any),
                    docxEditedHtml: newHtml,
                    updatedAt: new Date().toISOString(),
                  }
                  onChangeRef.current?.(next)
                }
              }}
              onInput={(e) => {
                // Visual feedback while typing — add subtle ring via inline style if needed
                if (editOverlay && onChange) {
                  ;(e.currentTarget as HTMLElement).style.outline = 'none'
                }
              }}
              className={
                editOverlay && onChange && isDocx
                  ? 'prose prose-sm max-w-none p-6 text-surface-900 prose-a:text-primary-600 prose-a:underline focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-inset rounded-none cursor-text hover:bg-amber-50/20 transition-colors border border-transparent focus:border-amber-300 bg-white'
                  : 'prose prose-sm max-w-none p-6 text-surface-900 prose-a:text-primary-600 prose-a:underline bg-white'
              }
              style={{ fontFamily: "'Calibri','Helvetica Neue',Helvetica,Arial,sans-serif", minHeight: '200px', cursor: editOverlay && onChange && isDocx ? 'text' as any : undefined }}
              dangerouslySetInnerHTML={{ __html: displayHtml }}
            />
          ) : (
            <div className="p-8 text-center text-sm text-surface-500 flex items-center justify-center gap-2">
              <span className="animate-pulse">Rendering DOCX…</span>
            </div>
          )}
        </div>
        {editOverlay && onChange && isDocx && (
          <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
            <b>Edit ON:</b> Click any text above to edit in place — changes are saved to <code className="px-1 py-0.5 bg-white rounded border text-[11px]">docxEditedHtml</code> in resumeData and persist across reloads. Download still gives original file; edited HTML is for quick fixes. Toggle <b>Edit</b> off to view pure original.
          </div>
        )}
        {editOverlay && onChange && !isDocx && (
          <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs text-amber-800">
            <b>Edit Overlay:</b> This file type preview is static — use left <b>Form / LaTeX</b> to edit structured data. For DOCX/PDF, overlay is fully editable.
          </div>
        )}
        <div className="px-4 py-2 bg-white border-t flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-surface-700 cursor-pointer select-none">
            <input type="checkbox" checked={editOverlay} onChange={e => setEditOverlay(e.target.checked)} className="rounded border-surface-300 cursor-pointer" /> <span className={editOverlay ? 'text-amber-700 font-semibold' : ''}>{editOverlay ? '✎ Editing — click text to type' : 'Edit Overlay'}</span>
          </label>
          <span className="text-[11px] text-surface-400">Preserved as uploaded — edit via overlay or left Form / LaTeX, preview updates via overlay if enabled.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#f8fafc] rounded-xl border border-surface-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-white border-b border-surface-200 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold tracking-widest uppercase">As Is — Borders Preserved</span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-surface-700 max-w-[140px] truncate" title={asset!.fileName}>{asset!.fileName}</span>
          {numPages > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-100 border border-surface-200 text-surface-600">{numPages} page{numPages>1?'s':''}</span>}
          {loading && <span className="text-[11px] text-surface-500 animate-pulse">Rendering…</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="hidden sm:flex items-center gap-1 p-1 rounded-full bg-surface-100 border border-surface-200">
            <button onClick={() => setScale(s => Math.max(0.6, +(s - 0.15).toFixed(2)))} className="w-7 h-7 rounded-full bg-white border border-surface-200 flex items-center justify-center hover:bg-surface-50 text-surface-700" title="Zoom out">−</button>
            <span className="text-[11px] font-bold text-surface-700 min-w-[40px] text-center">{Math.round(scale*100)}%</span>
            <button onClick={() => setScale(s => Math.min(2.2, +(s + 0.15).toFixed(2)))} className="w-7 h-7 rounded-full bg-white border border-surface-200 flex items-center justify-center hover:bg-surface-50 text-surface-700" title="Zoom in">+</button>
          </div>
          {/* FIX: Edit toggle now clearly enables contentEditable spans with cursor:text */}
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-semibold cursor-pointer select-none" style={{ background: editOverlay ? '#fef3c7' : 'white', borderColor: editOverlay ? '#f59e0b' : '#e2e8f0', color: editOverlay ? '#92400e' : '#475569', cursor: 'pointer' }}>
            <input type="checkbox" checked={editOverlay} onChange={e => setEditOverlay(e.target.checked)} className="rounded cursor-pointer" /> {editOverlay ? '✎ Editing' : 'Edit'}
          </label>
          <select value={renderMode} onChange={e => setRenderMode(e.target.value as any)} className="text-xs rounded-xl border border-surface-200 bg-white px-2 py-1.5 font-medium text-surface-700">
            <option value="canvas">Canvas (pixel-perfect)</option>
            <option value="iframe">Native PDF</option>
          </select>
          <a href={src} download={asset!.fileName} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold">Download</a>
        </div>
      </div>

      {editOverlay && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] leading-relaxed text-amber-800 flex gap-2">
          <span className="shrink-0 mt-0.5">✎</span>
          <span><b>Edit Overlay ON — legacy mode</b> — position mapping may mismatch (known issue). <b>Recommended: edit LaTeX Source on left</b> (each LaTeX line maps 1:1, exact). Overlay hover → amber highlight; click to edit, <b>Enter</b> to save, <b>Esc</b> revert. Persists to <code className="px-1 py-0.5 bg-white rounded border text-[10px]">pdfOverlayEdits</code>. For precise edits use left LaTeX tab — converted via <code className="px-1 py-0.5 bg-white rounded border text-[10px]">POST /resume/convert-to-latex</code>.</span>
        </div>
      )}

      {error && (
        <div className="m-3 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
          <b>Render error:</b> {error} — switched to native viewer.
        </div>
      )}

      <div className="p-3 sm:p-4 bg-[#eef2f7] min-h-[480px]">
        {renderMode === 'iframe' ? (
          <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-surface-200">
            <object data={src} type="application/pdf" className="w-full block bg-white" style={{ height: '820px' }}>
              <iframe src={src} title="Original PDF — as is" className="w-full border-0 bg-white" style={{ height: '820px' }} />
            </object>
            <p className="text-[11px] text-center text-surface-500 py-2 border-t bg-white">Native PDF — exact borders, fonts, spacing as uploaded. If blank, use Canvas mode or Download. For editable overlay, switch to Canvas mode and toggle <b>Edit</b>.</p>
            {editOverlay && <p className="text-[11px] text-center text-amber-700 bg-amber-50 py-1.5 border-t border-amber-200">Edit overlay requires <b>Canvas (pixel-perfect)</b> mode — switch above.</p>}
          </div>
        ) : (
          <>
            {loading && !error && (
              <div className="py-16 text-sm text-surface-500 animate-pulse text-center">Rendering {numPages || 'PDF'} pages via PDF.js…</div>
            )}
            {!loading && numPages===0 && !error && (
              <div className="py-12 text-sm text-surface-400 text-center">No pages — try Native PDF mode or re-upload.</div>
            )}
            <div ref={containerRef} className="space-y-3 min-h-[200px] flex flex-col items-center" />
            <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-surface-500">
              <span className="px-2 py-1 rounded-full bg-white border border-surface-200">PDF.js canvas — borders & layout byte-identical to original</span>
              <a href={src} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary-600">Open in new tab</a>
            </div>
          </>
        )}
      </div>

      <div className="px-3 py-2 bg-white border-t border-surface-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-surface-500">
        <span>Original file preserved — download is byte-identical. Overlay edits are visual & persisted via onChange; borders remain. For ATS/structure edits use left <b>LaTeX</b> / <b>Form</b>.</span>
        <span className="inline-flex items-center gap-1">Scroll • Pinch to zoom • <span className="px-1.5 py-0.5 rounded bg-surface-100 border text-surface-600 font-medium">{scale>1?'Zoomed':'Fit'}</span></span>
      </div>
    </div>
  )
}
