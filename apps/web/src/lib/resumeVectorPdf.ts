/**
 * CampusFlow — PDF via jsPDF (thin dispatcher + compat barrel).
 * Six templates: custom (fully editable, accent/font/order), source-split, compact, classic, modern, minimal
 * PDF — selectable, hyperlinked.
 *
 * WHY: was a 1557-line god (6 templates + shared helpers + dispatch in one
 * file). Split into ./resume/vector/* (shared + classic/modern/minimal/
 * sourceSplit/compact/custom + barrel). This file keeps ONLY dispatch
 * (generateVectorPdfBlob/downloadVectorPdf) plus compat re-exports so existing
 * imports keep working. Behavior identical.
 */
import type { ResumeData, ResumeTemplateId } from '../types/resume';
import type { JsPDFInstance } from './resume/vector/shared';
import { loadJsPDF, safeName } from './resume/vector/shared';
import { renderClassic } from './resume/vector/classic';
import { renderModern } from './resume/vector/modern';
import { renderMinimal } from './resume/vector/minimal';
import { renderSourceSplit } from './resume/vector/sourceSplit';
import { renderCompact } from './resume/vector/compact';
import { renderCustom } from './resume/vector/custom';

// Compat: shared helpers + templates preserved for deep importers.
export type { JsPDFInstance };
export { loadJsPDF, safeName };
export { renderClassic, renderModern, renderMinimal, renderSourceSplit, renderCompact, renderCustom };

/**
 * Generate selectable, hyperlinked A4 PDF (dispatch by data.template)
 */
export async function generateVectorPdfBlob(data: ResumeData): Promise<Blob> {
  const JsPDF = await loadJsPDF()
  const doc: JsPDFInstance = new JsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
  const tpl: ResumeTemplateId = (data.template as ResumeTemplateId) || 'source-split'
  if (tpl === 'asis') {
    // As-is: still generate a structured vector PDF from data (original file download is separate via handleExportVector)
    // Fallback to source-split styled vector so the structured data remains exportable
    await renderSourceSplit(doc, data)
  } else if (tpl === 'custom') {
    await renderCustom(doc, data)
  } else if (tpl === 'source-split') {
    await renderSourceSplit(doc, data)
  } else if (tpl === 'compact') {
    await renderCompact(doc, data)
  } else if (tpl === 'modern') {
    await renderModern(doc, data)
  } else if (tpl === 'minimal') {
    await renderMinimal(doc, data)
  } else {
    await renderClassic(doc, data)
  }
  const blob: Blob = doc.output('blob')
  return blob
}

export async function downloadVectorPdf(data: ResumeData) {
  const blob = await generateVectorPdfBlob(data)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const tpl = (data.template || 'source-split')
  const suffix = tpl === 'asis' ? 'OriginalAsIs' : tpl === 'custom' ? 'Custom' : tpl === 'source-split' ? 'SourceSplit' : tpl === 'compact' ? 'Compact' : tpl === 'modern' ? 'Modern' : tpl === 'minimal' ? 'Minimal' : 'Classic'
  a.download = `${safeName(data)}_Resume_${suffix}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
