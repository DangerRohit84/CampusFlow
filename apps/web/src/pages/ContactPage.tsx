import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, Mail, CircleCheck, TriangleAlert, LogIn } from 'lucide-react'
import PublicPageShell from '../components/PublicPageShell'
import Input from '../components/ui/Input'
import { reportAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'

const TOPICS = [
  { value: 'BUG', label: 'Bug report' },
  { value: 'FEATURE_REQUEST', label: 'Feature request' },
  { value: 'DESIGN', label: 'Design / UI feedback' },
  { value: 'PERFORMANCE', label: 'Performance issue' },
  { value: 'SECURITY', label: 'Security concern' },
  { value: 'OTHER', label: 'Something else' },
]

/**
 * Public contact form. Signed-in submissions are filed as WEBSITE-scope
 * reports via POST /api/reports (same pipeline as the in-app ReportModal).
 * Signed-out visitors get a sign-in nudge + direct email fallback since
 * /api/reports requires authentication.
 */
export default function ContactPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [topic, setTopic] = useState('OTHER')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [authBlocked, setAuthBlocked] = useState(false)

  const validate = () => {
    const e: Record<string, string> = {}
    if (name.trim().length < 2) e.name = 'Please tell us your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email so we can reply.'
    if (subject.trim().length < 5) e.subject = 'Subject must be at least 5 characters.'
    if (message.trim().length < 10) e.message = 'Message must be at least 10 characters.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setAuthBlocked(false)
    try {
      await reportAPI.create({
        scope: 'WEBSITE',
        issueType: topic,
        title: subject.trim(),
        description: `From ${name.trim()} <${email.trim()}>\n\n${message.trim()}`,
        priority: topic === 'SECURITY' ? 'HIGH' : 'MEDIUM',
      })
      setDone(true)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401) {
        // /api/reports is auth-only — keep the draft, offer sign-in + email fallback.
        setAuthBlocked(true)
      } else {
        setErrors({ form: 'Could not send right now. Please try again or email us directly.' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <PublicPageShell>
        <div className="max-w-[560px] mx-auto text-center py-8">
          <span className="w-14 h-14 rounded-2xl bg-[#1ed760]/15 text-[#128a3e] dark:text-[#1ed760] grid place-items-center mx-auto" aria-hidden="true">
            <CircleCheck size={28} />
          </span>
          <h1 className="mt-5 font-semibold text-[28px]" style={{ fontFamily: 'Fraunces, serif' }}>Message received.</h1>
          <p className="mt-3 text-[15px] text-zinc-600 dark:text-zinc-400">
            Filed as a website report — our team triages within 2 business days. We&apos;ll reply to {email}.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/" className="inline-flex items-center justify-center rounded-full px-6 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] transition-colors">Back home</Link>
            <Link to="/help" className="inline-flex items-center justify-center rounded-full px-6 h-11 font-semibold text-sm border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">Browse help</Link>
          </div>
        </div>
      </PublicPageShell>
    )
  }

  return (
    <PublicPageShell>
      <div className="max-w-[640px] mx-auto">
        <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Contact</p>
        <h1 className="mt-2 font-semibold tracking-[-0.02em] text-[32px]" style={{ fontFamily: 'Fraunces, serif' }}>Talk to a human.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Support, sales, security or feedback — file it here and it lands in the same tracked
          pipeline our admins use. Prefer email?{' '}
          <a href="mailto:hello@campusflow.dev" className="font-semibold underline underline-offset-4 text-zinc-900 dark:text-white">hello@campusflow.dev</a>
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input id="contact-name" label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Singh" error={errors.name} autoComplete="name" />
            <Input id="contact-email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" error={errors.email} autoComplete="email" />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="contact-topic" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Topic</label>
            <select
              id="contact-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 transition-colors"
            >
              {TOPICS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <Input id="contact-subject" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g., Timetable photo fails to parse" error={errors.subject} maxLength={200} />
          <Input id="contact-message" label="Message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What happened, what you expected, and where (URL, browser)…" error={errors.message} hint="Include steps to reproduce — it halves triage time." />

          {errors.form && (
            <p role="alert" className="text-sm text-danger-600 flex items-center gap-2">
              <TriangleAlert size={16} aria-hidden="true" /> {errors.form}
            </p>
          )}
          {authBlocked && (
            <div role="alert" className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2"><LogIn size={16} aria-hidden="true" /> Filing reports needs an account — your draft is kept.</span>
              <Link to="/login" className="font-bold underline underline-offset-4">Sign in and resend</Link>
              <span aria-hidden="true">·</span>
              <a href={`mailto:hello@campusflow.dev?subject=${encodeURIComponent(subject || 'CampusFlow contact')}&body=${encodeURIComponent(`From ${name} <${email}>\n\n${message}`)}`} className="font-bold underline underline-offset-4">Send via email instead</a>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full px-7 h-11 font-semibold text-sm text-black bg-[#1ed760] hover:bg-[#1db954] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Sending…' : (<><Send size={16} aria-hidden="true" /> Send message</>)}
          </button>
          {!isAuthenticated && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1.5">
              <Mail size={12} aria-hidden="true" /> Signed out? You can still send — we&apos;ll ask you to sign in or email us.
            </p>
          )}
        </form>
      </div>
    </PublicPageShell>
  )
}
