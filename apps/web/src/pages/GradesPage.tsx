import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Upload, CheckCircle, Loader2,
  X, Save, Award
} from 'lucide-react'
import toast from 'react-hot-toast'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import CenteredLoader from '../components/ui/CenteredLoader'
import { gradesAPI } from '../lib/api'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'

interface Course {
  id: string
  name: string
  code: string
  credits: number
  grade: string
  semester: number
}

const GRADES = ['O', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'P', 'F'] as const

const gradeToGpa10: Record<string, number> = {
  'O': 10, 'A+': 9, 'A': 8, 'A-': 7.5,
  'B+': 7, 'B': 6, 'B-': 5.5,
  'C+': 5, 'C': 4, 'C-': 3.5,
  'D': 4, 'P': 4, 'F': 0,
}

const gradeToGpa4: Record<string, number> = {
  'O': 4.0, 'A+': 4.0, 'A': 3.5, 'A-': 3.3,
  'B+': 3.0, 'B': 2.7, 'B-': 2.3,
  'C+': 2.0, 'C': 1.7, 'C-': 1.3,
  'D': 1.0, 'P': 1.0, 'F': 0,
}

function gradeToGpa(grade: string, scale: string): number {
  return scale === '10' ? (gradeToGpa10[grade] ?? 0) : (gradeToGpa4[grade] ?? 0)
}

function gradeColor(grade: string): string {
  const g = gradeToGpa10[grade] ?? 0
  if (g >= 9) return 'bg-primary-100 dark:bg-success-300/10 text-primary-600 dark:text-success-300'
  if (g >= 7) return 'bg-primary-100 dark:bg-success-300/10 text-primary-600 dark:text-success-300'
  if (g >= 5) return 'bg-warning-100 dark:bg-warning-300/10 text-warning-600 dark:text-warning-300'
  if (g >= 3) return 'bg-warning-100 dark:bg-warning-300/10 text-warning-600 dark:text-warning-300'
  return 'bg-danger-100 dark:bg-danger-300/10 text-danger-600 dark:text-danger-300'
}

function gpaBarColor(gpa: number, maxScale: number): string {
  const ratio = gpa / maxScale
  if (ratio >= 0.7) return 'bg-primary-500'
  if (ratio >= 0.5) return 'bg-warning-500'
  return 'bg-danger-500'
}

