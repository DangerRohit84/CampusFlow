import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, ArrowRight, GraduationCap, Library, MapPin, Clock3 } from 'lucide-react'
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
    <div className="min-h-screen bg-surface-50 dark:bg-night-800 flex">
      {/* Left — Admission card */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-[440px] animate-slideUp">
          {/* masthead */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-display font-extrabold tracking-tight text-surface-900 dark:text-night-50 leading-none">CampusFlow</p>
              <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-surface-400 dark:text-night-400">Hall 01 · Campus OS</p>
            </div>
            <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-surface-500 dark:text-night-400 border border-surface-200 dark:border-night-600 rounded-full px-2.5 py-1 bg-white dark:bg-night-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> System live
            </span>
          </div>

          {/* library card */}
          <div className="paper overflow-hidden">
            {/* brass rule + header */}
            <div className="h-[3px] bg-brass-400" />
            <div className="px-6 pt-6 pb-5">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-400 border border-surface-200 dark:border-night-600 rounded-full px-2.5 py-1">
                <Library size={12} /> Library Card — Sign In
              </div>
              <h1 className="mt-4 font-display text-[30px] leading-none font-extrabold text-surface-900 dark:text-night-50">Welcome back</h1>
              <p className="mt-2 text-sm text-surface-500 dark:text-night-400">Use your campus credentials to enter the quad.</p>
            </div>

            <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
              <Input label="Email" type="email" placeholder="you@university.edu" icon={<Mail size={18} />} value={email} onChange={(e) => setEmail(e.target.value)} required />
              <Input label="Password" type="password" placeholder="Enter your password" icon={<Lock size={18} />} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500" />
                  <span className="text-surface-600 dark:text-night-300">Remember me</span>
                </label>
                <a href="#" className="text-primary-600 hover:text-primary-700 font-semibold">Forgot password?</a>
              </div>
              <Button type="submit" loading={loading} className="w-full">
                Sign In <ArrowRight size={18} />
              </Button>
              <p className="text-center text-sm text-surface-500 dark:text-night-400">
                Don&apos;t have an account? <Link to="/register" className="text-primary-600 hover:text-primary-700 font-semibold">Create account</Link>
              </p>
              <p className="text-center text-sm text-surface-500 dark:text-night-400">
                Registering a college? <Link to="/register-college" className="text-primary-600 hover:text-primary-700 font-semibold">College intake</Link>
              </p>
            </form>

            {/* due slip footer */}
            <div className="px-6 py-3 bg-surface-50 dark:bg-night-800 border-t border-surface-200 dark:border-night-600 flex items-center justify-between text-xs text-surface-500 dark:text-night-400">
              <span className="inline-flex items-center gap-1.5"><Clock3 size={12} /> Office hours 9 — 5 IST</span>
              <span className="font-mono text-[11px]">ID  # CF-2026</span>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-surface-400 dark:text-night-400">Protected by campus SSO · WCAG AA</p>
        </div>
      </div>

      {/* Right — Quad photo (campus-native, no gradient blobs) */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden border-l border-surface-200 dark:border-night-600 bg-warning-100">
        {/* quad image — CSS campus texture + photo frame */}
        <div className="absolute inset-0">
          {/* subtle paper grain */}
          <div className="absolute inset-0 paper-grain opacity-60" />
          {/* quad photo placeholder — masonry / collegiate */}
          <div className="absolute inset-6 rounded-[14px] overflow-hidden border border-surface-200 dark:border-night-600 shadow-e2 bg-white dark:bg-night-800">
            <img
              src="https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1200&q=80&auto=format&fit=crop"
              alt="Campus quad with brick buildings and trees"
              className="w-full h-full object-cover"
              loading="eager"
            />
            {/* label plate on photo */}
            <div className="absolute bottom-4 left-4 right-4 bg-white/95 dark:bg-night-800/95 backdrop-blur rounded-xl border border-surface-200 dark:border-night-600 p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center shrink-0">
                <MapPin size={16} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-surface-900 dark:text-night-50 leading-none">The Quad — North Court</p>
                <p className="text-xs text-surface-500 dark:text-night-400">Your day, pinned to the board. No noise.</p>
              </div>
              <span className="ml-auto hidden sm:inline-flex text-[11px] font-bold tracking-wide uppercase bg-brass-400 text-surface-900 dark:text-night-50 rounded-full px-2.5 py-1">Live</span>
            </div>
          </div>
        </div>

        {/* caption rail */}
        <div className="relative z-10 mt-auto w-full p-8">
          <div className="max-w-[520px] ml-auto bg-white dark:bg-night-800 rounded-[14px] border border-surface-200 dark:border-night-600 shadow-e2 p-5">
            <p className="font-display font-bold text-surface-900 dark:text-night-50">Your campus, on one board.</p>
            <p className="text-sm text-surface-500 dark:text-night-400 mt-1 leading-relaxed">Timetable, due slips, and pinned notices — the same system the registrar uses, now on your desk.</p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 py-3">
                <p className="font-display font-extrabold text-surface-900 dark:text-night-50">12-col</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-night-400">Grid</p>
              </div>
              <div className="rounded-xl bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 py-3">
                <p className="font-display font-extrabold text-surface-900 dark:text-night-50">44px</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-night-400">Touch</p>
              </div>
              <div className="rounded-xl bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 py-3">
                <p className="font-display font-extrabold text-surface-900 dark:text-night-50">AA</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-night-400">Contrast</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
