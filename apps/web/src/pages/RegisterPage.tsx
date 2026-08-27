import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, User, GraduationCap, ArrowRight, Building2, BookOpen, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { collegeAPI } from '../lib/api'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', collegeId: '', studentId: '', department: '', incomingYear: '' })
  const [colleges, setColleges] = useState<any[]>([])
  const [collegeSearch, setCollegeSearch] = useState('')
  const [collegeOpen, setCollegeOpen] = useState(false)
  const { register, loading } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    collegeAPI.getPublicList().then(setColleges).catch(() => {})
  }, [])

  const filteredColleges = colleges.filter((c) =>
    c.name.toLowerCase().includes(collegeSearch.toLowerCase())
  )

  const selectedCollege = colleges.find((c) => c.id === form.collegeId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.collegeId) {
      toast.error('Please select your college')
      return
    }
    try {
      const payload = {
        ...form,
        incomingYear: form.incomingYear ? parseInt(form.incomingYear) : undefined,
      }
      await register(payload)
      toast.success('Account created!')
      navigate('/dashboard')
    } catch (err: any) {
      toast.error(err.message || 'Registration failed')
    }
  }

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }))

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-primary-600 via-primary-600 to-primary-400">
        <div className="absolute inset-0 dot-pattern opacity-10" />
        <div className="absolute top-32 right-16 w-80 h-80 bg-white/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-16 left-16 w-64 h-64 bg-primary-400/20 rounded-full blur-3xl animate-float-delayed" />
        <div className="relative z-10 flex flex-col justify-center p-16 text-white">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-5xl font-bold mb-6 leading-tight">Join <span className="text-white/80">Thousands</span> of<br />Smart Students</h2>
            <p className="text-xl text-white/70 max-w-lg mb-12">Start your journey with CampusFlowAI. Organize your academic life with the power of AI.</p>
            <div className="space-y-6">
              {[{ num: '10K+', label: 'Active Students' }, { num: '50+', label: 'Partner Universities' }, { num: '99.9%', label: 'Uptime' }].map((stat, i) => (
                <motion.div key={stat.label} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.1 }} className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 flex items-center justify-center text-xl font-bold">{stat.num}</div>
                  <span className="text-white/80 font-medium">{stat.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-500 flex items-center justify-center shadow-glow">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold gradient-text">CampusFlowAI</h1>
              <p className="text-xs text-surface-400 font-medium">AI Campus Operating System</p>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-surface-900 mb-2">Create your account</h2>
          <p className="text-surface-500 mb-8">Get started in under a minute</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input label="Full Name" placeholder="Alex Johnson" icon={<User size={18} />} value={form.name} onChange={update('name')} required />
            <Input label="University Email" type="email" placeholder="you@university.edu" icon={<Mail size={18} />} value={form.email} onChange={update('email')} required />
            <Input label="Roll Number" placeholder="e.g., CS2023001" icon={<GraduationCap size={18} />} value={form.studentId} onChange={update('studentId')} required />

            {/* College Searchable Dropdown */}
            <div className="relative">
              <label className="block text-sm font-medium text-surface-700 mb-1.5">College</label>
              <div className="relative">
                <Building2 size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input
                  type="text"
                  placeholder="Search your college..."
                  value={collegeOpen ? collegeSearch : (selectedCollege?.name || '')}
                  onFocus={() => { setCollegeOpen(true); setCollegeSearch('') }}
                  onChange={(e) => { setCollegeSearch(e.target.value); setCollegeOpen(true) }}
                  onBlur={() => setTimeout(() => setCollegeOpen(false), 200)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-surface-200 bg-white text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                />
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400" />
              </div>
              {collegeOpen && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-surface-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredColleges.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-surface-500">No colleges found</div>
                  ) : (
                    filteredColleges.map((college) => (
                      <button
                        key={college.id}
                        type="button"
                        onMouseDown={() => {
                          setForm((p) => ({ ...p, collegeId: college.id }))
                          setCollegeSearch('')
                          setCollegeOpen(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors flex items-center gap-2"
                      >
                        <Building2 size={14} className="text-surface-400" />
                        {college.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <Input label="Department" placeholder="e.g., CSE, ECE, Mechanical" icon={<BookOpen size={18} />} value={form.department} onChange={update('department')} required />
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">Year</label>
              <select
                value={form.incomingYear}
                onChange={update('incomingYear')}
                className="w-full px-4 py-2.5 rounded-xl border border-surface-200 bg-white text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="">Select year</option>
                <option value="1">1st Year</option>
                <option value="2">2nd Year</option>
                <option value="3">3rd Year</option>
                <option value="4">4th Year</option>
              </select>
            </div>
            <Input label="Password" type="password" placeholder="Create a strong password" icon={<Lock size={18} />} value={form.password} onChange={update('password')} required />
            <Button type="submit" loading={loading} className="w-full" size="lg">Create Account <ArrowRight size={18} /></Button>
          </form>
          <p className="mt-8 text-center text-sm text-surface-500">
            Already have an account? <Link to="/login" className="text-primary-600 hover:text-primary-700 font-semibold">Sign in</Link>
          </p>
        </motion.div>
      </div>
    </div>
  )
}
