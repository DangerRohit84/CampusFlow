import { useState, useEffect } from 'react'
import { X, Flag, Bug, AlertTriangle, Zap, Shield, Lightbulb, Building2, Globe, Send, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { reportAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import clsx from 'clsx'

type Props = { open: boolean; onClose: () => void; onCreated?: () => void }

const ISSUE_TYPES = [
  { value: 'DESIGN', label: 'Design / UI', icon: Lightbulb, hint: 'Layout, colors, typography, responsiveness' },
  { value: 'BUG', label: 'Bug', icon: Bug, hint: 'Feature not working as expected' },
  { value: 'CRASH', label: 'Crash / Error', icon: AlertTriangle, hint: 'App crashes, white screen, 500s' },
  { value: 'PERFORMANCE', label: 'Performance', icon: Zap, hint: 'Slow loading, lag, timeouts' },
  { value: 'SECURITY', label: 'Security', icon: Shield, hint: 'Auth, data leak, permission issue' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request', icon: Flag, hint: 'New idea or improvement' },
  { value: 'OTHER', label: 'Other', icon: Flag, hint: 'Anything else' },
] as const

const PRIORITIES = [
  { value: 'LOW', label: 'Low', color: 'bg-zinc-100 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-white/10' },
  { value: 'MEDIUM', label: 'Medium', color: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20' },
  { value: 'HIGH', label: 'High', color: 'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/20' },
  { value: 'CRITICAL', label: 'Critical', color: 'bg-danger-50 dark:bg-danger-500/15 text-danger-700 dark:text-danger-300 border-danger-200 dark:border-danger-500/20' },
] as const

export default function ReportModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuthStore()
  const [scope, setScope] = useState<'COLLEGE' | 'WEBSITE'>('COLLEGE')
  const [issueType, setIssueType] = useState<string>('BUG')
  const [priority, setPriority] = useState<string>('MEDIUM')
  const [collegeId, setCollegeId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Auto-sync collegeId with user's collegeId — no dropdown needed for COLLEGE scope
  useEffect(() => {
    if (open && user?.collegeId) {
      setCollegeId(user.collegeId)
    }
  }, [open, user?.collegeId])

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setTitle(''); setDescription(''); setAttachmentUrl('')
      setIssueType('BUG'); setPriority('MEDIUM'); setScope(user?.collegeId ? 'COLLEGE' : 'WEBSITE')
      if (user?.collegeId) setCollegeId(user.collegeId)
    }
  }, [open, user?.collegeId])

  // Prefill default scope on open
  useEffect(() => {
    if (open) {
      setScope(user?.collegeId ? 'COLLEGE' : 'WEBSITE')
      if (user?.collegeId) setCollegeId(user.collegeId)
    }
  }, [open])

  const handleSubmit = async () => {
    if (!title.trim() || title.trim().length < 5) { toast.error('Title must be at least 5 characters'); return }
    if (!description.trim() || description.trim().length < 10) { toast.error('Description must be at least 10 characters'); return }
    // For COLLEGE scope, automatically use user's collegeId without dropdown
    const effectiveCollegeId = scope === 'COLLEGE' ? (user?.collegeId || collegeId) : (collegeId || user?.collegeId || null)
    if (scope === 'COLLEGE' && !effectiveCollegeId) { toast.error('Your account is not linked to a college — contact admin'); return }
    setSubmitting(true)
    try {
      await reportAPI.create({
        scope,
        issueType,
        collegeId: effectiveCollegeId,
        title: title.trim(),
        description: description.trim(),
        priority,
        attachmentUrl: attachmentUrl.trim() || null,
      })
      toast.success(scope === 'COLLEGE' ? 'College report submitted — admin will review' : 'Website report submitted — super admin will review')
      onCreated?.()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to submit report')
    } finally { setSubmitting(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[640px] max-h-[92vh] overflow-hidden rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-[0_24px_64px_rgba(0,0,0,0.3)] flex flex-col">
        {/* Header — premium gradient */}
        <div className="relative overflow-hidden px-6 py-5 border-b border-surface-100 dark:border-white/10 shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.08] via-transparent to-emerald-500/[0.06]" />
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary-500/10 rounded-full blur-[30px]" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shadow">
                <Flag size={18} />
              </span>
              <div>
                <h2 className="font-display text-[18px] font-[800] tracking-[-0.02em] leading-none text-surface-900 dark:text-white">Report an Issue</h2>
                <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">College or website — design, bug, crash, performance, security, feature request</p>
              </div>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-surface-50 dark:bg-white/10 hover:bg-surface-100 dark:hover:bg-white/15 flex items-center justify-center text-surface-500 dark:text-white transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Scope — College vs Website */}
          <div>
            <label className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Scope — where is the issue?</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setScope('COLLEGE')}
                className={clsx('relative flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all',
                  scope === 'COLLEGE'
                    ? 'bg-primary-500 text-black border-primary-500 shadow'
                    : 'bg-surface-50 dark:bg-white/[0.04] border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-200 hover:border-surface-300 dark:hover:border-white/15'
                )}
              >
                <span className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', scope === 'COLLEGE' ? 'bg-black text-white' : 'bg-white dark:bg-[#0a0a0a] border border-surface-200 dark:border-white/10')}><Building2 size={16} /></span>
                <span className="flex-1">
                  <span className="block text-sm font-black">College</span>
                  <span className={clsx('block text-[11px] font-medium', scope === 'COLLEGE' ? 'text-black/70' : 'text-surface-500 dark:text-night-400')}>Campus-specific</span>
                </span>
              </button>
              <button
                onClick={() => setScope('WEBSITE')}
                className={clsx('relative flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all',
                  scope === 'WEBSITE'
                    ? 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black border-black dark:border-white shadow'
                    : 'bg-surface-50 dark:bg-white/[0.04] border-surface-200 dark:border-white/10 text-surface-700 dark:text-night-200 hover:border-surface-300 dark:hover:border-white/15'
                )}
              >
                <span className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', scope === 'WEBSITE' ? 'bg-white dark:bg-black text-black dark:text-white' : 'bg-white dark:bg-[#0a0a0a] border border-surface-200 dark:border-white/10')}><Globe size={16} /></span>
                <span className="flex-1">
                  <span className="block text-sm font-black">Website</span>
                  <span className={clsx('block text-[11px] font-medium', scope === 'WEBSITE' ? 'text-white/60 dark:text-black/60' : 'text-surface-500 dark:text-night-400')}>Platform-wide</span>
                </span>
              </button>
            </div>
          </div>

          {/* Issue Type — only for WEBSITE */}
          {scope === 'WEBSITE' && (
            <div>
              <label className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">What is the problem about?</label>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ISSUE_TYPES.map(t => {
                  const Icon = t.icon
                  const active = issueType === t.value
                  return (
                    <button
                      key={t.value}
                      onClick={() => setIssueType(t.value)}
                      className={clsx('flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                        active
                          ? 'bg-primary-50 dark:bg-primary-500/15 border-primary-200 dark:border-primary-500/20 shadow-sm'
                          : 'bg-surface-50 dark:bg-white/[0.03] border-surface-100 dark:border-white/10 hover:border-surface-200 dark:hover:border-white/15'
                      )}
                    >
                      <span className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border',
                        active ? 'bg-primary-500 text-black border-primary-500' : 'bg-white dark:bg-[#0a0a0a] border-surface-200 dark:border-white/10 text-surface-600 dark:text-night-300'
                      )}>
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={clsx('block text-sm font-bold leading-none', active ? 'text-surface-900 dark:text-white' : 'text-surface-700 dark:text-night-200')}>{t.label}</span>
                        <span className="block text-[11px] font-medium text-surface-500 dark:text-night-400 mt-0.5 leading-snug truncate">{t.hint}</span>
                      </span>
                      {active && <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Priority — only for WEBSITE */}
          {scope === 'WEBSITE' && (
            <div>
              <label className="text-[11px] font-black tracking-widest uppercase text-surface-400 dark:text-night-400">Priority</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRIORITIES.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPriority(p.value)}
                    className={clsx('px-4 h-9 rounded-full text-xs font-black border transition-all',
                      priority === p.value ? p.color + ' shadow-sm ring-1 ring-black/5 dark:ring-white/10' : 'bg-white dark:bg-white/[0.04] border-surface-200 dark:border-white/10 text-surface-600 dark:text-night-300 hover:border-surface-300'
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-bold text-surface-700 dark:text-night-200">Title <span className="font-medium text-surface-400">*</span></label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={issueType === 'DESIGN' ? 'e.g., Button overlaps on mobile — Hackathon detail' : issueType === 'BUG' ? 'e.g., Attendance save fails with 500' : 'e.g., Page crashes when opening Reports'}
              maxLength={200}
              className="mt-1 w-full px-4 h-11 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <p className="mt-1 text-[11px] font-medium text-surface-400 dark:text-night-400">{title.length}/200 · Keep it specific like a GitHub issue title.</p>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-bold text-surface-700 dark:text-night-200">Description <span className="font-medium text-surface-400">*</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={`Steps to reproduce:\n1. Go to ...\n2. Click ...\n3. See error\n\nExpected: ...\nActual: ...\nBrowser / device:\nURL:`}
              rows={5}
              className="mt-1 w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
            />
            <p className="mt-1 text-[11px] font-medium text-surface-400 dark:text-night-400">Include expected vs actual, URL, and browser. For design, mention viewport.</p>
          </div>

          {/* Attachment */}
          <div>
            <label className="text-xs font-bold text-surface-700 dark:text-night-200 inline-flex items-center gap-1.5"><ImageIcon size={12} /> Screenshot link (optional)</label>
            <input
              value={attachmentUrl}
              onChange={e => setAttachmentUrl(e.target.value)}
              placeholder="https://... (upload to imgbb/cloudinary and paste link)"
              className="mt-1 w-full px-4 h-11 rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <p className="mt-1 text-[11px] font-medium text-surface-400 dark:text-night-400">Pro tip: Drag screenshot to a host like Imgur/ImgBB and paste URL. College/Super Admin can open it from the report detail.</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-surface-100 dark:border-white/10 bg-surface-50/50 dark:bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
          <button onClick={onClose} disabled={submitting} className="px-5 h-11 rounded-full bg-white dark:bg-white/10 border border-surface-200 dark:border-white/10 text-surface-700 dark:text-white text-sm font-bold hover:bg-surface-50 dark:hover:bg-white/15 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-primary-500 hover:bg-[#1ed760] text-black text-sm font-black shadow disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting...' : <><Send size={16} /> Submit Report</>}
          </button>
        </div>
      </div>
    </div>
  )
}
