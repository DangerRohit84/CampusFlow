import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AtSign, Check, X, Loader2, Sparkles, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { userAPI, publicProfileAPI } from '../lib/api'
import toast from 'react-hot-toast'

interface Props {
  open: boolean
  onClose?: () => void
  onSkip?: () => void
  force?: boolean // if true, cannot close without saving — mandatory username (students)
}

function sanitize(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 20)
}
function isValid(u: string) {
  return /^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u) && u.length >= 3 && u.length <= 20
}

export default function UsernameSetupModal({ open, onClose, onSkip, force = true }: Props) {
  const { user, updateUser } = useAuthStore()
  const [username, setUsername] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const debounceRef = useRef<number | null>(null)

  // Escape handling: mandatory students cannot dismiss via Escape; teachers/admins can skip.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (force) {
          // Mandatory modal: prevent dismissal via Escape. Only Save can close.
          e.preventDefault()
          e.stopPropagation()
          toast('Please set a username to continue', { icon: '🔒' })
        } else {
          // Optional: allow dismiss and remember skip
          e.preventDefault()
          e.stopPropagation()
          if (onSkip) onSkip()
          else onClose?.()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, force, onClose, onSkip])

  useEffect(() => {
    if (!open) return
    // load suggestion
    const init = async () => {
      try {
        const r = await userAPI.suggestUsername().catch(() => null)
        if (r?.suggestion) {
          setSuggestion(r.suggestion)
          if (!username) setUsername(r.suggestion)
        } else {
          // fallback via public suggest
          const name = user?.name || ''
          const email = user?.email || ''
          const pub = await publicProfileAPI.suggest(name, email).catch(() => null)
          if (pub?.suggestion) {
            setSuggestion(pub.suggestion)
            if (!username) setUsername(pub.suggestion)
          } else {
            const base = sanitize((name || email.split('@')[0] || 'user').replace(/\s+/g, '_')) || 'user'
            const s = base.length < 3 ? (base + 'user').slice(0, 20) : base
            setSuggestion(s)
            if (!username) setUsername(s)
          }
        }
      } catch {}
    }
    init()
  }, [open]) // eslint-disable-line

  // debounce availability check
  useEffect(() => {
    if (!open) return
    const u = sanitize(username)
    if (!u) { setAvailable(null); setReason(''); return }
    if (!isValid(u)) {
      setAvailable(false)
      setReason('3-20 chars, letters/numbers/_.-, start/end with letter or number')
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      setChecking(true)
      try {
        const r = await userAPI.checkUsername(u).catch(() => null)
        if (r) {
          setAvailable(r.available)
          setReason(r.available ? '' : (r.reason || 'Taken'))
        } else {
          // try public check
          const pub = await publicProfileAPI.check(u).catch(() => null)
          if (pub) { setAvailable(pub.available); setReason(pub.available ? '' : (pub.reason || 'Taken')) }
        }
      } catch {
        setAvailable(null)
      } finally { setChecking(false) }
    }, 400) as unknown as number
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [username, open])

  const handleSave = async () => {
    const u = sanitize(username)
    if (!isValid(u)) { toast.error('Enter a valid username (3-20 chars, letters/numbers/_.-)'); return }
    if (available === false) { toast.error(reason || 'Username not available'); return }
    setSaving(true)
    try {
      const res = await userAPI.setUsername(u)
      const newName = res.username || u
      updateUser({ username: newName } as any)
      toast.success(`Username set to @${newName}`)
      onClose?.()
    } catch (e: any) {
      toast.error(e.response?.data?.error || e.message || 'Failed to save username')
    } finally { setSaving(false) }
  }

  const handleSkip = () => {
    if (onSkip) onSkip()
    else onClose?.()
  }

  if (!open) return null

  const canSave = isValid(sanitize(username)) && available !== false && !checking && !saving

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (force) {
      toast('Please save a username to continue', { icon: '✨' })
      return
    }
    // optional: allow dismiss via backdrop and remember skip
    if (onSkip) onSkip()
    else onClose?.()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={handleBackdropClick}
          aria-hidden={false}
        >
          <motion.div
            initial={{ scale: 0.96, y: 8, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, y: 8, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-md bg-white dark:bg-night-800 rounded-[18px] border border-surface-200 dark:border-night-650 shadow-e3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="username-modal-title"
          >
            {/* header */}
            <div className="px-6 pt-6 pb-4 relative">
              {!force && (
                <button
                  onClick={handleSkip}
                  aria-label="Skip username setup"
                  className="absolute top-4 right-4 w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:text-night-300 dark:hover:text-night-100 dark:hover:bg-night-700 transition-colors"
                >
                  <X size={16} />
                </button>
              )}
              <div className="w-12 h-12 rounded-xl bg-primary-600 dark:bg-[#90B9A4] flex items-center justify-center text-white mb-3">
                <AtSign size={22} />
              </div>
              <h2 id="username-modal-title" className="text-xl font-bold text-surface-900 dark:text-night-50">Choose your username</h2>
              <p className="text-sm text-surface-500 dark:text-night-300 mt-1.5 leading-relaxed pr-6">
                Your profile will be at <span className="font-mono font-semibold text-primary-600 dark:text-[#90B9A4]">/u/{sanitize(username) || suggestion || 'username'}</span>. You can change it later in settings.
              </p>
            </div>

            <div className="px-6 pb-2">
              <label className="text-xs font-bold tracking-widest uppercase text-surface-500 dark:text-night-300">Username</label>
              <div className="mt-2 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-300 font-mono text-sm">@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(sanitize(e.target.value))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSave) handleSave() }}
                  placeholder={suggestion || 'username'}
                  autoFocus
                  className="w-full pl-8 pr-10 py-3 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder:surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-300 font-mono text-sm"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {checking ? <Loader2 size={16} className="animate-spin text-surface-400 dark:text-night-400" /> : available === true ? <Check size={16} className="text-emerald-500" /> : available === false ? <X size={16} className="text-danger-500" /> : null}
                </span>
              </div>
              {/* hint row */}
              <div className="mt-2 min-h-[18px] flex items-center justify-between">
                <span className={`text-xs ${available === true ? 'text-emerald-600 dark:text-emerald-400' : available === false ? 'text-danger-600 dark:text-danger-400' : 'text-surface-400 dark:text-night-300'}`}>
                  {checking ? 'Checking...' : available === true ? 'Available!' : available === false ? (reason || 'Not available') : '3-20 chars, letters/numbers/_.-'}
                </span>
                <span className="text-[11px] text-surface-400 dark:text-night-300">{sanitize(username).length}/20</span>
              </div>

              {/* suggestion chip */}
              {suggestion && suggestion !== sanitize(username) && (
                <button onClick={() => setUsername(suggestion)} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-50 dark:bg-night-700 border border-surface-200 dark:border-night-600 text-xs font-medium text-surface-700 dark:text-night-200 hover:bg-white dark:hover:bg-night-600 transition-colors">
                  <Sparkles size={12} className="text-primary-500" /> Try @{suggestion}
                </button>
              )}
            </div>

            {/* actions — conditional: mandatory (students) has only Save; optional (teacher/admin) has Skip + Save */}
            <div className="px-6 py-5 flex items-center gap-3 bg-surface-50 dark:bg-night-850/50 border-t border-surface-100 dark:border-night-700 mt-4">
              {!force && (
                <button
                  onClick={handleSkip}
                  className="px-5 py-3 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-700 text-surface-700 dark:text-night-200 font-medium text-sm hover:bg-surface-50 dark:hover:bg-night-600 transition-colors"
                >
                  Skip for now
                </button>
              )}
              <button onClick={handleSave} disabled={!canSave}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 dark:bg-[#90B9A4] dark:hover:bg-[#A8C2B3] text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                {saving ? 'Saving...' : 'Save username'} {!saving && <ArrowRight size={16} />}
              </button>
            </div>
            <p className="px-6 pb-4 text-center text-[11px] text-surface-400 dark:text-night-300">
              {force ? 'You need a username to continue. This cannot be skipped.' : 'You can skip and set your username later in settings. We\'ll remind you again in 7 days.'}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
