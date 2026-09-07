import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Mail,
  Lock,
  User,
  GraduationCap,
  BookOpen,
  Search,
  Building2,
  Clock3,
  UserPlus,
  Sparkles,
  Shield,
  Layers,
  CheckCircle2,
  ArrowRight,
  Quote,
  MapPin,
  Hash,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { collegeAPI } from '../lib/api'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

type FormState = {
  name: string
  email: string
  password: string
  collegeId: string
  studentId: string
  department: string
  incomingYear: string
}

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    collegeId: '',
    studentId: '',
    department: '',
    incomingYear: '',
  })
  const [colleges, setColleges] = useState<any[]>([])
  const [collegeSearch, setCollegeSearch] = useState('')
  const [collegeOpen, setCollegeOpen] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const { register, loading } = useAuthStore()
  const navigate = useNavigate()
  const shouldReduce = useReducedMotion()

  useEffect(() => {
    collegeAPI.getPublicList().then(setColleges).catch(() => {})
  }, [])

  const filteredColleges = colleges.filter((c) => String(c.name).toLowerCase().includes(collegeSearch.toLowerCase()))
  const selectedCollege = colleges.find((c) => c.id === form.collegeId)

  const errors: Partial<Record<keyof FormState, string>> = {}
  const vName = form.name.trim()
  const vEmail = form.email.trim()
  const vPass = form.password
  if (!vName) errors.name = 'Full name required'
  else if (vName.length < 2) errors.name = 'Enter at least 2 characters'
  if (!vEmail) errors.email = 'University email required'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vEmail)) errors.email = 'Enter a valid email'
  if (!form.studentId.trim()) errors.studentId = 'Roll number required'
  if (!form.collegeId) errors.collegeId = 'Select your college'
  if (!form.department.trim()) errors.department = 'Department required'
  if (!form.incomingYear) errors.incomingYear = 'Select year'
  if (!vPass) errors.password = 'Password required'
  else if (vPass.length < 6) errors.password = 'Minimum 6 characters'
  else if (vPass.length < 8) {
    // warn but not block — nudge to stronger
  }
  const passScore =
    !vPass ? 0 : vPass.length < 6 ? 1 : vPass.length < 8 ? 2 : /[A-Z]/.test(vPass) && /[0-9]/.test(vPass) && /[^A-Za-z0-9]/.test(vPass) ? 4 : 3

  const visibleErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => touched[k])) as typeof errors
  const isValid = Object.keys(errors).length === 0

  const update = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, email: true, password: true, collegeId: true, studentId: true, department: true, incomingYear: true })
    if (!isValid) {
      const first = Object.values(errors)[0]
      if (first) toast.error(first)
      return
    }
    try {
      const payload = { ...form, email: vEmail, name: vName, incomingYear: form.incomingYear ? parseInt(form.incomingYear, 10) : undefined }
      await register(payload as any)
      toast.success('Account created — welcome to the quad!')
      navigate('/dashboard')
    } catch (err: any) {
      toast.error(err?.message || 'Registration failed — try a different email')
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f6f6f6] dark:bg-black selection:bg-[#1ed760]/30 selection:text-black dark:selection:text-white">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&display=swap');`}</style>

      {/* ── LEFT — Form bento (mirrored: Login has form right, Register has form left) ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-10 relative overflow-hidden bg-[#f6f6f6] dark:bg-black min-h-[100dvh] lg:min-h-screen">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-28 -left-28 w-[520px] h-[520px] rounded-full bg-[#1ed760]/[0.06] blur-[72px]" />
          <div className="absolute -bottom-40 -right-28 w-[600px] h-[600px] rounded-full bg-[#1db954]/[0.05] blur-[80px]" />
        </div>

        <motion.div
          initial={shouldReduce ? undefined : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-[480px]"
        >
          <div className="flex lg:hidden items-center gap-3 mb-6">
            <span className="w-10 h-10 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black grid place-items-center">
              <GraduationCap size={18} />
            </span>
            <span>
              <span className="block font-display font-extrabold tracking-tight leading-none text-[#0a0a0a] dark:text-white">CampusFlow</span>
              <span className="block text-[10px] font-bold tracking-[0.14em] uppercase text-zinc-500 dark:text-zinc-400">Hall 01 · Campus OS</span>
            </span>
          </div>

          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-zinc-200 dark:border-[#282828] shadow-[0_16px_48px_-16px_rgba(0,0,0,0.18)] overflow-hidden">
            <div className="h-[3px] bg-gradient-to-r from-[#1ed760] via-[#1ed760] to-[#1db954]" />
            <div className="px-6 sm:px-7 pt-7 pb-2">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-300">
                  <UserPlus size={12} /> Admission Card
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#1ed760]/10 border border-[#1ed760]/20 text-[#0a7a3a] dark:text-[#1ed760] px-2.5 py-1 text-[11px] font-bold">CF-ADM-01</span>
              </div>
              <h1 className="mt-4 font-display font-extrabold tracking-[-0.03em] leading-none text-[#0a0a0a] dark:text-white text-[28px]">Create your account</h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Your library card for every room, notice, and deadline — registrar-approved.</p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="px-6 sm:px-7 pb-7 space-y-4">
              {/* subtle social top — optional but premium 2025-26 pattern */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => toast('Google sign-up coming soon — use email')}
                  className="inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1a1a1a] hover:bg-zinc-50 dark:hover:bg-[#1f1f1f] text-xs font-semibold text-zinc-700 dark:text-zinc-200 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-white border border-zinc-200 grid place-items-center text-[10px] font-black">G</span> Google
                </button>
                <button
                  type="button"
                  onClick={() => toast('Microsoft SSO coming soon')}
                  className="inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1a1a1a] hover:bg-zinc-50 dark:hover:bg-[#1f1f1f] text-xs font-semibold text-zinc-700 dark:text-zinc-200 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-[#0a0a0a] text-white dark:bg-white dark:text-black grid place-items-center text-[10px] font-bold">◧</span> Microsoft
                </button>
              </div>
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-[11px] font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500">or register with email</span>
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <Input
                label="Full Name"
                placeholder="Alex Johnson"
                icon={<User size={18} />}
                value={form.name}
                onChange={update('name')}
                onBlur={() => setTouched((p) => ({ ...p, name: true }))}
                error={visibleErrors.name}
                autoComplete="name"
                required
                aria-invalid={!!visibleErrors.name}
              />
              <Input
                label="University Email"
                type="email"
                placeholder="you@university.edu"
                icon={<Mail size={18} />}
                value={form.email}
                onChange={update('email')}
                onBlur={() => setTouched((p) => ({ ...p, email: true }))}
                error={visibleErrors.email}
                autoComplete="email"
                inputMode="email"
                required
              />
              <Input
                label="Roll Number"
                placeholder="e.g., CS2023001"
                icon={<Hash size={18} />}
                value={form.studentId}
                onChange={update('studentId')}
                onBlur={() => setTouched((p) => ({ ...p, studentId: true }))}
                error={visibleErrors.studentId}
                autoComplete="off"
                required
              />

              {/* College — searchable */}
              <div className="relative">
                <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                  College <span className="text-[#ff4b5c]">*</span>
                </label>
                <div className="relative">
                  <Building2 size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                  <input
                    type="text"
                    placeholder={selectedCollege ? selectedCollege.name : 'Search your college...'}
                    value={collegeOpen ? collegeSearch : selectedCollege ? selectedCollege.name : ''}
                    onFocus={() => {
                      setCollegeOpen(true)
                      setCollegeSearch('')
                    }}
                    onChange={(e) => {
                      setCollegeSearch(e.target.value)
                      setCollegeOpen(true)
                      setTouched((p) => ({ ...p, collegeId: true }))
                    }}
                    onBlur={() => window.setTimeout(() => setCollegeOpen(false), 180)}
                    aria-expanded={collegeOpen}
                    aria-autocomplete="list"
                    className={`w-full pl-11 pr-10 h-11 rounded-xl border bg-white dark:bg-[#000] text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 text-sm transition-colors ${
                      visibleErrors.collegeId ? 'border-[#ff4b5c] focus:border-[#ff4b5c] focus:ring-[#ff4b5c]/20' : 'border-zinc-200 dark:border-zinc-800 focus:border-[#1ed760]/30 focus:ring-[#1ed760]/15'
                    }`}
                  />
                  <Search size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                </div>
                {visibleErrors.collegeId && <p className="mt-1.5 text-xs font-medium text-[#ff4b5c]">{visibleErrors.collegeId}</p>}
                {!visibleErrors.collegeId && selectedCollege && (
                  <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1">
                    <CheckCircle2 size={12} className="text-[#1ed760]" /> {selectedCollege.name} selected
                  </p>
                )}

                <AnimatePresence>
                  {collegeOpen && (
                    <motion.div
                      initial={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute z-20 w-full mt-1.5 bg-white dark:bg-[#121212] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.16)] max-h-52 overflow-y-auto overscroll-contain"
                    >
                      {filteredColleges.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                          No colleges found {collegeSearch ? `for “${collegeSearch}”` : ''}.
                          <Link to="/register-college" className="ml-1 font-semibold text-[#1ed760] hover:underline">
                            Register college
                          </Link>
                        </div>
                      ) : (
                        filteredColleges.slice(0, 40).map((college) => (
                          <button
                            key={college.id}
                            type="button"
                            onMouseDown={() => {
                              setForm((p) => ({ ...p, collegeId: college.id }))
                              setCollegeSearch('')
                              setCollegeOpen(false)
                              setTouched((t) => ({ ...t, collegeId: true }))
                            }}
                            className={`w-full text-left px-3 h-11 text-sm flex items-center gap-2.5 border-b last:border-0 border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${form.collegeId === college.id ? 'bg-[#1ed760]/10 text-[#0a7a3a] dark:text-[#1ed760] font-semibold' : 'text-zinc-700 dark:text-zinc-200'}`}
                          >
                            <Building2 size={14} className={form.collegeId === college.id ? 'text-[#1ed760]' : 'text-zinc-400 dark:text-zinc-500'} />
                            <span className="truncate">{college.name}</span>
                            {form.collegeId === college.id && <CheckCircle2 size={14} className="ml-auto text-[#1ed760]" />}
                          </button>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Input
                    label="Department"
                    placeholder="e.g., CSE, ECE"
                    icon={<BookOpen size={18} />}
                    value={form.department}
                    onChange={update('department')}
                    onBlur={() => setTouched((p) => ({ ...p, department: true }))}
                    error={visibleErrors.department}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-1.5">
                    Year <span className="text-[#ff4b5c]">*</span>
                  </label>
                  <div className="relative">
                    <GraduationCap size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                    <select
                      value={form.incomingYear}
                      onChange={update('incomingYear')}
                      onBlur={() => setTouched((p) => ({ ...p, incomingYear: true }))}
                      className={`w-full pl-10 pr-9 h-11 rounded-xl border bg-white dark:bg-[#000] text-zinc-900 dark:text-white focus:outline-none focus:ring-2 text-sm appearance-none transition-colors ${
                        visibleErrors.incomingYear ? 'border-[#ff4b5c] focus:border-[#ff4b5c] focus:ring-[#ff4b5c]/20' : 'border-zinc-200 dark:border-zinc-800 focus:border-[#1ed760]/30 focus:ring-[#1ed760]/15'
                      }`}
                    >
                      <option value="">Select year</option>
                      <option value="1">1st Year</option>
                      <option value="2">2nd Year</option>
                      <option value="3">3rd Year</option>
                      <option value="4">4th Year</option>
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">▾</span>
                  </div>
                  {visibleErrors.incomingYear && <p className="mt-1.5 text-xs font-medium text-[#ff4b5c]">{visibleErrors.incomingYear}</p>}
                </div>
              </div>

              <div>
                <Input
                  label="Password"
                  type="password"
                  placeholder="Create a strong password"
                  icon={<Lock size={18} />}
                  value={form.password}
                  onChange={update('password')}
                  onBlur={() => setTouched((p) => ({ ...p, password: true }))}
                  error={visibleErrors.password}
                  autoComplete="new-password"
                  required
                />
                {/* strength meter */}
                {form.password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${i <= passScore ? (passScore <= 1 ? 'bg-[#ff4b5c]' : passScore === 2 ? 'bg-amber-500' : passScore === 3 ? 'bg-[#1db954]' : 'bg-[#1ed760]') : 'bg-zinc-200 dark:bg-zinc-800'}`}
                        />
                      ))}
                    </div>
                    <p className={`mt-1 text-[11px] font-semibold ${passScore <= 1 ? 'text-[#ff4b5c]' : passScore === 2 ? 'text-amber-600 dark:text-amber-400' : 'text-[#0a7a3a] dark:text-[#1ed760]'}`}>
                      {passScore <= 1 ? 'Weak — add more characters' : passScore === 2 ? 'Fair — add uppercase, number, symbol' : passScore === 3 ? 'Good — add a symbol for stronger' : 'Strong password ✓'}
                    </p>
                  </div>
                )}
              </div>

              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                By creating an account you agree to our{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); toast('Terms — coming soon') }} className="font-semibold text-zinc-700 dark:text-zinc-300 hover:text-[#1ed760] underline underline-offset-4">
                  Terms
                </a>{' '}
                and{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); toast('Privacy — coming soon') }} className="font-semibold text-zinc-700 dark:text-zinc-300 hover:text-[#1ed760] underline underline-offset-4">
                  Privacy
                </a>
                . Tenant-isolated · JWT · No cross-college leak.
              </p>

              <Button
                type="submit"
                loading={loading}
                disabled={loading}
                className="w-full !bg-[#0a0a0a] dark:!bg-white !text-white dark:!text-black hover:!bg-[#1a1a1a] dark:hover:!bg-zinc-100 !rounded-xl !h-11 text-[15px] font-bold shadow-[0_8px_24px_rgba(0,0,0,0.12)] active:scale-[0.98] transition-all"
              >
                {!loading && (
                  <>
                    Create Account <ArrowRight size={18} />
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-zinc-600 dark:text-zinc-300">
                Already have an account?{' '}
                <Link to="/login" className="font-bold text-[#0a0a0a] dark:text-white hover:text-[#1ed760] dark:hover:text-[#1ed760] underline underline-offset-4 decoration-zinc-300 dark:decoration-zinc-700 hover:decoration-[#1ed760] transition-colors">
                  Sign in
                </Link>
              </p>
            </form>

            <div className="px-6 sm:px-7 py-3.5 bg-zinc-50 dark:bg-[#0a0a0a] border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 font-medium">
                <Clock3 size={12} /> Registrar 9 — 5 IST
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="hidden sm:inline-flex items-center gap-1">
                  <MapPin size={11} /> Intake Hall
                </span>
                <span className="rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 font-bold">FORM CF-ADM-01</span>
              </span>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
            Free for students · ~60s intake ·{' '}
            <Link to="/" className="underline underline-offset-4 hover:text-zinc-700 dark:hover:text-zinc-300">
              Back to landing
            </Link>
          </p>

          <div className="lg:hidden mt-6 rounded-2xl bg-white dark:bg-[#121212] border border-zinc-200 dark:border-zinc-800 p-4">
            <p className="text-xs font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500">Why CampusFlow?</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { num: '10K+', label: 'Students' },
                { num: '50+', label: 'Colleges' },
                { num: '14s', label: 'Pinned' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 py-3">
                  <p className="font-display font-extrabold text-[#0a0a0a] dark:text-white">{s.num}</p>
                  <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── RIGHT — Premium dark mesh hero (mirrored: Login hero left, Register hero right) ── */}
      <div className="premium-hero hidden lg:flex flex-1 relative overflow-hidden bg-[#0a0a0a] border-l border-white/[0.06] lg:min-h-screen isolation-auto">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#1ed760]/[0.07] via-white/[0.015] to-transparent" />
          <motion.div
            aria-hidden
            animate={shouldReduce ? undefined : { x: [0, 16, 0], y: [0, -10, 0], scale: [1, 1.05, 1] }}
            transition={shouldReduce ? undefined : { duration: 15, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-28 -left-24 w-[580px] h-[580px] rounded-full bg-gradient-to-br from-[#1ed760]/[0.13] via-[#1db954]/[0.06] to-transparent blur-[88px]"
          />
          <motion.div
            aria-hidden
            animate={shouldReduce ? undefined : { x: [0, -12, 0], y: [0, 12, 0], scale: [1, 1.04, 1] }}
            transition={shouldReduce ? undefined : { duration: 19, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }}
            className="absolute -bottom-32 -right-28 w-[640px] h-[640px] rounded-full bg-gradient-to-tl from-[#1db954]/[0.08] via-[#1ed760]/[0.04] to-transparent blur-[96px]"
          />
          <div
            className="absolute inset-0 opacity-[0.022]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)`,
              backgroundSize: '28px 28px',
            }}
          />
          <div className="absolute inset-0 opacity-[0.07] mix-blend-soft-light">
            <img
              src="https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1600&q=80&auto=format&fit=crop"
              alt=""
              aria-hidden
              className="w-full h-full object-cover"
              loading="eager"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/[0.18]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/35 to-transparent" />
        </div>

        <div className="relative z-10 flex flex-col w-full p-8 xl:p-10">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group">
              <span className="w-10 h-10 rounded-xl bg-white text-black grid place-items-center shadow-[0_8px_24px_rgba(0,0,0,0.22)] group-hover:scale-[1.02] transition-transform">
                <GraduationCap size={18} />
              </span>
              <span>
                <span className="block font-display font-extrabold tracking-tight leading-none text-white text-[15px]">CampusFlow</span>
                <span className="block text-[10px] font-bold tracking-[0.16em] uppercase text-white/55">Hall 01 · Campus OS</span>
              </span>
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] border border-white/10 backdrop-blur-xl px-3 py-1.5 text-[11px] font-semibold text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1ed760] animate-pulse shadow-[0_0_0_6px_rgba(30,215,96,0.18)]" />
              Intake open
            </span>
          </div>

          <div className="flex-1 flex flex-col justify-center max-w-[560px] py-10">
            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 self-start rounded-full bg-white/[0.07] border border-white/10 backdrop-blur-xl px-3 py-1.5"
            >
              <span className="w-7 h-7 rounded-full bg-[#1ed760] text-black grid place-items-center">
                <Sparkles size={13} />
              </span>
              <span className="text-[11px] font-bold tracking-widest uppercase text-white/85">Admissions · Intake Hall</span>
              <span className="hidden sm:inline-flex ml-1 rounded-full bg-white text-black text-[10px] font-extrabold px-2 py-0.5">CF-ADM-01</span>
            </motion.div>

            <motion.h1
              initial={shouldReduce ? undefined : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1], delay: 0.07 }}
              className="mt-6 font-semibold tracking-[-0.04em] leading-[0.9] text-white text-balance"
              style={{ fontFamily: 'Fraunces, serif', fontSize: 'clamp(36px, 4.2vw, 52px)' }}
            >
              One card,
              <br />
              <span className="text-white/80">every door opens.</span>
            </motion.h1>

            <motion.p
              initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.14 }}
              className="mt-4 text-[15px] leading-relaxed text-white/65 max-w-[480px] text-balance"
            >
              Fill once — timetable, rooms, notices and hackathons pinned to your department and year. Registrar — approved, student — loved.
            </motion.p>

            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 grid grid-cols-3 gap-3"
            >
              {[
                { num: '10K+', label: 'Students', icon: GraduationCap },
                { num: '50+', label: 'Colleges', icon: Building2 },
                { num: 'AA', label: 'Contrast', icon: Shield },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 p-4 text-center hover:bg-white/[0.08] transition-colors">
                  <span className="mx-auto w-8 h-8 rounded-xl bg-white text-black grid place-items-center">
                    <s.icon size={14} />
                  </span>
                  <p className="mt-2 font-display font-extrabold tracking-tight text-white leading-none text-[18px]">{s.num}</p>
                  <p className="text-[11px] font-bold tracking-widest uppercase text-white/55">{s.label}</p>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="mt-6 space-y-3"
            >
              {[
                { title: 'Scoped visibility', desc: 'You see only your year · branch · dept — no spam.', icon: Layers },
                { title: 'Pinned in 14s', desc: 'Photo of notice → parsed board instantly.', icon: CheckCircle2 },
                { title: 'Tenant-isolated', desc: 'College → department → room. JWT + role gates.', icon: Shield },
              ].map((f) => (
                <div key={f.title} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 px-3.5 py-3">
                  <span className="w-8 h-8 rounded-xl bg-white text-black grid place-items-center shrink-0">
                    <f.icon size={14} />
                  </span>
                  <div>
                    <p className="text-sm font-bold leading-none text-white">{f.title}</p>
                    <p className="text-xs text-white/60">{f.desc}</p>
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[20px] bg-white/[0.07] backdrop-blur-xl border border-white/10 p-4 flex items-center gap-3">
              <img
                src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&q=80&auto=format&fit=crop&crop=face"
                alt=""
                className="w-9 h-9 rounded-full object-cover border border-white/15"
                loading="lazy"
              />
              <div>
                <p className="text-xs font-bold leading-none text-white">Aarav Singh · 3rd Year CSE</p>
                <p className="text-[11px] text-white/60">“Shows only what I’m eligible for — two taps and applied.”</p>
              </div>
              <span className="ml-auto hidden sm:inline-flex items-center gap-1 rounded-full bg-[#1ed760] text-black text-[11px] font-extrabold px-2.5 py-1">
                <Quote size={11} /> Story
              </span>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1.5 font-semibold">
                <CheckCircle2 size={12} className="text-[#1ed760]" /> Free for students
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] border border-white/10 text-white/70 px-3 py-1.5 backdrop-blur">
                No credit card · ~60s intake
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
