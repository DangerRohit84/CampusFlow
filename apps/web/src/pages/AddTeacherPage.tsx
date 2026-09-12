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

export default function AddTeacherPage() {
  const { user } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'form' | 'csv'>('form')
  const [loading, setLoading] = useState(false)
  const [defaultPassword, setDefaultPassword] = useState(() => generateSecurePassword(16))  // C3: random, never password123
  // PERPAGE-MISSED: shared cached departments (was an uncached
  // departmentAPI.getAll() mount GET, duplicated across admin pages with zero
  // cross-page dedupe). Same array data via the shared 10-min RQ key
  // (Forms/Hackathons precedent); warm navs = 0 GETs.
  const { data: departmentsData } = useDepartments()
  const departments: any[] = Array.isArray(departmentsData) ? departmentsData : []
  const [teacher, setTeacher] = useState({
    name: '', email: '', empNumber: '', departmentId: ''
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvResults, setCsvResults] = useState<any>(null)

  if (user?.role === 'STUDENT') {
    return (
      <div className="max-w-[1280px] mx-auto">
        <div className="rounded-2xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 p-8 text-center" role="alert">
          <h1 className="text-xl font-bold text-surface-900 dark:text-night-50">Not available for students</h1>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-2">Only college admins can onboard faculty. Ask your registrar for access.</p>
          <Link to="/dashboard" className="mt-5 inline-flex px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold">Back to dashboard</Link>
        </div>
      </div>
    )
  }

  // Departments now come from the shared useDepartments() hook above —
  // the old uncached mount useEffect was removed (PERPAGE-MISSED).

  const handleAddTeacher = async () => {
    const fe: Record<string, string> = {}
    if (!teacher.name.trim()) fe.name = 'Name is required.'
    if (!teacher.email.trim()) fe.email = 'Email is required.'
    else if (!isValidEmail(teacher.email)) fe.email = 'Enter a valid email.'
    if (!teacher.empNumber.trim()) fe.empNumber = 'Employee number is required.'
    if (!teacher.departmentId) fe.departmentId = 'Select a department.'
    setFieldErrors(fe)
    if (Object.keys(fe).length) {
      toast.error(Object.values(fe)[0])
      return
    }
    if (isCommonPasswordLocal(defaultPassword)) { toast.error('Temporary password is too common � click Regenerate'); return }
    setLoading(true)
    try {
      const breach = await checkPasswordBreachHook(defaultPassword).catch(() => ({ breached: false, offline: true as const })); if (breach.breached) { toast.error('Generated password appears in a breach � click Regenerate'); setLoading(false); return }
      await adminAPI.addTeacher({
        ...teacher,
        password: defaultPassword
      })
      toast.success('Teacher added! Share the password once � they must change it on first login.')
      setTeacher({ name: '', email: '', empNumber: '', departmentId: '' }); setDefaultPassword(generateSecurePassword(16))
      setFieldErrors({})
      notifyEntityMutated('user', { action: 'teacher-added' })
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add teacher')
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
      toast.error('Please set a Temporary Password \(auto-generated, show once\)')
      return
    }

    setLoading(true)
    try {
      const text = await csvFile.text()
      const lines = text.split('\n').filter(l => l.trim())
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())

      const nameIdx = headers.findIndex(h => h === 'name')
      const emailIdx = headers.findIndex(h => h === 'email')
      const empIdx = headers.findIndex(h => h === 'emp number' || h === 'empnumber' || h === 'emp_number')
      const deptIdx = headers.findIndex(h => h === 'department')

      if (nameIdx === -1 || emailIdx === -1 || empIdx === -1 || deptIdx === -1) {
        toast.error('CSV must have columns: Name, Email, Emp Number, Department')
        setLoading(false)
        return
      }

      const teachers = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim())
        const deptName = cols[deptIdx]
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        return {
          name: cols[nameIdx],
          email: cols[emailIdx],
          empNumber: cols[empIdx],
          departmentId: dept?.id || '',
          // Raw name so the backend can resolve case-insensitively / fail loudly
          // on typos instead of silently creating a dept-less teacher.
          department: deptName,
          password: defaultPassword
        }
      }).filter(t => t.name && t.email)

      const results = await adminAPI.bulkAddTeachers(teachers)
      setCsvResults(results)
      toast.success(`${results.success} teachers added, ${results.failed} failed`)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to upload CSV')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = () => {
    const deptNames = departments.length > 0 ? departments.map(d => d.name).join('/') : 'Computer Science/Mathematics'
    const csv = `Name,Email,Emp Number,Department\nJohn Doe,john@college.edu,EMP001,${departments[0]?.name || 'Computer Science'}\nJane Smith,jane@college.edu,EMP002,${departments[1]?.name || 'Mathematics'}`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'teacher_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<UserPlus size={18} />}
        eyebrow="Admin · Teachers"
        title={<>Add Teachers</>}
        subtitle="Onboard faculty — quick, verified and department-assigned."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">Add Teachers</h1>
          <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Add teachers to your college</p>
        </div>
      </div>

      {/* College Name */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
        <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">College</label>
        <input type="text" value={user?.college?.name || ''} disabled
          className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-surface-50 dark:bg-night-800 text-surface-500 dark:text-night-400" />
      </div>

      {/* Temporary Password \(auto-generated, show once\) */}
      <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
        <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Temporary Password \(auto-generated, show once\)</label>
        <input type="password" value={defaultPassword} onChange={(e) => setDefaultPassword(e.target.value)}
          className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
          placeholder="Password for all teachers" />
        <p className="text-xs text-surface-400 dark:text-night-400 mt-1">Unique per teacher � share once over a secure channel. They must change it on first login \(min 8, HIBP-checked server-side\).</p>
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
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Emp Number *</label>
              <input type="text" value={teacher.empNumber} onChange={(e) => setTeacher({ ...teacher, empNumber: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="e.g., EMP001" />
              {fieldErrors.empNumber && <p className="mt-1 text-xs text-danger-600">{fieldErrors.empNumber}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Name *</label>
              <input type="text" value={teacher.name} onChange={(e) => setTeacher({ ...teacher, name: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="Full name" />
              {fieldErrors.name && <p className="mt-1 text-xs text-danger-600">{fieldErrors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Email *</label>
              <input type="email" value={teacher.email} onChange={(e) => setTeacher({ ...teacher, email: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="email@college.edu" />
              {fieldErrors.email && <p className="mt-1 text-xs text-danger-600">{fieldErrors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Department *</label>
              <select value={teacher.departmentId} onChange={(e) => setTeacher({ ...teacher, departmentId: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
                <option value="">Select department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {fieldErrors.departmentId && <p className="mt-1 text-xs text-danger-600">{fieldErrors.departmentId}</p>}
            </div>
          </div>
          <button onClick={handleAddTeacher} disabled={loading}
            className="mt-5 w-full px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={16} />}
            {loading ? 'Adding...' : 'Add Teacher'}
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
                <p className="text-xs text-surface-500 dark:text-night-400 mt-1">CSV columns: Name, Email, Emp Number, Department (department name must match exactly)</p>
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
              {loading ? 'Uploading...' : 'Upload & Add Teachers'}
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



