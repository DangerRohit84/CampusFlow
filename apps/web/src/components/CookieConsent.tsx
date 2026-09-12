import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cookie } from 'lucide-react'
import { initAnalytics } from '../lib/analytics'

const KEY_V2 = 'campusflow-cookie-consent-v2'
const KEY_LEGACY = 'campusflow-cookie-consent'
const CONSENT_VERSION = 2
const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000

export type ConsentReceipt = {
  v: number
  necessary: true
  analytics: boolean
  rum: boolean
  ts: string
  method: 'accept-all' | 'reject-all' | 'save-preferences'
}

function readReceipt(): ConsentReceipt | null {
  try {
    const raw = localStorage.getItem(KEY_V2)
    if (raw) {
      const r = JSON.parse(raw) as ConsentReceipt
      if (r && r.v === CONSENT_VERSION && typeof r.ts === 'string') {
        // Expiry: re-prompt every 6 months
        const age = Date.now() - new Date(r.ts).getTime()
        if (Number.isFinite(age) && age < SIX_MONTHS_MS) return r
        return { ...r, ts: r.ts, expired: true } as unknown as ConsentReceipt
      }
      return null
    }
    // Migrate legacy all-or-nothing choice (v1) — force re-prompt to granular v2
    const legacy = localStorage.getItem(KEY_LEGACY)
    if (legacy === 'accepted' || legacy === 'rejected') return null
    return null
  } catch {
    return null
  }
}

function writeReceipt(r: ConsentReceipt): void {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(r))
    // Keep legacy key in sync for older RUM checks (accept-all => accepted, else rejected)
    try {
      localStorage.setItem(KEY_LEGACY, r.analytics || r.rum ? 'accepted' : 'rejected')
    } catch {}
  } catch {}
}

export function getConsentReceipt(): ConsentReceipt | null {
  const r = readReceipt()
  if (!r) return null
  if ((r as unknown as { expired?: boolean }).expired) return null
  return r
}

/**
 * Granular cookie notice (GDPR/ePrivacy second layer, Art.7 proof).
 * WHY: analytics + RUM require prior granular opt-in (default off).
 * - Necessary always-on (session, theme) — no toggle.
 * - Analytics (Plausible/GA4) toggle + RUM toggle, default off.
 * - Proof: versioned receipt {v, necessary, analytics, rum, ts, method} (timestamp).
 * - Expiry: 6-month re-prompt + version-change re-prompt (v2 forces v1 re-consent).
 * - Equal-weight Accept all / Reject all / Save preferences; footer re-opens via `cookie:settings`.
 * Opt-in gating kept: initAnalytics only when analytics===true; RUM beacon checks receipt.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [rum, setRum] = useState(false)

  useEffect(() => {
    const r = readReceipt()
    const expired = (r as unknown as { expired?: boolean } | null)?.expired === true
    if (!r || expired) {
      const t = window.setTimeout(() => setVisible(true), 1200)
      return () => window.clearTimeout(t)
    }
    if (r.analytics) {
      void initAnalytics()
    }
  }, [])

  useEffect(() => {
    const reopen = () => {
      const r = readReceipt()
      const clean = r && !(r as unknown as { expired?: boolean }).expired ? r : null
      setAnalytics(clean?.analytics ?? false)
      setRum(clean?.rum ?? false)
      setShowPrefs(true)
      setVisible(true)
    }
    window.addEventListener('cookie:settings', reopen)
    return () => window.removeEventListener('cookie:settings', reopen)
  }, [])

  const save = (method: ConsentReceipt['method'], a: boolean, r: boolean) => {
    const receipt: ConsentReceipt = {
      v: CONSENT_VERSION,
      necessary: true,
      analytics: a,
      rum: r,
      ts: new Date().toISOString(),
      method,
    }
    // Proof log: versioned receipt with timestamp + categories + method
    writeReceipt(receipt)
    setVisible(false)
    setShowPrefs(false)
    if (a) void initAnalytics()
  }

  if (!visible) return null

  // WHY trap review: this is a non-modal bottom notice (aria-modal=false), so focus must NOT be trapped —
  // users can keep reading while it is visible; only modal dialogs (CommandPalette, Modals, drawer) trap.
  // z-[9000] keeps it above header/drawer/palette without obscuring header focus (bottom-anchored, 64px scroll-padding handles anchor overlap).
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-[440px] z-[9000] rounded-2xl border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] shadow-e3 p-5"
    >
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-[#1f1f1f] flex items-center justify-center shrink-0" aria-hidden="true">
          <Cookie size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-surface-900 dark:text-white">Cookies, your call</p>
          <p className="mt-1 text-xs leading-relaxed text-surface-600 dark:text-night-300">
            Necessary storage (session, theme) is always on. Analytics (Plausible/GA4) and RUM run only if you
            opt in below. Proof (timestamp, categories, version v{CONSENT_VERSION}) is stored locally and expires after 6 months. See <Link to="/privacy" className="underline underline-offset-4 font-semibold">Privacy</Link>.
          </p>
        </div>
      </div>

      {(showPrefs) && (
        <div className="mt-4 space-y-3 rounded-xl border border-surface-100 dark:border-[#282828] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold">Strictly necessary</p>
              <p className="text-[11px] text-surface-500">Session, theme, workspace. Always on.</p>
            </div>
            <span className="text-[11px] font-bold text-surface-400">Always on</span>
          </div>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-xs font-bold">Analytics</p>
              <p className="text-[11px] text-surface-500">Plausible / GA4 page views. Default off.</p>
            </div>
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="w-5 h-5 rounded cursor-pointer" aria-label="Analytics toggle" />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-xs font-bold">RUM (performance)</p>
              <p className="text-[11px] text-surface-500">LCP/CLS/INP beacon. Default off.</p>
            </div>
            <input type="checkbox" checked={rum} onChange={(e) => setRum(e.target.checked)} className="w-5 h-5 rounded cursor-pointer" aria-label="RUM toggle" />
          </label>
        </div>
      )}

      {!showPrefs ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => save('reject-all', false, false)}
            className="flex-1 min-h-[44px] px-4 rounded-xl border border-surface-200 dark:border-[#282828] text-sm font-semibold text-surface-700 dark:text-white hover:bg-surface-50 dark:hover:bg-[#1f1f1f] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => { setShowPrefs(true) }}
            className="flex-1 min-h-[44px] px-4 rounded-xl border border-surface-200 dark:border-[#282828] text-sm font-semibold hover:bg-surface-50 dark:hover:bg-[#1f1f1f] transition-colors"
          >
            Manage preferences
          </button>
          <button
            type="button"
            onClick={() => save('accept-all', true, true)}
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-sm font-bold hover:bg-[#1a1a1a] dark:hover:bg-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            Accept all
          </button>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => save('reject-all', false, false)}
            className="flex-1 min-h-[44px] px-4 rounded-xl border border-surface-200 text-sm font-semibold hover:bg-surface-50"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => save('save-preferences', analytics, rum)}
            className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-sm font-bold"
          >
            Save preferences
          </button>
        </div>
      )}
      <p className="mt-2 text-[10px] text-surface-500 dark:text-night-400">Consent version v{CONSENT_VERSION} · 6-month expiry · re-prompt on policy change</p>
    </div>
  )
}
