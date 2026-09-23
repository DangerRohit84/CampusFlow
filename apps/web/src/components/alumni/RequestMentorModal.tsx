// components/alumni/RequestMentorModal.tsx — mentorship request composer.
// WHY: backend POST /api/alumni/request accepts {alumniUserId, message, topic}
// only — there is no slots column. Preferred slots are collected as UX-only
// free text and appended to the message payload (server slices to 2000, so the
// combined value is capped client-side too). Topic chips are single-select
// sugar over the one nullable topic string. All errors map to specific toasts
// (409 duplicate, 429 quota, 403 cross-college, 400 validation/unavailable).
import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Send, X } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { alumniAPI, type AlumniProfileCard } from '../../lib/api/resources/alumni'
import { MENTORSHIP_TOPIC_CHIPS, validateMentorshipMessage, validateMentorshipTopic } from '../../lib/alumniGuards'
import { notifyEntityMutated } from '../../lib/entitySync'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface Props {
  open: boolean
  alumni: AlumniProfileCard | null
  onClose: () => void
  onCreated?: () => void
}

const MAX_MESSAGE = 2000

export default function RequestMentorModal({ open, alumni, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open)
  const [topic, setTopic] = useState('')
  const [customTopic, setCustomTopic] = useState('')
  const [goal, setGoal] = useState('')
  const [slots, setSlots] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTopic('')
      setCustomTopic('')
      setGoal('')
      setSlots('')
      setSubmitting(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !alumni) return null

  const mentorName = (alumni.user?.name || '').trim() || 'this alumni'
  const effectiveTopic = (customTopic.trim() || topic.trim()).slice(0, 200)

  const handleSubmit = async () => {
    const topicErr = validateMentorshipTopic(effectiveTopic)
    if (topicErr) {
      toast.error(topicErr)
      return
    }
    const slotsLine = slots.trim() ? `\n\nPreferred slots: ${slots.trim().slice(0, 200)}` : ''
    const message = `${goal.trim()}${slotsLine}`.slice(0, MAX_MESSAGE)
    const msgErr = validateMentorshipMessage(message)
    if (msgErr) {
      toast.error(msgErr)
      return
    }
    setSubmitting(true)
    try {
      await alumniAPI.createRequest({
        alumniUserId: alumni.userId,
        message,
        topic: effectiveTopic || null,
      })
      toast.success(`Request sent to ${mentorName} — they have 3 days to respond`)
      notifyEntityMutated('alumni')
      onCreated?.()
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } }
      const status = err?.response?.status
      const serverMsg = err?.response?.data?.error
      if (status === 409) toast.error(serverMsg || 'You already have a pending request with this alumni')
      else if (status === 429) toast.error(serverMsg || 'Daily request limit reached (5/day) — try tomorrow')
      else if (status === 403) toast.error(serverMsg || 'Cross-college requests are not allowed')
      else if (status === 400) toast.error(serverMsg || 'This alumni is not available right now')
      else toast.error(serverMsg || 'Failed to send request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Request mentorship from ${mentorName}`}
        className="relative w-full max-w-[600px] max-h-[92vh] overflow-hidden rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-[0_24px_64px_rgba(0,0,0,0.3)] flex flex-col"
      >
        <div className="px-6 py-5 border-b border-surface-100 dark:border-white/10 shrink-0 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[18px] font-[800] tracking-[-0.02em] leading-none text-surface-900 dark:text-white">
              Request mentorship
            </h2>
            <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">
              To {mentorName}
              {alumni.company ? ` · ${alumni.company}` : ''} — contact unlocks after they accept
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close request dialog"
            className="w-11 h-11 rounded-full bg-surface-50 dark:bg-white/10 hover:bg-surface-100 dark:hover:bg-white/15 flex items-center justify-center text-surface-500 dark:text-white transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">
              Topic — pick one (optional)
            </label>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Mentorship topic">
              {MENTORSHIP_TOPIC_CHIPS.map((chip) => {
                const active = topic === chip && !customTopic.trim()
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setTopic((prev) => (prev === chip ? '' : chip))
                      setCustomTopic('')
                    }}
                    aria-pressed={active}
                    className={clsx(
                      'px-3.5 min-h-[44px] inline-flex items-center rounded-full text-xs font-bold border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                      active
                        ? 'bg-primary-500 text-black border-primary-500 shadow-sm'
                        : 'bg-surface-50 dark:bg-white/[0.04] border-surface-200 dark:border-white/10 text-surface-600 dark:text-night-300 hover:border-surface-300',
                    )}
                  >
                    {chip}
                  </button>
                )
              })}
            </div>
            <label htmlFor="mentor-custom-topic" className="sr-only">
              Custom topic
            </label>
            <input
              id="mentor-custom-topic"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="Or type your own topic…"
              maxLength={200}
              className="mt-2 w-full px-4 h-11 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>

          <div>
            <label htmlFor="mentor-goal" className="text-xs font-bold text-surface-700 dark:text-night-200">
              Goal — what do you want to learn? <span className="font-medium text-surface-400">*</span>
            </label>
            <textarea
              id="mentor-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              maxLength={MAX_MESSAGE}
              placeholder="e.g. I am a 2nd-year CSE student preparing for placements. I want guidance on DSA order, resume projects, and mock interviews over the next month."
              className="mt-1 w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
            />
            <p className="mt-1 text-[11px] font-medium text-surface-400 dark:text-night-400">
              Minimum 10 characters so mentors get real context. {goal.trim().length}/{MAX_MESSAGE}
            </p>
          </div>

          <div>
            <label htmlFor="mentor-slots" className="text-xs font-bold text-surface-700 dark:text-night-200 inline-flex items-center gap-1.5">
              <CalendarClock size={12} aria-hidden="true" /> Preferred slots (optional)
            </label>
            <input
              id="mentor-slots"
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              placeholder="e.g. Weekends 10am–12pm, or Tue/Thu evenings"
              maxLength={200}
              className="mt-1 w-full px-4 h-11 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-[#6b7280] focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <p className="mt-1 text-[11px] font-medium text-surface-400 dark:text-night-400">
              Added to your message — the mentor confirms a time after accepting.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-surface-100 dark:border-white/10 bg-surface-50/50 dark:bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-5 h-11 rounded-full bg-white dark:bg-white/10 border border-surface-200 dark:border-white/10 text-surface-700 dark:text-white text-sm font-bold hover:bg-surface-50 dark:hover:bg-white/15 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-primary-500 hover:bg-[#1ed760] text-black text-sm font-black shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {submitting ? 'Sending…' : (<><Send size={16} aria-hidden="true" /> Send request</>)}
          </button>
        </div>
      </div>
    </div>
  )
}
