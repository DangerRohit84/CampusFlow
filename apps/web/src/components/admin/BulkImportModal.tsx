// components/admin/BulkImportModal.tsx — #11 bulk CSV import (dry-run → confirm).
// WHY: single-user create does not scale to semester onboarding (100s of
// rows). Flow: upload CSV → client parse → server dry-run report (errors per
// row, duplicate/dept checks) → confirm import (createMany skipDuplicates).
// CSV columns: name,email,department|dept,incomingYear|year,studentId|empNumber,
// password (optional). No secrets rendered: passwords never displayed back.

import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Upload, Download, CheckCircle, XCircle, Loader2, FileText } from 'lucide-react'
import clsx from 'clsx'
import { adminAPI, bulkImportAPI, type BulkDryRunReport } from '../../lib/api/resources/admin'

export type BulkRole = 'STUDENT' | 'TEACHER'

interface Props {
  open: boolean
  onClose: () => void
  collegeId: string | null
  role: BulkRole
  onImported: () => void
}

const MAX_ROWS = 1000

function splitLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { cells.push(cur); cur = '' }
    else cur += ch
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

const ALIASES: Record<string, string> = {
  name: 'name', fullname: 'name', 'full name': 'name',
  email: 'email', 'email address': 'email',
  dept: 'department', department: 'department', departmentname: 'department', 'department name': 'department',
  departmentid: 'departmentId', 'department id': 'departmentId',
  year: 'incomingYear', incomingyear: 'incomingYear', 'incoming year': 'incomingYear',
  studentid: 'studentId', 'student id': 'studentId', rollnumber: 'studentId', 'roll number': 'studentId',
  empnumber: 'empNumber', 'emp number': 'empNumber',
  password: 'password',
}

/** Client-side CSV → row objects (mirrors backend utils/csvImport.ts). */
export function parseCsvClient(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('CSV is empty: needs a header row plus at least one data row')
  const headers = splitLine(lines[0]).map((h) => ALIASES[h.toLowerCase()] ?? '')
  if (!headers.includes('email')) throw new Error("CSV header must include 'email'")
  if (!headers.includes('name')) throw new Error("CSV header must include 'name'")
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const cells = splitLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((key, idx) => { if (key) row[key] = (cells[idx] ?? '').trim() })
    rows.push(row)
  }
  return rows
}

export function bulkTemplate(role: BulkRole): string {
  return role === 'TEACHER'
    ? 'name,email,department,password\n"Jane Sharma",jane@college.edu,"Computer Science",\n'
    : 'name,email,department,incomingYear,studentId\n"Aarav Kumar",aarav@college.edu,"Computer Science",2024,STU001\n'
}