export default function GradesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [scale, setScale] = useState<string>('10')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadImage, setUploadImage] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsedResults, setParsedResults] = useState<any[]>([])
  const [activeSemester, setActiveSemester] = useState<string>('all')
  const [offlineOcrLoading, setOfflineOcrLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Offline OCR fallback — tesseract.js on demand (see AttendancePage).
  const handleOfflineOcr = async () => {
    if (!uploadImage || offlineOcrLoading) return
    setOfflineOcrLoading(true)
    try {
      const { offlineOcrFallback } = await import('../lib/heavyLazy')
      const text = await offlineOcrFallback(uploadImage)
      const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20)
      if (!lines.length) toast.error('Offline OCR found no text — try a clearer photo')
      else toast.success(`Offline OCR captured ${lines.length} lines (see console)`)
      // eslint-disable-next-line no-console
      console.debug('[grades][offline-ocr]', lines)
    } catch {
      toast.error('Offline OCR unavailable — check connection and retry')
    } finally {
      setOfflineOcrLoading(false)
    }
  }

  // STATE-SYNC: single loader for mount + external mutations (no stale copy).
  const loadGrades = useCallback(async () => {
    try {
      const data = await gradesAPI.getData()
      setCourses(data.subjects?.map((s: any, i: number) => ({
        id: s.id || `c-${i}`,
        name: s.name || '',
        code: s.code || '',
        credits: s.credits || 0,
        grade: s.grade || '',
        semester: s.semester || 1,
      })) || [])
      if (data.scale) setScale(data.scale)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEntitySync('grade', loadGrades)

  useEffect(() => {
    loadGrades()
  }, [loadGrades])

  const updateCourse = (id: string, field: keyof Course, value: any) => {
    setCourses(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  const addCourse = () => {
    setCourses(prev => [...prev, {
      id: `c-${Date.now()}`,
      name: '',
      code: '',
      credits: 0,
      grade: '',
      semester: activeSemester === 'all' ? 1 : Number(activeSemester),
    }])
  }

  const deleteCourse = (id: string) => {
    setCourses(prev => prev.filter(c => c.id !== id))
  }

  // Semester filtering
  const semesters = [...new Set(courses.map(c => c.semester))].sort((a, b) => a - b)
  const filteredCourses = activeSemester === 'all'
    ? courses
    : courses.filter(c => c.semester === Number(activeSemester))

  // Computed values
  const maxScale = scale === '10' ? 10 : 4
  const coursesWithGpa = filteredCourses.map(c => ({
    ...c,
    gpa: c.grade ? gradeToGpa(c.grade, scale) : 0,
  }))
  const totalCredits = coursesWithGpa.reduce((sum, c) => sum + c.credits, 0)
  const cgpa = totalCredits > 0
    ? coursesWithGpa.reduce((sum, c) => sum + c.gpa * c.credits, 0) / totalCredits
    : 0
  const cgpaDisplay = cgpa.toFixed(2)

  // Overall stats (all semesters)
  const overallCredits = courses.reduce((sum, c) => sum + c.credits, 0)
  const overallCgpa = overallCredits > 0
    ? courses.reduce((sum, c) => sum + (c.grade ? gradeToGpa(c.grade, scale) : 0) * c.credits, 0) / overallCredits
    : 0

  const gradeDistribution: Record<string, number> = {}
  filteredCourses.forEach(c => {
    if (c.grade) {
      gradeDistribution[c.grade] = (gradeDistribution[c.grade] || 0) + 1
    }
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await gradesAPI.saveData(courses, scale)
      notifyEntityMutated('grade', { action: 'saved' })
      toast.success('Grades saved!')
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
        const parsed = await gradesAPI.parse(base64)
        if (parsed?.subjects?.length) {
          setParsedResults(parsed.subjects)
        } else {
          toast.error('Could not parse grades from image')
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
    const sem = activeSemester === 'all' ? 1 : Number(activeSemester)
    const imported = parsedResults.map((s: any, i: number) => ({
      id: `imported-${Date.now()}-${i}`,
      name: s.name || '',
      code: s.code || '',
      credits: s.credits || 0,
      grade: s.grade || '',
      semester: sem,
    }))
    const updated = [...courses.filter(c => c.semester !== sem), ...imported]
    setCourses(updated)
    setShowUpload(false)
    setUploadImage(null)
    setParsedResults([])
    try {
      await gradesAPI.saveData(updated, scale)
      toast.success('Grades imported & saved!')
    } catch {
      toast.error('Imported but failed to save')
    }
  }

  if (loading) {
    return <CenteredLoader text="Loading grades..." />
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-night-950/80 backdrop-blur-md border-b border-surface-200 dark:border-night-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">Grades</h1>
            <p className="text-surface-500 dark:text-night-200 mt-1">Calculate your CGPA</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Scale Toggle */}
            <div className="flex items-center rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 overflow-hidden">
              <button
                onClick={() => setScale('10')}
                className={`px-2.5 py-1.5 text-sm font-bold transition-colors ${
                  scale === '10'
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-600'
                }`}
              >
                10
              </button>
              <button
                onClick={() => setScale('4')}
                className={`px-2.5 py-1.5 text-sm font-bold transition-colors ${
                  scale === '4'
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-600 dark:text-night-200 hover:bg-surface-100 dark:hover:bg-night-600'
                }`}
              >
                4
              </button>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-200 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors"
            >
              <Upload size={14} /> Upload
            </button>
            <button
              onClick={addCourse}
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

        {/* Semester Tabs */}
        <div className="flex items-center gap-1.5 mt-3 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveSemester('all')}
            className={`px-3 py-1 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${
              activeSemester === 'all'
                ? 'bg-primary-500 text-white'
                : 'bg-surface-100 dark:bg-night-600 text-surface-600 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-700'
            }`}
          >
            All
          </button>
          {semesters.map((sem) => (
            <button
              key={sem}
              onClick={() => setActiveSemester(String(sem))}
              className={`px-3 py-1 text-xs font-bold rounded-full transition-colors whitespace-nowrap ${
                activeSemester === String(sem)
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-100 dark:bg-night-600 text-surface-600 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-700'
              }`}
            >
              Sem {sem}
            </button>
          ))}
          <button
            onClick={() => {
              const nextSem = semesters.length > 0 ? Math.max(...semesters) + 1 : 1
              setActiveSemester(String(nextSem))
            }}
            className="px-2 py-1 text-xs font-bold rounded-full bg-surface-100 dark:bg-night-600 text-surface-500 dark:text-night-200 hover:bg-surface-200 dark:hover:bg-night-700 transition-colors"
          >
            + New
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* CGPA Summary Card */}
        <Card className="relative overflow-hidden mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-medium text-surface-500 dark:text-night-200">
                {activeSemester === 'all' ? 'Overall CGPA' : `Sem ${activeSemester} CGPA`}
              </p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-bold text-surface-900 dark:text-night-50">{cgpaDisplay}</span>
                <span className="text-sm text-surface-500 dark:text-night-200">/ {maxScale}.00</span>
              </div>
              <p className="text-sm text-surface-500 dark:text-night-200 mt-1">
                {totalCredits} credits &middot; {filteredCourses.length} course{filteredCourses.length !== 1 ? 's' : ''}
              </p>
              {activeSemester !== 'all' && overallCredits > 0 && (
                <p className="text-xs text-surface-400 dark:text-night-200 mt-1">
                  Overall: {overallCgpa.toFixed(2)} / {maxScale}.00 ({overallCredits} credits)
                </p>
              )}
            </div>
            <div className="w-12 h-12 rounded-xl bg-primary-600 flex items-center justify-center text-white shadow-lg">
              <Award size={22} />
            </div>
          </div>

          {/* GPA Bar */}
          <div className="h-3 bg-surface-100 dark:bg-night-600 rounded-full overflow-hidden mb-2">
            <motion.div
              animate={{ width: `${totalCredits > 0 ? (cgpa / maxScale) * 100 : 0}%` }}
              transition={{ duration: 0.4 }}
              className={`h-full rounded-full ${gpaBarColor(cgpa, maxScale)}`}
            />
          </div>

          {/* Grade Distribution */}
          {Object.keys(gradeDistribution).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {Object.entries(gradeDistribution)
                .sort(([a], [b]) => {
                  const order = GRADES.indexOf(a as any) - GRADES.indexOf(b as any)
                  return order
                })
                .map(([grade, count]) => (
                  <span
                    key={grade}
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${gradeColor(grade)}`}
                  >
                    {grade}: {count}
                  </span>
                ))}
            </div>
          )}
        </Card>

        {/* Course Cards  —  2-column grid */}
        {filteredCourses.length === 0 ? (
          <Card>
            <div className="text-center py-8">
              <Award className="w-10 h-10 text-surface-300 dark:text-night-200 mx-auto mb-3" />
              <p className="text-surface-500 dark:text-night-200">
                {courses.length > 0
                  ? 'No courses in this semester. Add one or switch to All.'
                  : 'No courses yet. Add one or upload an image.'}
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence>
              {coursesWithGpa.map((course) => {
                const barPct = course.grade ? (course.gpa / maxScale) * 100 : 0
                return (
                  <motion.div
                    key={course.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="h-full"
                  >
                    <Card className="relative h-full">
                      {/* Course name + delete */}
                      <div className="flex items-start gap-2 mb-3">
                        <input
                          type="text"
                          value={course.name}
                          onChange={(e) => updateCourse(course.id, 'name', e.target.value)}
                          placeholder="Course name"
                          className="flex-1 min-w-0 text-lg font-bold text-surface-900 dark:text-night-50 bg-transparent border-none focus:outline-none focus:ring-0 p-0 placeholder:text-[#6b7280] dark:placeholder:text-night-200"
                        />
                        <button
                          onClick={() => deleteCourse(course.id)}
                          className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-300/10 transition-colors shrink-0"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {/* Course code */}
                      <div className="flex items-center gap-2 mb-3">
                        <input
                          type="text"
                          value={course.code}
                          onChange={(e) => updateCourse(course.id, 'code', e.target.value)}
                          placeholder="Course code (optional)"
                          className="flex-1 min-w-0 text-sm text-surface-600 dark:text-night-200 bg-transparent border-none focus:outline-none focus:ring-0 p-0 placeholder:text-[#6b7280] dark:placeholder:text-night-200"
                        />
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-100 dark:bg-night-600 text-surface-500 dark:text-night-200 shrink-0">
                          Sem {course.semester}
                        </span>
                      </div>

                      {/* Credits + Grade */}
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-surface-500 dark:text-night-200">Credits</label>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={course.credits}
                            onChange={(e) => updateCourse(course.id, 'credits', Math.max(0, Number(e.target.value)))}
                            className="w-16 px-2 py-1 text-sm font-bold text-center rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-surface-500 dark:text-night-200">Grade</label>
                          <select
                            value={course.grade}
                            onChange={(e) => updateCourse(course.id, 'grade', e.target.value)}
                            className="px-2 py-1 text-sm font-bold rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="">--</option>
                            {GRADES.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-2.5 bg-surface-100 dark:bg-night-600 rounded-full overflow-hidden mb-2">
                        <motion.div
                          animate={{ width: `${barPct}%` }}
                          transition={{ duration: 0.4 }}
                          className={`h-full rounded-full ${course.grade ? gpaBarColor(course.gpa, maxScale) : 'bg-surface-200'}`}
                        />
                      </div>

                      {/* Computed GPA */}
                      <div className="flex items-center justify-between text-sm">
                        <span className={`font-bold ${course.grade ? 'text-surface-900 dark:text-night-50' : 'text-surface-400 dark:text-night-200'}`}>
                          {course.grade ? `GPA: ${course.gpa.toFixed(1)}` : 'No grade'}
                        </span>
                        <span className="text-surface-500 dark:text-night-200">
                          {course.credits > 0 ? `${course.credits} cr` : ''}
                        </span>
                      </div>
                    </Card>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Bottom spacer so content isn't hidden behind the fixed save bar */}
        {filteredCourses.length > 0 && <div className="h-16" />}
      </div>

      {/* Fixed Bottom Save Bar */}
      {filteredCourses.length > 0 && (
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
                <h2 className="text-lg font-bold text-surface-900 dark:text-night-50">Upload Grades Image</h2>
                <button
                  onClick={() => { setShowUpload(false); setUploadImage(null); setParsedResults([]) }}
                  className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:bg-surface-100 dark:hover:bg-night-600 dark:bg-[#1e1e1e]"
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
                    <img src={uploadImage} alt="Grades preview" loading="lazy" decoding="async" width={800} height={320} className="w-full max-h-40 object-contain bg-surface-50 dark:bg-night-900" />
                  </div>
                  <p className="text-sm font-medium text-surface-700 dark:text-night-50">Parsed {parsedResults.length} courses:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {parsedResults.map((s: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1 px-2 rounded-lg bg-surface-50 dark:bg-night-900">
                        <span className="text-surface-700 dark:text-night-50">{s.name}</span>
                        <span className="text-surface-500 dark:text-night-200">{s.grade} ({s.credits} cr)</span>
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
                    <img src={uploadImage} alt="Grades preview" loading="lazy" decoding="async" width={800} height={320} className="w-full max-h-40 object-contain bg-surface-50 dark:bg-night-900" />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => { setUploadImage(null); setParsedResults([]) }}>
                      Choose different image
                    </Button>
                    <Button variant="secondary" onClick={handleOfflineOcr} loading={offlineOcrLoading} disabled={offlineOcrLoading}>
                      {offlineOcrLoading ? 'Reading offline…' : 'Try offline OCR'}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
