/**
 * CampusFlow — on-demand heavy chunks (popular-sites pattern).
 * WHY: tesseract (~3MB) / jspdf / docx / pdfjs / mammoth / html-to-image /
 * framer-motion dominate bundle. Static imports put them in the initial
 * download; dynamic import() splits each into its own chunk loaded only
 * when the user actually needs it (Resume export, Attendance/Timetable OCR,
 * below-fold motion).
 *
 * Usage: `const { createWorker } = await loadTesseract()` inside a click
 * handler — never at module top-level.
 */

let tesseractCache: any = null
export async function loadTesseract(): Promise<any> {
  if (!tesseractCache) tesseractCache = await import('tesseract.js')
  return tesseractCache
}

let motionCache: any = null
export async function loadMotion(): Promise<any> {
  if (!motionCache) motionCache = await import('framer-motion')
  return motionCache
}

export async function loadJsPdf(): Promise<any> {
  const mod: any = await import('jspdf')
  return mod.jsPDF || mod.default || mod
}

export async function loadPdfJs(): Promise<any> {
  const mod: any = await import('pdfjs-dist')
  return mod
}

export async function loadMammoth(): Promise<any> {
  const mod: any = await import('mammoth')
  return mod
}

export async function loadHtmlToImage(): Promise<{ toPng: (el: HTMLElement, opts?: any) => Promise<string> }> {
  const mod: any = await import('html-to-image')
  return { toPng: mod.toPng }
}

export async function loadDocxModule(): Promise<any> {
  const mod: any = await import('docx')
  return mod
}

/**
 * Offline OCR fallback for Attendance/Timetable (backend-first, client fallback).
 * Backend Groq vision is authoritative; this runs only when offline or when
 * the server parse fails — keeps tesseract out of the bundle until needed.
 */
export async function offlineOcrFallback(imageUrl: string, onProgress?: (p: number) => void): Promise<string> {
  const T: any = await loadTesseract()
  const createWorker = T.createWorker || T.default?.createWorker
  if (!createWorker) throw new Error('OCR unavailable')
  const worker: any = await createWorker('eng')
  try {
    if (onProgress && worker.setParameters) {
      // tesseract.js v7 progress via logger param
    }
    const { data } = await worker.recognize(imageUrl)
    return String(data?.text || '')
  } finally {
    try { await worker.terminate() } catch {}
  }
  void onProgress
}
