import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Mail,
  Lock,
  ArrowRight,
  MapPin,
  Clock3,
  LogIn,
  Quote,
  Shield,
  Sparkles,
  Layers,
  CheckCircle2,
  Github,
  Chrome,
} from 'lucide-react'
import BrandLogo from '../components/BrandLogo'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { resolvePostLoginDest } from '../lib/authRedirect'
import { motion, useReducedMotion } from 'framer-motion'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  // WHY student race: whole-store subscribe re-renders this page on the
  // user/token set inside login(), racing GuestRoute's <Navigate> with manual
  // navigate() in the same tick (two replace:true from /login can cancel and
  // leave URL on /login until refresh rehydrates). Selectors isolate renders.
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const navigate = useNavigate()
  const shouldReduce = useReducedMotion()

  const validate = () => {
    const e: typeof errors = {}
    const vEmail = email.trim()
    if (!vEmail) e.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vEmail)) e.email = 'Enter a valid university email'
    // WHY: backend loginSchema is min(1) (generic 401, no enumeration) — frontend must not block
    // short/legacy passwords with min 6/8. Only require non-empty; server decides.
    if (!password) e.password = 'Password is required'
    return e
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ve = validate()
    if (Object.keys(ve).length) {
      setErrors(ve)
      const first = ve.email || ve.password
      if (first) toast.error(first)
      return
    }
    setErrors({})
    try {
      // Persist-then-navigate: login() dual-writes the new auth blob to
      // localStorage BEFORE resolving, so navigate() below can never fire
      // while the interceptor still reads a stale superadmin token (which
      // 401-bounces straight back to /login). Use the FRESH login response
      // role (not a possibly-stale store read) for the landing route.
      const result = await login(email.trim(), password)
      // Same-tick order: login() set memory + dual-wrote localStorage BEFORE
      // resolving. Verify the same source guards read (memory isAuthenticated
      // + user) BEFORE navigate() runs — never navigate on a half-persisted state.
      const snap = useAuthStore.getState()
      if (!snap.isAuthenticated || !snap.user) {
        toast.error('Login saved incompletely — please retry')
        return
      }
      const freshRole = (result as any)?.user?.role ?? snap.user?.role
      toast.success('Welcome back!')
      // Soft-redirect intent preservation (pairs with api.ts 401 handler):
      // return to the page that triggered 401 instead of always role landing.
      // resolvePostLoginDest drops stale superadmin routes after an account
      // switch (COLLEGE_ADMIN must never land on /superadmin/* → /403 bounce
      // that looks like "stayed on /login").
      let dest: string
      try {
        const saved = sessionStorage.getItem('postLoginRedirect')
        dest = resolvePostLoginDest(saved, freshRole)
        sessionStorage.removeItem('postLoginRedirect')
      } catch {
        dest = resolvePostLoginDest(null, freshRole)
      }
      navigate(dest, { replace: true })
    } catch (err: any) {
      const msg = err?.message || 'Login failed — check credentials'
      toast.error(msg)
      setErrors((p) => ({ ...p, password: msg }))
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#f6f6f6] dark:bg-black selection:bg-[#1ed760]/30 selection:text-black dark:selection:text-white">
      {/* Fonts come from index.html (2 families, display=swap) — no inline @import (render-blocking). */}

      {/* ── LEFT — Premium Dark Mesh Hero (Obsidian Minimalism) ── */}
      <div className="premium-hero hidden lg:flex flex-1 relative overflow-hidden bg-[#0a0a0a] lg:min-h-screen border-r border-white/[0.06] isolation-auto">
        {/* mesh + orbs + grid + fade — mirror PremiumHero tokens: bg-[#0a0a0a] backdrop-blur-xl #1ed760 */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#1ed760]/[0.07] via-white/[0.015] to-transparent" />
          {/* Brand green orbs */}
          <motion.div
            aria-hidden
            animate={shouldReduce ? undefined : { x: [0, 18, 0], y: [0, -12, 0], scale: [1, 1.06, 1] }}
            transition={shouldReduce ? undefined : { duration: 14, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute -top-28 -right-24 w-[560px] h-[560px] rounded-full bg-gradient-to-br from-[#1ed760]/[0.14] via-[#1db954]/[0.07] to-transparent blur-[84px]"
          />
          <motion.div
            aria-hidden
            animate={shouldReduce ? undefined : { x: [0, -14, 0], y: [0, 16, 0], scale: [1, 1.04, 1] }}
            transition={shouldReduce ? undefined : { duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 1.2 }}
            className="absolute -bottom-32 -left-28 w-[620px] h-[620px] rounded-full bg-gradient-to-tr from-[#1db954]/[0.09] via-[#1ed760]/[0.05] to-transparent blur-[92px]"
          />
          <div className="absolute top-1/2 left-[18%] -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-white/[0.05] to-transparent blur-[64px]" />
          {/* faint grid */}
          <div
            className="absolute inset-0 opacity-[0.022]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)`,
              backgroundSize: '28px 28px',
            }}
          />
          {/* subtle campus texture behind mesh — 8% */}
          <div className="absolute inset-0 opacity-[0.08] mix-blend-soft-light">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1600&q=80&auto=format&fit=crop"
              srcSet="https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=800&q=70&auto=format&fit=crop 800w, https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1600&q=80&auto=format&fit=crop 1600w"
              sizes="(min-width: 1024px) 50vw, 100vw"
              alt=""
              aria-hidden="true"
              width={1600}
              height={900}
              fetchPriority="low"
              className="w-full h-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/[0.18]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/35 to-transparent" />
        </div>

        {/* content */}
        <div className="relative z-10 flex flex-col w-full p-8 xl:p-10">
          {/* top nav */}
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 group" aria-label="CampusFlow home">
              {/* WHY brand kit v1.0 splash: hero is dark #0a0a0a → reversed lockup, 38px desktop / 32px mobile + wrapper clearspace. */}
              <BrandLogo variant="reversed" height={38} />
              <span>
                <span className="block text-[10px] font-bold tracking-[0.16em] uppercase text-white/55">Hall 01 · Campus OS</span>
              </span>
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] border border-white/10 backdrop-blur-xl px-3 py-1.5 text-[11px] font-semibold text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1ed760] animate-pulse shadow-[0_0_0_6px_rgba(30,215,96,0.18)]" />
              System live
            </span>
          </div>

          {/* hero center */}
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
              <span className="text-[11px] font-bold tracking-widest uppercase text-white/85">Sign in · Secure & fast</span>
              <span className="hidden sm:inline-flex ml-1 rounded-full bg-white text-black text-[10px] font-extrabold px-2 py-0.5">WCAG AA</span>
            </motion.div>

            <motion.p
              aria-hidden="true"
              initial={shouldReduce ? undefined : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1], delay: 0.07 }}
              className="mt-6 font-semibold tracking-[-0.04em] leading-[0.9] text-white text-balance"
              style={{ fontFamily: 'Fraunces, serif', fontSize: 'clamp(36px, 4.2vw, 52px)' }}
            >
              Welcome
              <br />
              <span className="text-white/80">back to the quad.</span>
            </motion.p>

            <motion.p
              initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.14 }}
              className="mt-4 text-[15px] leading-relaxed text-white/65 max-w-[480px] text-balance"
            >
              One board for timetable, assignments, rooms and hallway chat — the same system the registrar uses, now on your desk.
            </motion.p>

            {/* feature glass row — bento */}
            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mt-8 grid grid-cols-3 gap-3"
            >
              {[
                { k: 'Timetable', v: 'Live', icon: Layers },
                { k: 'Due slips', v: 'No chase', icon: CheckCircle2 },
                { k: 'Hallway', v: 'Scoped', icon: Shield },
              ].map((f) => (
                <div key={f.k} className="rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 p-3.5 hover:bg-white/[0.08] hover:border-white/15 transition-colors">
                  <span className="w-8 h-8 rounded-xl bg-white text-black grid place-items-center">
                    <f.icon size={14} />
                  </span>
                  <p className="mt-2 text-xs font-bold text-white leading-none">{f.k}</p>
                  <p className="text-[11px] font-semibold tracking-wide uppercase text-white/55">{f.v}</p>
                </div>
              ))}
            </motion.div>
          </div>

          {/* bottom — testimonial glass + trust */}
          <div className="space-y-4">
            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[20px] bg-white/[0.07] backdrop-blur-xl border border-white/10 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.06)]"
            >
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-full bg-white text-black grid place-items-center shrink-0">
                  <Quote size={14} />
                </span>
                <p className="text-[13px] leading-relaxed text-white/90">
                  “We stopped forwarding timetables on WhatsApp. Students check at 8:45, not 9:15.” — shipped in one board.
                </p>
              </div>
              <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
                <img
                  src="https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&q=80&auto=format&fit=crop&crop=face"
                  srcSet="https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&q=80&auto=format&fit=crop&crop=face 1x, https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&q=80&auto=format&fit=crop&crop=face 2x"
                  alt="Prof. Meera Rao, Head of CSE"
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded-full object-cover border border-white/15"
                  loading="lazy"
                  decoding="async"
                />
                <div>
                  <p className="text-xs font-bold leading-none text-white">Prof. Meera Rao</p>
                  <p className="text-[11px] text-white/60">Head, CSE · North Court</p>
                </div>
                <span className="ml-auto hidden sm:inline-flex items-center gap-1 rounded-full bg-[#1ed760] text-black text-[11px] font-extrabold px-2.5 py-1">
                  <CheckCircle2 size={12} /> Verified
                </span>
              </div>
            </motion.div>

            {/* trust strip */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1.5 font-semibold">
                <Shield size={12} className="text-[#1ed760]" /> Trusted by 40+ colleges
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] border border-white/10 text-white/70 px-3 py-1.5 backdrop-blur">
                12k+ students · 98% parse accuracy
              </span>
              <span className="ml-auto hidden xl:inline-flex items-center gap-1.5 text-white/45">
                <MapPin size={12} /> The Quad — North Court
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT — Form bento ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-10 relative overflow-hidden min-h-[100dvh] lg:min-h-screen bg-[#f6f6f6] dark:bg-black">
        {/* subtle green wash — Brand #1ed760 5% */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-28 -right-28 w-[520px] h-[520px] rounded-full bg-[#1ed760]/[0.06] blur-[72px]" />
          <div className="absolute -bottom-40 -left-28 w-[600px] h-[600px] rounded-full bg-[#1db954]/[0.05] blur-[80px]" />
        </div>

        <motion.div
          initial={shouldReduce ? undefined : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-[440px]"
        >
          {/* mobile masthead — hidden on lg because left hero carries it */}
          <div className="flex lg:hidden items-center gap-3 mb-6">
            {/* WHY brand kit v1.0: auto swaps primary/reversed for light/dark, 38px desktop / 32px mobile. */}
            <BrandLogo variant="auto" height={38} />
            <span>
              <span className="block text-[10px] font-bold tracking-[0.14em] uppercase text-zinc-500 dark:text-zinc-400">Hall 01 · Campus OS</span>
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1ed760]" /> System live
            </span>
          </div>

          {/* card — rounded-[24px] bento, brass rule #1ed760 */}
          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-zinc-200 dark:border-[#282828] shadow-[0_16px_48px_-16px_rgba(0,0,0,0.18)] overflow-hidden">
            <div className="h-[3px] bg-gradient-to-r from-[#1ed760] via-[#1ed760] to-[#1db954]" />
            <div className="px-6 sm:px-7 pt-7 pb-2">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-300">
                  <LogIn size={12} /> Library Card — Sign In
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[#1ed760]/10 border border-[#1ed760]/20 text-[#0a7a3a] dark:text-[#1ed760] px-2.5 py-1 text-[11px] font-bold">
                  14s setup
                </span>
              </div>
              <h1 className="mt-4 font-display font-extrabold tracking-[-0.03em] leading-none text-[#0a0a0a] dark:text-white text-[30px]">Welcome back</h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Use your campus credentials to enter the quad. Secure, scoped, and fast.</p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="px-6 sm:px-7 pb-7 space-y-4">
              {/* Social auth — glass outline (visual trust, disabled until OAuth wired) */}
              {/* WHY: correct brand icons (was "G" text + Eye-as-GitHub, wrong). Lucide Chrome/Github are the Simple-Icons-equivalent glyphs. */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => toast('Google SSO coming soon — use email for now')}
                  aria-label="Continue with Google (coming soon)"
                  className="inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1a1a1a] hover:bg-zinc-50 dark:hover:bg-[#1f1f1f] text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  <Chrome size={16} aria-hidden="true" /> Google
                </button>
                <button
                  type="button"
                  onClick={() => toast('GitHub SSO coming soon')}
                  aria-label="Continue with GitHub (coming soon)"
                  className="inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1a1a1a] hover:bg-zinc-50 dark:hover:bg-[#1f1f1f] text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  <Github size={16} aria-hidden="true" /> GitHub
                </button>
              </div>

              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">or continue with email</span>
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <div className="space-y-4">
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@university.edu"
                  icon={<Mail size={18} />}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (errors.email) setErrors((p) => ({ ...p, email: undefined }))
                  }}
                  error={errors.email}
                  autoComplete="email"
                  inputMode="email"
                  required
                  aria-invalid={!!errors.email}
                  className={errors.email ? '!border-[#ff4b5c] focus:!border-[#ff4b5c] focus:!ring-[#ff4b5c]/20' : ''}
                />
                <Input
                  label="Password"
                  type="password"
                  placeholder="Enter your password"
                  icon={<Lock size={18} />}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (errors.password) setErrors((p) => ({ ...p, password: undefined }))
                  }}
                  error={errors.password}
                  autoComplete="current-password"
                  required
                  aria-invalid={!!errors.password}
                  className={errors.password ? '!border-[#ff4b5c] focus:!border-[#ff4b5c] focus:!ring-[#ff4b5c]/20' : ''}
                />
              </div>

              <div className="flex items-center justify-between gap-4 text-sm">
                {/* WHY: 44px label hit target (was 16px checkbox only, fails 2.5.8). */}
                <label className="inline-flex items-center gap-2 cursor-pointer select-none group min-h-[44px] py-2">
                  <input
                    type="checkbox"
                    className="w-5 h-5 rounded-[6px] border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[#1ed760] focus:ring-[#1ed760]/20 focus:ring-2 shrink-0"
                  />
                  <span className="text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors font-medium">Remember me</span>
                </label>
                {/* WHY: #1ed760 on white is 1.9:1 (fails AA) — body links use #0a7a3a (5.9:1). Dark keeps #1ed760. */}
                <button type="button" onClick={() => toast('Password reset — contact registrar or try SSO')} className="font-semibold text-[#0a7a3a] hover:text-[#07622e] dark:text-[#1ed760] dark:hover:text-[#4be585] transition-colors min-h-[44px] inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded">
                  Forgot password?
                </button>
              </div>

              <Button
                type="submit"
                loading={loading}
                disabled={loading}
                className="w-full !bg-[#0a0a0a] dark:!bg-white !text-white dark:!text-black hover:!bg-[#1a1a1a] dark:hover:!bg-zinc-100 !rounded-xl !h-11 text-[15px] font-bold shadow-[0_8px_24px_rgba(0,0,0,0.12)] active:scale-[0.98] transition-all"
              >
                {!loading && (
                  <>
                    Sign In <ArrowRight size={18} />
                  </>
                )}
              </Button>

              {/* subtle micro proof */}
              <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <Shield size={12} className="text-[#1ed760]" /> Protected by campus SSO · JWT · No cross-college leak
              </div>

              <div className="space-y-2 text-center text-sm">
                <p className="text-zinc-600 dark:text-zinc-300">
                  Don&apos;t have an account?{' '}
                  <Link to="/register" className="font-bold text-[#0a0a0a] dark:text-white hover:text-[#1ed760] dark:hover:text-[#1ed760] underline underline-offset-4 decoration-zinc-300 dark:decoration-zinc-700 hover:decoration-[#1ed760] transition-colors">
                    Create account
                  </Link>
                </p>
                <p className="text-zinc-500 dark:text-zinc-400">
                  Registering a college?{' '}
                  <Link to="/register-college" className="font-semibold text-zinc-700 dark:text-zinc-300 hover:text-[#1ed760] transition-colors">
                    College intake →
                  </Link>
                </p>
              </div>
            </form>

            {/* due-slip footer */}
            <div className="px-6 sm:px-7 py-3.5 bg-zinc-50 dark:bg-[#0a0a0a] border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 font-medium">
                <Clock3 size={12} /> Office hours 9 — 5 IST
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="hidden sm:inline-flex items-center gap-1">
                  <MapPin size={11} /> North Court
                </span>
                <span className="rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 font-bold">ID # CF-2026</span>
              </span>
            </div>
          </div>

          {/* foot note */}
          <p className="mt-4 text-center text-xs text-zinc-600 dark:text-zinc-400">
            Protected by campus SSO · WCAG AA · 14s pinned ·{' '}
            <Link to="/" className="underline underline-offset-4 hover:text-zinc-700 dark:hover:text-zinc-300">
              Back to landing
            </Link>
          </p>

          {/* mobile trust — shown only on < lg */}
          <div className="lg:hidden mt-6 rounded-2xl bg-white dark:bg-[#121212] border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-[#1ed760] text-black grid place-items-center shrink-0">
              <Quote size={14} />
            </span>
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              “We stopped forwarding timetables on WhatsApp.”
              <span className="text-zinc-400 dark:text-zinc-500"> — Prof. Meera Rao · North Court</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
