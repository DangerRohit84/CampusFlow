import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { adminAPI, departmentAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  UserPlus, Upload, Download, Loader2, CheckCircle, X, FileText
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function AddStudentPage() {
  const { user } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<'form' | 'csv'>('form')
  const [loading, setLoading] = useState(false)
  const [defaultPassword, setDefaultPassword] = useState('password123')
  const [departments, setDepartments] = useState<any[]>([])
  const [student, setStudent] = useState({
    name: '', email: '', studentId: '', departmentId: '', incomingYear: ''
  })
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvResults, setCsvResults] = useState<any>(null)

  useEffect(() => {
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [])

  const handleAddStudent = async () => {
    if (!student.name || !student.email || !student.studentId || !student.departmentId || !student.incomingYear) {
      toast.error('All fields are required')
      return
    }
    setLoading(true)
    try {
      await adminAPI.addStudent({
        ...student,
        incomingYear: parseInt(student.incomingYear as string),
        password: defaultPassword
      })
      toast.success('Student added successfully!')
      setStudent({ name: '', email: '', studentId: '', departmentId: '', incomingYear: '' })
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Add Students</h1>
          <p className="text-surface-500 text-sm mt-1">Add students to your college</p>
        </div>
      </div>

      {/* College Name */}
      <div className="bg-white rounded-2xl border border-surface-100 p-5">
        <label className="block text-sm font-medium text-surface-700 mb-1">College</label>
        <input type="text" value={user?.college?.name || ''} disabled
          className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm bg-surface-50 text-surface-500" />
      </div>

      {/* Default Password */}
      <div className="bg-white rounded-2xl border border-surface-100 p-5">
        <label className="block text-sm font-medium text-surface-700 mb-1">Default Password</label>
        <input type="password" value={defaultPassword} onChange={(e) => setDefaultPassword(e.target.value)}
          className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
          placeholder="Password for all students" />
        <p className="text-xs text-surface-400 mt-1">This password will be used for all students added</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-100 pb-2">
        <button onClick={() => setActiveTab('form')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === 'form' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
          )}>
          <UserPlus size={16} className="inline mr-2" /> Add Manually
        </button>
        <button onClick={() => setActiveTab('csv')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === 'csv' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
          )}>
          <Upload size={16} className="inline mr-2" /> Upload CSV
        </button>
      </div>

      {/* Manual Form */}
      {activeTab === 'form' && (
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Roll Number *</label>
              <input type="text" value={student.studentId} onChange={(e) => setStudent({ ...student, studentId: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="e.g., CS2023001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Name *</label>
              <input type="text" value={student.name} onChange={(e) => setStudent({ ...student, name: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="Full name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Email *</label>
              <input type="email" value={student.email} onChange={(e) => setStudent({ ...student, email: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="email@college.edu" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Department *</label>
              <select value={student.departmentId} onChange={(e) => setStudent({ ...student, departmentId: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
                <option value="">Select department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Incoming Year *</label>
              <select value={student.incomingYear} onChange={(e) => setStudent({ ...student, incomingYear: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400">
                <option value="">Select batch year</option>
                {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <p className="text-xs text-surface-400 mt-1">Year the student joined. Outgoing year = incoming + 4.</p>
            </div>
          </div>
          <button onClick={handleAddStudent} disabled={loading}
            className="mt-5 w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={16} />}
            {loading ? 'Adding...' : 'Add Student'}
          </button>
        </div>
      )}

      {/* CSV Upload */}
      {activeTab === 'csv' && (
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-surface-900">Upload CSV File</h3>
                <p className="text-xs text-surface-500 mt-1">CSV columns: Name, Email, Roll Number, Department, Incoming Year</p>
              </div>
              <button onClick={downloadTemplate}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg">
                <Download size={14} /> Template
              </button>
            </div>

            <div className="border-2 border-dashed border-surface-200 rounded-xl p-8 text-center hover:border-primary-300 transition-colors">
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)} />
              <FileText size={32} className="mx-auto text-surface-400 mb-3" />
              {csvFile ? (
                <div>
                  <p className="text-sm font-medium text-surface-900">{csvFile.name}</p>
                  <button onClick={() => setCsvFile(null)} className="text-xs text-red-500 mt-1 flex items-center gap-1 mx-auto">
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
              className="w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload size={16} />}
              {loading ? 'Uploading...' : 'Upload & Add Students'}
            </button>

            {/* Results */}
            <AnimatePresence>
              {csvResults && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-surface-50 rounded-xl">
                  <div className="flex items-center gap-3 mb-2">
                    <CheckCircle size={16} className="text-green-500" />
                    <span className="text-sm font-medium text-surface-900">
                      {csvResults.success} added, {csvResults.failed} failed
                    </span>
                  </div>
                  {csvResults.errors?.length > 0 && (
                    <div className="mt-2 text-xs text-red-600 space-y-1">
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
