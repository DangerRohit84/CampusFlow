import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, GraduationCap, ArrowRight, Sparkles, BookOpen, Calendar, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { login, loading } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      toast.success('Welcome back!')
      navigate('/dashboard')
    } catch (err: any) {
      toast.error(err.message || 'Login failed')
    }
  }

  return (
    <div className="min-h-screen flex">
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

          <h2 className="text-3xl font-bold text-surface-900 mb-2">Welcome back</h2>
          <p className="text-surface-500 mb-8">Sign in to access your campus dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input label="Email" type="email" placeholder="you@university.edu" icon={<Mail size={18} />} value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input label="Password" type="password" placeholder="Enter your password" icon={<Lock size={18} />} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500" />
                <span className="text-surface-600">Remember me</span>
              </label>
              <a href="#" className="text-primary-600 hover:text-primary-700 font-medium">Forgot password?</a>
            </div>
            <Button type="submit" loading={loading} className="w-full" size="lg">
              Sign In <ArrowRight size={18} />
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-surface-500">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary-600 hover:text-primary-700 font-semibold">Sign up free</Link>
          </p>
          <p className="mt-2 text-center text-sm text-surface-500">
            Want to register your college?{' '}
            <Link to="/register-college" className="text-primary-600 hover:text-primary-700 font-semibold">Register College</Link>
          </p>
        </motion.div>
      </div>

      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-primary-600 via-accent-600 to-purple-600">
        <div className="absolute inset-0 dot-pattern opacity-10" />
        <div className="absolute top-20 left-20 w-72 h-72 bg-white/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-accent-400/20 rounded-full blur-3xl animate-float-delayed" />
        <div className="relative z-10 flex flex-col justify-center p-16 text-white">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur rounded-full text-sm font-medium mb-8 border border-white/20">
              <Sparkles size={16} /> Powered by AI
            </div>
            <h2 className="text-5xl font-bold mb-6 leading-tight">Your Campus Life,<br /><span className="text-white/80">Simplified.</span></h2>
            <p className="text-xl text-white/70 mb-12 max-w-lg">Never miss a deadline, class, or event again. Let AI manage your academic life while you focus on learning.</p>
            <div className="grid grid-cols-3 gap-6">
              {[{ icon: Calendar, label: 'Smart Schedule', desc: 'AI-optimized' }, { icon: MessageSquare, label: 'AI Assistant', desc: '24/7 available' }, { icon: BookOpen, label: 'Track Grades', desc: 'Real-time' }].map((feature, i) => (
                <motion.div key={feature.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.1 }} className="p-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
                  <feature.icon className="w-8 h-8 mb-3 text-white/90" />
                  <p className="font-semibold text-sm">{feature.label}</p>
                  <p className="text-xs text-white/60">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}