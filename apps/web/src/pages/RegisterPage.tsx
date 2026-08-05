import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, User, GraduationCap, ArrowRight, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { adminAPI } from '../lib/api'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', college: '', studentId: '' })
  const { register, loading } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.college) {
      toast.error('Please enter your college name')
      return
    }
    try {
      await register(form)
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
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-accent-600 via-primary-600 to-blue-600">
        <div className="absolute inset-0 dot-pattern opacity-10" />
        <div className="absolute top-32 right-16 w-80 h-80 bg-white/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-16 left-16 w-64 h-64 bg-pink-400/20 rounded-full blur-3xl animate-float-delayed" />
        <div className="relative z-10 flex flex-col justify-center p-16 text-white">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-5xl font-bold mb-6 leading-tight">Join <span className="text-white/80">Thousands</span> of<br />Smart Students</h2>
            <p className="text-xl text-white/70 max-w-lg mb-12">Start your journey with CampusFlow. Organize your academic life with the power of AI.</p>
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
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-glow">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold gradient-text">CampusFlow</h1>
              <p className="text-xs text-surface-400 font-medium">AI Campus Operating System</p>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-surface-900 mb-2">Create your account</h2>
          <p className="text-surface-500 mb-8">Get started in under a minute</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input label="Full Name" placeholder="Alex Johnson" icon={<User size={18} />} value={form.name} onChange={update('name')} required />
            <Input label="University Email" type="email" placeholder="you@university.edu" icon={<Mail size={18} />} value={form.email} onChange={update('email')} required />
            <Input label="Roll Number" placeholder="e.g., CS2023001" icon={<GraduationCap size={18} />} value={form.studentId} onChange={update('studentId')} required />
            <Input label="College" placeholder="Your college name" icon={<Building2 size={18} />} value={form.college} onChange={update('college')} required />
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