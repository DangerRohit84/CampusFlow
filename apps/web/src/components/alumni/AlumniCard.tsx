// components/alumni/AlumniCard.tsx — masked directory card (Phase 2).
// WHY: directory list is ALWAYS masked server-side (no per-row ACCEPTED check
// at list scale). This card renders ONLY what the backend returned — masked
// contact stays masked, never reconstructed. Bio/message render as plain text
// (no dangerouslySetInnerHTML — security F2). 44px targets + focus rings +
// dark classes mirror InternshipsPage due-slip pattern.
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, Building2, GraduationCap, Lock, MapPin, MessageCircle, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import Badge from '../ui/Badge'
import type { AlumniProfileCard } from '../../lib/api/resources/alumni'
import { formatResponseRate, isContactMasked, responseRateVariant } from '../../lib/alumniGuards'

interface Props {
  profile: AlumniProfileCard
  onRequest?: (profile: AlumniProfileCard) => void
}

function displayName(p: AlumniProfileCard): string {
  const n = (p.user?.name || '').trim()
  return n || 'Alumni mentor'
}

function initials(name: string): string {
  const t = name.trim()
  if (!t) return 'A'
  const parts = t.split(/\s+/)
  return (parts[0]?.charAt(0) || 'A').toUpperCase()
}

export default function AlumniCard({ profile, onRequest }: Props) {
  const navigate = useNavigate()
  const name = displayName(profile)
  const masked = isContactMasked(profile)
  const rateLabel = formatResponseRate(profile.responseRate)
  const rateVariant = responseRateVariant(profile.responseRate)
  const skills = Array.isArray(profile.skills) ? profile.skills.filter(Boolean).slice(0, 3) : []
  const extraSkills = Array.isArray(profile.skills) && profile.skills.length > 3 ? profile.skills.length - 3 : 0
  const available = profile.isAvailableForMentorship !== false
  const cardLabel = `View alumni profile for ${name}${profile.company ? ` at ${profile.company}` : ''}`

  const open = () => navigate(`/alumni/${encodeURIComponent(profile.userId)}`)

  return (
    <article
      tabIndex={0}
      aria-label={cardLabel}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          // Ignore key events originating from inner buttons (they handle their own actions).
          if ((e.target as HTMLElement)?.closest?.('button')) return
          e.preventDefault()
          open()
        }
      }}
      className="due-slip due-slip--blue p-5 flex flex-col cursor-pointer hover:shadow-e2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="w-11 h-11 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black flex items-center justify-center text-base font-black shrink-0"
        >
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold text-surface-900 dark:text-night-50 leading-tight truncate flex items-center gap-1.5">
            <span className="truncate">{name}</span>
            {profile.isVerified && (
              <span title="Verified alumni" aria-label="Verified alumni">
                <BadgeCheck size={15} className="text-primary-600 dark:text-primary-400 shrink-0" aria-hidden="true" />
              </span>
            )}
          </h3>
          <p className="text-[13px] font-semibold text-surface-600 dark:text-night-300 truncate mt-0.5">
            {[profile.roleTitle, profile.company].filter(Boolean).join(' · ') || 'Alumni'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-surface-500 dark:text-night-400">
            {profile.graduationYear != null && (
              <span className="inline-flex items-center gap-1">
                <GraduationCap size={12} aria-hidden="true" /> Class of {profile.graduationYear}
              </span>
            )}
            {profile.location && (
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin size={12} aria-hidden="true" /> <span className="truncate">{profile.location}</span>
              </span>
            )}
          </div>
        </div>
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-black border shrink-0',
            available
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20'
              : 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700',
          )}
          title={available ? 'Available for mentorship' : 'Not available right now'}
        >
          <span className={clsx('w-1.5 h-1.5 rounded-full', available ? 'bg-emerald-500' : 'bg-zinc-400')} aria-hidden="true" />
          {available ? 'Open' : 'Busy'}
        </span>
      </div>

      {profile.bio && (
        <p className="text-sm text-surface-600 dark:text-night-300 line-clamp-2 mt-3 flex-1">{profile.bio}</p>
      )}

      {(skills.length > 0 || profile.company) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {skills.map((s) => (
            <span
              key={s}
              className="px-2 py-1 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 text-[11px] font-semibold text-surface-600 dark:text-night-300"
            >
              {s}
            </span>
          ))}
          {extraSkills > 0 && (
            <span className="text-[11px] font-bold text-surface-400 dark:text-night-400">+{extraSkills} more</span>
          )}
          {profile.company && (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-sky-700 dark:text-sky-300">
              <Building2 size={12} aria-hidden="true" /> {profile.company}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Badge variant={rateVariant} dot={rateVariant !== 'neutral'}>
          <TrendingUp size={12} aria-hidden="true" /> {rateLabel === 'New' ? 'New mentor' : `${rateLabel} response`}
        </Badge>
        {masked ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-surface-400 dark:text-night-400">
            <Lock size={11} aria-hidden="true" /> Contact hidden until accepted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            Contact unlocked
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-surface-100 dark:border-night-600 pt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
          className="flex-1 min-h-[44px] inline-flex items-center justify-center px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 text-sm font-bold hover:bg-surface-50 dark:hover:bg-night-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          aria-label={`View profile of ${name}`}
        >
          View profile
        </button>
        <button
          type="button"
          disabled={!available}
          onClick={(e) => {
            e.stopPropagation()
            onRequest?.(profile)
          }}
          className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          aria-label={available ? `Request mentorship from ${name}` : `${name} is not available for mentorship`}
          title={available ? 'Request mentorship' : 'Not available right now'}
        >
          <MessageCircle size={15} aria-hidden="true" /> Request
        </button>
      </div>
    </article>
  )
}
