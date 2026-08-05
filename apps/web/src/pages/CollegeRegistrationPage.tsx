import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { adminAPI, authAPI } from '../lib/api'
import { motion } from 'framer-motion'
import { GraduationCap, Loader2, CheckCircle, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'

export default function CollegeRegistrationPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm] = useState({
    collegeName: '',
    collegeCode: '',
    address: '',
    phone: '',
    website: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  })

  const handleSubmit = async () => {
    if (!form.collegeName || !form.collegeCode || !form.adminName || !form.adminEmail || !form.adminPassword) {
      toast.error('Please fill all required fields')
      return
    }
    setLoading(true)
    try {
      // 1. Register college
      const college = await adminAPI.registerCollegePublic({
        name: form.collegeName,
        code: form.collegeCode,
        address: form.address,
        phone: form.phone,
        website: form.website,
        adminEmail: form.adminEmail,
      })

      // 2. Create admin account with auto-generated emp number
      const empNumber = `ADMIN-${form.collegeCode.toUpperCase()}-001`
      await authAPI.register({
        email: form.adminEmail,
        name: form.adminName,
        password: form.adminPassword,
        role: 'COLLEGE_ADMIN',
        collegeId: college.id,
        empNumber,
      })

      setSuccess(true)
      toast.success('College registered! Awaiting Super Admin approval.')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to register college')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl border border-surface-100 p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-surface-900 mb-2">College Registered!</h1>
          <p className="text-sm text-surface-500 mb-6">
            Your college has been submitted for approval. Once the Super Admin approves, you can log in with your credentials.
          </p>
          <Link to="/login"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium text-sm">
            Go to Login
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-surface-100 p-8 w-full max-w-lg">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-4">
          <ArrowLeft size={14} /> Back to Login
        </Link>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-surface-900">Register Your College</h1>
            <p className="text-sm text-surface-500">Create your college and admin account</p>
          </div>
        </div>

        {/* College Details */}
        <div className="space-y-4 mb-6">
          <h3 className="text-sm font-semibold text-surface-700 uppercase tracking-wider">College Details</h3>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">College Name *</label>
            <input type="text" value={form.collegeName} onChange={(e) => setForm({ ...form, collegeName: e.target.value })}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., MIT College of Engineering" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">College Code *</label>
            <input type="text" value={form.collegeCode} onChange={(e) => setForm({ ...form, collegeCode: e.target.value })}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., MIT" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Address</label>
            <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Address (optional)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="Phone (optional)" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Website</label>
              <input type="text" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="Website (optional)" />
            </div>
          </div>
        </div>

        {/* Admin Account */}
        <div className="space-y-4 mb-6">
          <h3 className="text-sm font-semibold text-surface-700 uppercase tracking-wider">Admin Account</h3>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Your Name *</label>
            <input type="text" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Full name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Admin Email *</label>
            <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="admin@college.edu" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Password *</label>
            <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Create a password" />
          </div>
        </div>

        <button onClick={handleSubmit} disabled={loading}
          className="w-full px-4 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle size={16} />}
          {loading ? 'Submitting...' : 'Register College'}
        </button>

        <p className="mt-4 text-center text-sm text-surface-500">
          Already have an account? <Link to="/login" className="text-primary-600 hover:text-primary-700 font-semibold">Sign in</Link>
        </p>
      </motion.div>
    </div>
  )
}
