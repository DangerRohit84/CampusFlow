import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { adminAPI } from '../lib/api'
import { notifyEntityMutated } from '../lib/entitySync'
import { isValidEmail } from '../lib/validation'
import { useDepartments } from '../hooks/useDepartments'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UserPlus, Upload, Download, Loader2, CheckCircle, X, FileText
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { generateSecurePassword, isCommonPasswordLocal, checkPasswordBreachHook } from '../lib/password'

export default function AddStudentPage() {
  const { user } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'form' | 'csv'>('form')
  const [loading, setLoading] = useState(false)
  // C3 fix: never default to password123 — per-user random 16-char + show-once.
  // Backend generates its own tempPassword when password omitted; frontend sends
  // the generated value explicitly so admin can share it once. Users must change
  // on first login (see change-password + HIBP gate server-side).
  const [defaultPassword, setDefaultPassword] = useState(() => generateSecurePassword(16))
  // PERPAGE-MISSED: shared cached departments (was an uncached
  // departmentAPI.getAll() mount GET, duplicated across admin pages with zero
  // cross-page dedupe). Same array data via the shared 10-min RQ key
  // (Forms/Hackathons precedent); warm navs = 0 GETs.
  const { data: departmentsData } = useDepartments()
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : []
  const [student, setStudent] = useState({
    name: '', email: '', studentId: '', departmentId: '', incomingYear: ''
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvResults, setCsvResults] = useState<any>(null)

  // TOPBOTTOM F9a: students must never see the admin enrol form (nav hides it,
  // but direct URL /admin/add-students rendered it; backend 403s on submit).
  // Show a 403 with guidance instead of a broken form.
  if (user?.role === 'STUDENT') {
    return (
      <div className="max-w-[1280px] mx-auto">
        <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 p-8 text-center" role="alert">
          <h1 className="text-xl font-bold text-surface-900 dark:text-night-50">Not available for students</h1>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-2">Only college admins and teachers can enrol students. Ask your registrar for access.</p>
          <Link to="/dashboard" className="mt-5 inline-flex px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold">Back to dashboard</Link>
        </div>
      </div>
    )
  }

  // Departments now come from the shared useDepartments() hook above —
  // the old uncached mount useEffect was removed (PERPAGE-MISSED).

  const handleAddStudent = async () => {
    const fe: Record<string, string> = {}
    if (!student.name.trim()) fe.name = 'Name is required.'
    if (!student.email.trim()) fe.email = 'Email is required.'
    else if (!isValidEmail(student.email)) fe.email = 'Enter a valid email.'
    if (!student.studentId.trim()) fe.studentId = 'Roll number is required.'
    if (!student.departmentId) fe.departmentId = 'Select a department.'
    if (!student.incomingYear) fe.incomingYear = 'Select a batch year.'
    setFieldErrors(fe)
    if (Object.keys(fe).length) {
      toast.error(Object.values(fe)[0])
      return
    }
    if (isCommonPasswordLocal(defaultPassword)) {
      toast.error('Default password is too common — click Regenerate')
      return
    }
    setLoading(true)
    try {
      const breach = await checkPasswordBreachHook(defaultPassword).catch(() => ({ breached: false, offline: true as const }))
      if (breach.breached) {
        toast.error('Generated password appears in a breach — click Regenerate')
        setLoading(false)
        return
      }
      await adminAPI.addStudent({
        ...student,
        incomingYear: parseInt(student.incomingYear as string),
        password: defaultPassword
      })
      toast.success('Student added! Share the password once — they must change it on first login.')
      setStudent({ name: '', email: '', studentId: '', departmentId: '', incomingYear: '' })
      setFieldErrors({})
      notifyEntityMutated('user', { action: 'student-added' })
      // Rotate so each student gets a unique password (never reuse password123)
      setDefaultPassword(generateSecurePassword(16))
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add student')
    } finally {
      setLoading(false)
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFile) {
      toast.error('Please select a CSV file')
      return
    }
    if (!defaultPassword) {
      toast.error('Please set a default password')
      return
    }

    setLoading(true)
    try {
      const text = await csvFile.text()
      const lines = text.split('\n').filter(l => l.trim())
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())

      const nameIdx = headers.findIndex(h => h === 'name')
      const emailIdx = headers.findIndex(h => h === 'email')
      const rollIdx = headers.findIndex(h => h === 'roll number' || h === 'rollnumber' || h === 'roll_number' || h === 'studentid' || h === 'student id')
      const deptIdx = headers.findIndex(h => h === 'department')
      const yearIdx = headers.findIndex(h => h === 'incoming year' || h === 'incomingyear' || h === 'incoming_year' || h === 'year')

      if (nameIdx === -1 || emailIdx === -1 || rollIdx === -1 || deptIdx === -1 || yearIdx === -1) {
        toast.error('CSV must have columns: Name, Email, Roll Number, Department, Incoming Year')
        setLoading(false)
        return
      }

      const students = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim())
        const deptName = cols[deptIdx]
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        return {
          name: cols[nameIdx],
          email: cols[emailIdx],
          studentId: cols[rollIdx],
          departmentId: dept?.id || '',
          // Raw name so the backend can resolve case-insensitively / fail loudly
          // on typos instead of silently creating a dept-less student.
          department: deptName,
          incomingYear: parseInt(cols[yearIdx]) || 2024,
          password: defaultPassword
        }
      }).filter(s => s.name && s.email)

      const results = await adminAPI.bulkAddStudents(students)
      setCsvResults(results)
      toast.success(`${results.success} students added, ${results.failed} failed`)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to upload CSV')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = () => {
    const csv = `Name,Email,Roll Number,Department,Incoming Year\nJohn Doe,john@college.edu,CS2023001,${departments[0]?.name || 'Computer Science'},2024\nJane Smith,jane@college.edu,CS2023002,${departments[1]?.name || 'Mathematics'},2023`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'student_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<UserPlus size={18} />}
        eyebrow="Admin · Students"
        title={<>Add Students</>}
        subtitle="Bulk enroll students — fast, validated and department-scoped."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">Add Students</h1>
          <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Add students to your college</p>
        </div>
      </div>

      {/* College Name */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
        <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">College</label>
        <input type="text" value={user?.college?.name || ''} disabled
          className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-surface-50 dark:bg-night-800 text-surface-500 dark:text-night-400" />
      </div>

      {/* Default Password */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
        <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Temporary Password (auto-generated, show once)</label>
        <div className="flex gap-2">
          <input type="text" value={defaultPassword} onChange={(e) => setDefaultPassword(e.target.value)}
            className="flex-1 px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
            placeholder="Auto-generated secure password" autoComplete="new-password" />
          <button type="button" onClick={() => setDefaultPassword(generateSecurePassword(16))}
            className="px-3 py-2 rounded-xl border border-surface-200 text-xs font-semibold hover:bg-surface-50">Regenerate</button>
        </div>
        <p className="text-xs text-surface-400 dark:text-night-400 mt-1">Unique per student — share once over a secure channel. They must change it on first login (min 8, HIBP-checked server-side).</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-100 dark:border-night-600 pb-2">
        <button onClick={() => setActiveTab('form')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === 'form' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}>
          <UserPlus size={16} className="inline mr-2" /> Add Manually
        </button>
        <button onClick={() => setActiveTab('csv')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === 'csv' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}>
          <Upload size={16} className="inline mr-2" /> Upload CSV
        </button>
      </div>

      {/* Manual Form */}
      {activeTab === 'form' && (
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Roll Number *</label>
              <input type="text" value={student.studentId} onChange={(e) => setStudent({ ...student, studentId: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="e.g., CS2023001" />
              {fieldErrors.studentId && <p className="mt-1 text-xs text-danger-600">{fieldErrors.studentId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Name *</label>
              <input type="text" value={student.name} onChange={(e) => setStudent({ ...student, name: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="Full name" />
              {fieldErrors.name && <p className="mt-1 text-xs text-danger-600">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Email *</label>
              <input type="email" value={student.email} onChange={(e) => setStudent({ ...student, email: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="email@college.edu" />
              {fieldErrors.email && <p className="mt-1 text-xs text-danger-600">{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Department *</label>
              <select value={student.departmentId} onChange={(e) => setStudent({ ...student, departmentId: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
                <option value="">Select department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {fieldErrors.departmentId && <p className="mt-1 text-xs text-danger-600">{fieldErrors.departmentId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Incoming Year *</label>
              <select value={student.incomingYear} onChange={(e) => setStudent({ ...student, incomingYear: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
                <option value="">Select batch year</option>
                {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {fieldErrors.incomingYear && <p className="mt-1 text-xs text-danger-600">{fieldErrors.incomingYear}</p>}
              <p className="text-xs text-surface-400 dark:text-night-400 mt-1">Year the student joined. Outgoing year = incoming + 4.</p>
            </div>
          </div>
          <button onClick={handleAddStudent} disabled={loading}
            className="mt-5 w-full px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={16} />}
            {loading ? 'Adding...' : 'Add Student'}
          </button>
        </div>
      )}

      {/* CSV Upload */}
      {activeTab === 'csv' && (
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-surface-900 dark:text-night-50">Upload CSV File</h3>
                <p className="text-xs text-surface-500 dark:text-night-400 mt-1">CSV columns: Name, Email, Roll Number, Department, Incoming Year</p>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg">
                <Download size={14} /> Template
              </button>
            </div>

            <div className="border-2 border-dashed border-surface-200 dark:border-night-600 rounded-xl p-8 text-center hover:border-primary-300 transition-colors">
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)} />
              <FileText size={32} className="mx-auto text-surface-400 dark:text-night-400 mb-3" />
              {csvFile ? (
                <div>
                  <p className="text-sm font-medium text-surface-900 dark:text-night-50">{csvFile.name}</p>
                  <button onClick={() => setCsvFile(null)} className="text-xs text-danger-500 mt-1 flex items-center gap-1 mx-auto">
                    <X size={12} /> Remove
                  </button>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-medium text-primary-600 hover:text-primary-700">
                  Click to select CSV file
                </button>
              )}
            </div>

            <button onClick={handleCsvUpload} disabled={loading || !csvFile}
              className="w-full px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={16} />}
              {loading ? 'Uploading...' : 'Upload & Add Students'}
            </button>

            {/* Results */}
            <AnimatePresence>
              {csvResults && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-surface-50 dark:bg-night-800 rounded-xl">
                  <div className="flex items-center gap-3 mb-2">
                    <CheckCircle size={16} className="text-primary-500" />
                    <span className="text-sm font-medium text-surface-900 dark:text-night-50">
                      {csvResults.success} added, {csvResults.failed} failed
                    </span>
                  </div>
                  {csvResults.errors?.length > 0 && (
                    <div className="mt-2 text-xs text-danger-600 space-y-1">
                      {csvResults.errors.map((err: string, i: number) => (
                        <p key={i}>{err}</p>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}
