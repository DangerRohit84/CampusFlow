import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Upload, CheckCircle, AlertCircle, Loader2,
  X, FileImage, Save, Target
} from 'lucide-react'
import toast from 'react-hot-toast'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { attendanceAPI } from '../lib/api'

interface Subject {
  id: string
  name: string
  held: number
  attended: number
  skip: number
}

function calcPct(attended: number, held: number) {
  return held > 0 ? Math.round((attended / held) * 1000) / 10 : 0
}

function calcStatus(pct: number, required: number) {
  if (pct >= required + 5) return 'safe'
  if (pct >= required) return 'safe'
  if (pct >= required - 5) return 'warning'
  return 'risk'
}

function calcCanSkip(attended: number, held: number, required: number) {
  const num = attended - (required / 100) * held
  const den = 1 - required / 100
  return den > 0 ? Math.max(0, Math.floor(num / den)) : 0
}

function calcNeedClasses(attended: number, held: number, required: number) {
  const num = (required / 100) * held - attended
  const den = 1 - required / 100
  return den > 0 ? Math.max(0, Math.ceil(num / den)) : 0
}

const statusConfig = {
  safe: { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40', bar: 'bg-emerald-500', label: 'SAFE' },
  warning: { color: 'text-amber-800 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40', bar: 'bg-amber-500', label: 'WARNING' },
  risk: { color: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/40', bar: 'bg-rose-500', label: 'RISK' },
}

export default function AttendancePage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [requiredPct, setRequiredPct] = useState(75)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadImage, setUploadImage] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsedResults, setParsedResults] = useState<any[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    attendanceAPI.getData()
      .then((data) => {
        setSubjects(data.subjects?.map((s: any, i: number) => ({
          id: s.id || `s-${i}`,
          name: s.name || '',
          held: s.held || 0,
          attended: s.attended || 0,
          skip: 0,
        })) || [])
        if (data.requiredPct) setRequiredPct(data.requiredPct)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const updateSubject = (id: string, field: keyof Subject, value: any) => {
    setSubjects(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  const addSubject = () => {
    setSubjects(prev => [...prev, {
      id: `s-${Date.now()}`,
      name: '',
      held: 0,
      attended: 0,
      skip: 0,
    }])
  }

  const deleteSubject = (id: string) => {
    setSubjects(prev => prev.filter(s => s.id !== id))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = subjects.map(({ skip, ...rest }) => rest)
      await attendanceAPI.saveData(payload, requiredPct)
      toast.success('Attendance saved!')
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }
    setParsedResults([])
    setShowUpload(true)
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target?.result as string
      setUploadImage(base64)
      try {
        setParsing(true)
        const parsed = await attendanceAPI.parse(base64)
        if (parsed?.subjects?.length) {
          setParsedResults(parsed.subjects)
        } else {
          toast.error('Could not parse attendance from image')
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Failed to parse image')
      } finally {
        setParsing(false)
      }
    }
    reader.readAsDataURL(file)
  }, [])

  const handleImport = async () => {
    const imported = parsedResults.map((s: any, i: number) => ({
      id: `imported-${Date.now()}-${i}`,
      name: s.name || '',
      held: s.held || s.total || 0,
      attended: s.attended || s.present || 0,
      skip: 0,
    }))
    setSubjects(imported)
    setShowUpload(false)
    setUploadImage(null)
    setParsedResults([])
    try {
      const payload = imported.map(({ skip, ...rest }) => rest)
      await attendanceAPI.saveData(payload, requiredPct)
      toast.success('Attendance imported & saved!')
    } catch {
      toast.error('Imported but failed to save')
    }
  }

  const totalHeld = subjects.reduce((sum, s) => sum + s.held, 0)
  const totalAttended = subjects.reduce((sum, s) => sum + s.attended, 0)
  const totalSkipped = subjects.reduce((sum, s) => sum + s.skip, 0)
  const overallPct = totalHeld + totalSkipped > 0
    ? Math.round((totalAttended / (totalHeld + totalSkipped)) * 1000) / 10
    : 0
  const overallStatus = calcStatus(overallPct, requiredPct)
  const overallCanSkip = calcCanSkip(totalAttended, totalHeld, requiredPct) - totalSkipped
  const overallNeedClasses = overallCanSkip < 0 ? calcNeedClasses(totalAttended, totalHeld + totalSkipped, requiredPct) : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-night-950/80 backdrop-blur-md border-b border-surface-200 dark:border-night-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">Attendance</h1>
            <p className="text-surface-500 dark:text-night-200 mt-1">Track your class attendance</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-surface-600 dark:text-night-200">Required:</label>
            <div className="flex items-center rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 overflow-hidden">
              <button
                onClick={() => setRequiredPct(prev => Math.max(1, prev - 1))}
                className="px-2.5 py-1.5 text-sm font-bold text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-600 transition-colors"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={100}
                value={requiredPct}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!isNaN(v) && v >= 1 && v <= 100) setRequiredPct(v)
                }}
                onBlur={(e) => {
                  const v = Number(e.target.value)
                  if (isNaN(v) || v < 1) setRequiredPct(1)
                  if (v > 100) setRequiredPct(100)
                }}
                className="w-12 px-1 py-1.5 text-sm font-bold text-center bg-transparent border-x border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => setRequiredPct(prev => Math.min(100, prev + 1))}
                className="px-2.5 py-1.5 text-sm font-bold text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-600 transition-colors"
              >
                +
              </button>
            </div>
            <span className="text-sm text-surface-500 dark:text-night-200">%</span>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-200 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors ml-2"
            >
              <Upload size={14} /> Upload
            </button>
            <button
              onClick={addSubject}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              <Plus size={14} /> Add
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Overall Summary Card */}
        <Card className="relative overflow-hidden mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-medium text-surface-500 dark:text-night-200">Overall</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-bold text-surface-900 dark:text-night-50">{overallPct}%</span>
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${statusConfig[overallStatus].bg} ${statusConfig[overallStatus].color}`}>
                  {statusConfig[overallStatus].label}
                </span>
                <span className="text-sm text-surface-500 dark:text-night-200">
                  {overallStatus === 'safe'
                    ? `Can skip ${Math.max(0, overallCanSkip)} more`
                    : `Need ${overallNeedClasses} classes`}
                </span>
              </div>
              <p className="text-sm text-surface-500 dark:text-night-200 mt-1">
                {totalAttended} / {totalHeld} classes
              </p>
              {totalSkipped > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {subjects.filter(s => s.skip > 0).map(s => (
                    <span key={s.id} className="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-100 dark:bg-warning-300/10 text-warning-600 dark:text-warning-300">
                      {s.name || 'Untitled'}: ⚠️ {s.skip}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="h-3 bg-surface-100 dark:bg-night-600 rounded-full overflow-hidden mb-3">
            <motion.div
              animate={{ width: `${Math.min(overallPct, 100)}%` }}
              transition={{ duration: 0.4 }}
              className={`h-full rounded-full ${statusConfig[overallStatus].bar}`}
            />
          </div>
        </Card>

        {/* Subject Cards  —  2-column grid */}
        {subjects.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <Target className="w-10 h-10 text-surface-300 dark:text-night-200 mx-auto mb-3" />
              <p className="text-surface-500 dark:text-night-200">No subjects yet. Add one or upload an image.</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence>
              {subjects.map((subject) => {
                const pct = calcPct(subject.attended, subject.held)
                const status = calcStatus(pct, requiredPct)
                const canSkip = calcCanSkip(subject.attended, subject.held, requiredPct)
                const needClasses = calcNeedClasses(subject.attended, subject.held, requiredPct)
                const displayPct = subject.skip > 0
                  ? Math.round((subject.attended / (subject.held + subject.skip)) * 1000) / 10
                  : pct
                const displayStatus = subject.skip > 0 ? calcStatus(displayPct, requiredPct) : status

                return (
                  <motion.div
                    key={subject.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="h-full"
                  >
                    <Card className="relative h-full">
                      <div className="flex items-start gap-2 mb-3">
                        <input
                          type="text"
                          value={subject.name}
                          onChange={(e) => updateSubject(subject.id, 'name', e.target.value)}
                          placeholder="Subject name"
                          className="flex-1 min-w-0 text-lg font-bold text-surface-900 dark:text-night-50 bg-transparent border-none focus:outline-none focus:ring-0 p-0 placeholder:text-surface-400 dark:placeholder:text-night-200"
                        />
                        <button
                          onClick={() => deleteSubject(subject.id)}
                          className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-300/10 transition-colors shrink-0"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-surface-500 dark:text-night-200">Held</label>
                          <input
                            type="number"
                            min={0}
                            value={subject.held}
                            onChange={(e) => updateSubject(subject.id, 'held', Math.max(0, Number(e.target.value)))}
                            className="w-16 px-2 py-1 text-sm font-bold text-center rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-surface-500 dark:text-night-200">Attended</label>
                          <input
                            type="number"
                            min={0}
                            max={subject.held}
                            value={subject.attended}
                            onChange={(e) => updateSubject(subject.id, 'attended', Math.min(subject.held, Math.max(0, Number(e.target.value))))}
                            className="w-16 px-2 py-1 text-sm font-bold text-center rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                      </div>

                      <div className="h-2.5 bg-surface-100 dark:bg-night-600 rounded-full overflow-hidden mb-2">
                        <motion.div
                          animate={{ width: `${Math.min(displayPct, 100)}%` }}
                          transition={{ duration: 0.4 }}
                          className={`h-full rounded-full ${statusConfig[displayStatus].bar}`}
                        />
                      </div>

                      <div className="flex items-center justify-between text-sm mb-3">
                        <span className={`font-bold ${statusConfig[displayStatus].color}`}>
                          {displayPct}% {statusConfig[displayStatus].label}
                        </span>
                        <span className="text-surface-500 dark:text-night-200">
                          {displayStatus === 'safe'
                            ? `Can skip ${Math.max(0, canSkip - subject.skip)} more`
                            : `Need ${needClasses} classes`}
                        </span>
                      </div>

                      {/* Skip slider */}
                      <div className="p-3 rounded-lg bg-surface-50 dark:bg-night-900 border border-surface-100 dark:border-night-600">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-medium text-surface-500 dark:text-night-200">Skip classes</label>
                          <span className="text-xs font-bold text-surface-700 dark:text-night-50">{subject.skip}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(canSkip + 5, subject.skip, 10)}
                          value={subject.skip}
                          onChange={(e) => updateSubject(subject.id, 'skip', Number(e.target.value))}
                          className="w-full h-2 bg-surface-200 dark:bg-night-600 rounded-full appearance-none cursor-pointer accent-primary-500"
                        />
                      </div>
                    </Card>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Bottom spacer so content isn't hidden behind the fixed save bar */}
        {subjects.length > 0 && <div className="h-16" />}
      </div>

      {/* Fixed Bottom Save Bar */}
      {subjects.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-white dark:bg-night-950/80 backdrop-blur-md border-t border-surface-200 dark:border-night-600 px-6 py-3">
          <div className="flex justify-center">
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSave}
              icon={<Save size={16} />}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => { setShowUpload(false); setUploadImage(null); setParsedResults([]) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl border border-surface-200 dark:border-night-600 shadow-xl w-full max-w-lg p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-surface-900 dark:text-night-50">Upload Attendance Image</h2>
                <button
                  onClick={() => { setShowUpload(false); setUploadImage(null); setParsedResults([]) }}
                  className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-600"
                >
                  <X size={18} />
                </button>
              </div>

              {!uploadImage ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-surface-200 dark:border-night-600 rounded-xl p-8 text-center cursor-pointer hover:border-primary-400 transition-colors"
                >
                  <Upload className="w-8 h-8 text-surface-400 dark:text-night-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-surface-600 dark:text-night-200">Click to choose image</p>
                  <p className="text-xs text-surface-400 dark:text-night-200 mt-1">PNG, JPG, JPEG</p>
                </div>
              ) : parsing ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                  <p className="text-sm text-surface-600 dark:text-night-200">AI is reading your image...</p>
                </div>
              ) : parsedResults.length > 0 ? (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-surface-100 dark:border-night-600">
                    <img src={uploadImage} alt="Preview" className="w-full max-h-40 object-contain bg-surface-50 dark:bg-night-900" />
                  </div>
                  <p className="text-sm font-medium text-surface-700 dark:text-night-50">Parsed {parsedResults.length} subjects:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {parsedResults.map((s: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 px-2 rounded-lg bg-surface-50 dark:bg-night-900">
                        <span className="text-surface-700 dark:text-night-50">{s.name}</span>
                        <span className="text-surface-500 dark:text-night-200">{s.attended || s.present}/{s.held || s.total}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={handleImport} icon={<CheckCircle size={16} />}>
                      Import
                    </Button>
                    <Button variant="secondary" onClick={() => { setUploadImage(null); setParsedResults([]) }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden border border-surface-100 dark:border-night-600">
                    <img src={uploadImage} alt="Preview" className="w-full max-h-40 object-contain bg-surface-50 dark:bg-night-900" />
                  </div>
                  <Button variant="secondary" onClick={() => { setUploadImage(null); setParsedResults([]) }}>
                    Choose different image
                  </Button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
