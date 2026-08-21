import { useState, useRef, useCallback } from 'react'
import { Upload, FileImage, Loader2, CheckCircle, AlertCircle, Trash2, Eye } from 'lucide-react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { attendanceAPI } from '../../lib/api'

interface AttendanceRecord {
  subject: string
  totalClasses: number
  attendedClasses: number
  percentage: number
}

export default function UploadTab() {
  const [image, setImage] = useState<string | null>(null)
  const [rawText, setRawText] = useState('')
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file')
      return
    }

    setError('')
    setSuccess('')
    setRecords([])
    setRawText('')
    setLoading(true)

    const reader = new FileReader()
    reader.onload = (e) => setImage(e.target?.result as string)
    reader.readAsDataURL(file)

    try {
      const Tesseract = await import('tesseract.js')
      const result = await Tesseract.recognize(file, 'eng')
      const text = result.data.text
      setRawText(text)

      if (!text.trim()) {
        setError('No text detected in the image. Please upload a clearer image.')
        setLoading(false)
        return
      }

      setParsing(true)
      const parsed = await attendanceAPI.parse(text)
      if (parsed?.records?.length) {
        setRecords(parsed.records)
      } else {
        setError('Could not parse attendance data from the image. Please try a different image.')
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to process the image')
    } finally {
      setLoading(false)
      setParsing(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleSave = async () => {
    if (!records.length) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await attendanceAPI.save(records, 'ocr-upload')
      setSuccess('Attendance records saved successfully!')
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save records')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    setImage(null)
    setRawText('')
    setRecords([])
    setError('')
    setSuccess('')
  }

  return (
    <div className="space-y-6">
      <Card>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-surface-200 dark:border-[#202C35] rounded-xl p-12 text-center cursor-pointer hover:border-primary-400 dark:hover:border-primary-500 transition-colors bg-surface-50 dark:bg-[#111920]"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
              <p className="text-sm text-surface-600 dark:text-[#A6B3BE]">
                {parsing ? 'Parsing attendance data...' : 'Extracting text from image...'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <Upload className="w-7 h-7 text-primary-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-surface-900 dark:text-[#F4F7F8]">
                  Drop your attendance image here or click to browse
                </p>
                <p className="text-xs text-surface-400 dark:text-[#A6B3BE] mt-1">
                  Supports PNG, JPG, JPEG — OCR will extract text automatically
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800">
          <AlertCircle className="w-4 h-4 text-danger-500 shrink-0" />
          <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
          <CheckCircle className="w-4 h-4 text-primary-500 shrink-0" />
          <p className="text-sm text-primary-600 dark:text-primary-400">{success}</p>
        </div>
      )}

      {image && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileImage className="w-5 h-5 text-surface-500 dark:text-[#A6B3BE]" />
              <h3 className="text-sm font-semibold text-surface-900 dark:text-[#F4F7F8]">Uploaded Image</h3>
            </div>
            <button
              onClick={handleClear}
              className="p-1.5 rounded-lg text-surface-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="relative rounded-xl overflow-hidden border border-surface-100 dark:border-[#202C35]">
            <img src={image} alt="Uploaded attendance" className="w-full max-h-64 object-contain bg-surface-50 dark:bg-[#111920]" />
          </div>
          {rawText && (
            <details className="mt-4">
              <summary className="text-xs font-medium text-surface-500 dark:text-[#A6B3BE] cursor-pointer hover:text-surface-700 dark:hover:text-[#F4F7F8] transition-colors flex items-center gap-1">
                <Eye size={14} />
                View extracted text
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-surface-50 dark:bg-[#111920] text-xs text-surface-600 dark:text-[#A6B3BE] overflow-x-auto whitespace-pre-wrap border border-surface-100 dark:border-[#202C35]">
                {rawText}
              </pre>
            </details>
          )}
        </Card>
      )}

      {records.length > 0 && (
        <Card padding="none">
          <div className="p-6 pb-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-surface-900 dark:text-[#F4F7F8]">Parsed Attendance Data</h3>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                onClick={handleSave}
                icon={<CheckCircle size={16} />}
              >
                Save Records
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-b border-surface-100 dark:border-[#202C35] bg-surface-50 dark:bg-[#111920]">
                  <th className="text-left px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Subject</th>
                  <th className="text-center px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Total</th>
                  <th className="text-center px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Attended</th>
                  <th className="text-center px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Percentage</th>
                  <th className="text-center px-6 py-3 font-semibold text-surface-600 dark:text-[#A6B3BE]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-[#202C35]">
                {records.map((r, i) => (
                  <tr key={i} className="hover:bg-surface-50 dark:hover:bg-[#202C35] transition-colors">
                    <td className="px-6 py-3 font-medium text-surface-900 dark:text-[#F4F7F8]">{r.subject}</td>
                    <td className="px-6 py-3 text-center text-surface-600 dark:text-[#A6B3BE]">{r.totalClasses}</td>
                    <td className="px-6 py-3 text-center text-surface-600 dark:text-[#A6B3BE]">{r.attendedClasses}</td>
                    <td className="px-6 py-3 text-center font-semibold text-surface-900 dark:text-[#F4F7F8]">{r.percentage}%</td>
                    <td className="px-6 py-3 text-center">
                      <Badge variant={r.percentage >= 80 ? 'success' : r.percentage >= 60 ? 'warning' : 'danger'}>
                        {r.percentage >= 80 ? 'Good' : r.percentage >= 60 ? 'At Risk' : 'Critical'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