export default function BulkImportModal({ open, onClose, collegeId, role, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [pastedCsv, setPastedCsv] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [report, setReport] = useState<BulkDryRunReport | null>(null)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null)

  const validRows = useMemo(() => report?.rows.filter((r) => r.valid) ?? [], [report])

  if (!open) return null

  const reset = () => {
    setFileName('')
    setPastedCsv('')
    setRows([])
    setReport(null)
    setResult(null)
  }

  const handleUsePasted = () => {
    if (!pastedCsv.trim()) { toast.error('Paste CSV text first'); return }
    try {
      const parsed = parseCsvClient(pastedCsv)
      setFileName('pasted.csv')
      setRows(parsed)
      setReport(null)
      setResult(null)
      toast.success(`${parsed.length} pasted rows ready to validate`)
    } catch (e: any) {
      toast.error(e?.message || 'Could not parse pasted CSV')
    }
  }

  const handleFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const text = await f.text()
      const parsed = parseCsvClient(text)
      setFileName(f.name)
      setRows(parsed)
      setReport(null)
      setResult(null)
    } catch (e: any) {
      toast.error(e?.message || 'Could not parse CSV')
    }
  }

  const handleValidate = async () => {
    if (!rows.length) { toast.error('Upload a CSV first'); return }
    setValidating(true)
    try {
      const r = role === 'TEACHER'
        ? await bulkImportAPI.dryRunTeachers(rows, collegeId ?? undefined)
        : await bulkImportAPI.dryRunStudents(rows, collegeId ?? undefined)
      setReport(r)
      if (r.invalidCount === 0) toast.success(`${r.validCount} rows ready to import`)
      else toast.error(`${r.invalidCount} of ${r.total} rows need fixes`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Dry-run validation failed')
    } finally {
      setValidating(false)
    }
  }

  const handleConfirm = async () => {
    if (!report || report.validCount === 0) { toast.error('Nothing valid to import'); return }
    setImporting(true)
    try {
      // Re-send only valid rows (skip invalid client-side; server re-validates).
      const validIdx = new Set(validRows.map((r) => r.index))
      const payload = rows.filter((_, i) => validIdx.has(i))
      const res = role === 'TEACHER'
        ? await adminAPI.bulkAddTeachers(payload, collegeId ?? undefined)
        : await adminAPI.bulkAddStudents(payload, collegeId ?? undefined)
      setResult(res)
      if (res.success > 0) {
        toast.success(`Imported ${res.success} ${role === 'TEACHER' ? 'teachers' : 'students'}`)
        onImported()
      } else {
        toast.error('Import finished with 0 successes — see errors')
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([bulkTemplate(role)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = role === 'TEACHER' ? 'teachers-template.csv' : 'students-template.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Bulk import ${role === 'TEACHER' ? 'teachers' : 'students'}`}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-surface-900 dark:text-night-50">
            Bulk import {role === 'TEACHER' ? 'teachers' : 'students'}
          </h2>
          <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:underline">
            <Download size={14} /> CSV template
          </button>
        </div>
        <p className="text-xs text-surface-500 dark:text-night-400 mb-4">
          Upload CSV (name, email, department, {role === 'TEACHER' ? 'empNumber' : 'incomingYear, studentId'}) → dry-run validation → confirm import.
        </p>

        {/* Step 1: upload */}
        <div
          className="rounded-2xl border-2 border-dashed border-surface-200 dark:border-night-600 p-6 text-center cursor-pointer hover:border-primary-300 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={20} className="mx-auto text-surface-400 mb-2" />
          {fileName
            ? <p className="text-sm font-medium text-surface-900 dark:text-night-50">{fileName} — {rows.length} rows</p>
            : <p className="text-sm text-surface-500 dark:text-night-400">Click to choose a .csv file (max {MAX_ROWS} rows)</p>}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Upload CSV file"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {/* Step 1b: paste CSV (alternative to file upload) */}
        <div className="mt-3">
          <label htmlFor="bulk-paste-csv" className="block text-xs font-semibold text-surface-600 dark:text-night-300 mb-1.5">
            Or paste CSV rows
          </label>
          <textarea
            id="bulk-paste-csv"
            value={pastedCsv}
            onChange={(e) => setPastedCsv(e.target.value)}
            placeholder={bulkTemplate(role).trim()}
            rows={4}
            spellCheck={false}
            className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-xs font-mono bg-surface-50 dark:bg-night-900 text-surface-900 dark:text-night-50 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
          />
          <button
            onClick={handleUsePasted}
            disabled={!pastedCsv.trim()}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 min-h-[40px] rounded-xl border border-surface-200 dark:border-night-600 text-xs font-semibold text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700 disabled:opacity-50"
          >
            Use pasted CSV ({pastedCsv.trim() ? pastedCsv.split(/\r?\n/).filter((l) => l.trim()).length - 1 : 0} data rows)
          </button>
        </div>

        {/* Step 2: validate */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleValidate}
            disabled={!rows.length || validating}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-black text-sm font-semibold disabled:opacity-50"
          >
            {validating ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {validating ? 'Validating…' : 'Validate (dry-run)'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!report || report.validCount === 0 || importing}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {importing ? 'Importing…' : `Confirm import${report ? ` (${report.validCount})` : ''}`}
          </button>
        </div>

        {/* Dry-run report */}
        {report && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle size={14} /> {report.validCount} valid</span>
              <span className="inline-flex items-center gap-1 font-semibold text-danger-600"><XCircle size={14} /> {report.invalidCount} invalid</span>
              <span className="text-surface-400 text-xs">of {report.total}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-surface-200 dark:border-night-600 max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-50 dark:bg-night-900">
                  <tr className="border-b border-surface-100 dark:border-night-600">
                    <th className="text-left py-2 px-3 font-medium text-surface-500">Row</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-500">Email</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-500">Status</th>
                    <th className="text-left py-2 px-3 font-medium text-surface-500">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.index} className="border-b border-surface-50 dark:border-night-700">
                      <td className="py-1.5 px-3 font-mono">{r.index + 1}</td>
                      <td className="py-1.5 px-3">{r.email || '—'}</td>
                      <td className="py-1.5 px-3">
                        <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-bold', r.valid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-danger-50 text-danger-700 border border-danger-200')}>
                          {r.valid ? 'Valid' : 'Invalid'}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-danger-600">{r.errors.join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Import result */}
        {result && (
          <div className="mt-4 rounded-xl border border-surface-200 dark:border-night-600 p-3 text-sm">
            <p className="font-semibold text-surface-900 dark:text-night-50">
              Imported {result.success}, failed {result.failed}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-danger-600 list-disc pl-4">
                {result.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={() => { reset(); onClose() }} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium">Close</button>
        </div>
      </div>
    </div>
  )
}
