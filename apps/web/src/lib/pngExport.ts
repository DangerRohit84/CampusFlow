/**
 * CampusFlow — PNG preview via html-to-image
 * capture previewRef to PNG, add Download PNG button
 */
import { toPng } from 'html-to-image'

export async function downloadPreviewPng(element: HTMLElement, filenameBase?: string): Promise<void> {
  if (!element) throw new Error('Preview element not found')
  // html-to-image options tuned for resume: high pixelRatio for sharpness
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    // Prefer inline style for accurate capture
    style: {
      transform: 'scale(1)',
    },
    // Filter out unwanted inline editing chrome?
    filter: (node: HTMLElement) => {
      // Exclude any element with data-no-png attribute if needed
      if (node instanceof HTMLElement && node.getAttribute?.('data-no-png') === 'true') return false
      return true
    },
  })
  const a = document.createElement('a')
  a.href = dataUrl
  const safe = (filenameBase || 'Resume').replace(/\s+/g, '_') || 'Resume'
  a.download = `${safe}_Preview.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function capturePreviewPngDataUrl(element: HTMLElement): Promise<string> {
  return toPng(element, { cacheBust: true, pixelRatio: 2, backgroundColor: '#ffffff' })
}
