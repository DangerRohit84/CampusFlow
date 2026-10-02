import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Clock, Sparkles, Trash2, Edit3, Check, ChevronLeft, ChevronRight,
  CalendarDays, Upload, FileText, Zap, Image, X, AlertCircle
} from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import CenteredLoader from '../components/ui/CenteredLoader'
import { timetableAPI, taskAPI, scheduleAPI } from '../lib/api'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { useRaceGuard, isAbortError } from '../hooks/useRaceGuard'
import { useConfirm } from '../components/ui/ConfirmModal'
import { showUndoToast } from '../lib/undoToast'
import { mergeTimetableForDate, mergeTimetableForRange, findClashes, validateOverrideInput, GCAL_REPEAT_OPTIONS, GCAL_EDIT_SCOPE_OPTIONS, resolveAddRepeatMode, type GCalRepeat } from '../lib/timetableMerge'

function getActiveProvider() {
  try {
    const configs = JSON.parse(localStorage.getItem('campusflow-ai-configs') || '[]')
    const active = localStorage.getItem('campusflow-active-ai') || ''
    const found = configs.find((c: any) => c.provider === active && c.enabled)
    return found ? { baseUrl: found.baseUrl, apiKey: found.apiKey, model: found.model } : undefined
  } catch { return undefined }
}
import toast from 'react-hot-toast'


const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 14 }, (_, i) => i + 7)

// Timetable handoff normalizer (SSOT for parse/upload review).
// WHY: backend contracts { classes, message } but vision/legacy payloads
// drift (periods/schedules/data keys, bare array). The review list must
// render 42 classes even when the key drifts — a shape mismatch must never
// surface as "Failed to parse timetable" (that toast is reserved for true
// transport/AI failures). Pure + unit-tested in
// src/lib/__tests__/timetableHandoff.test.ts.
export function normalizeTimetableResult(result: unknown): any[] {
  if (Array.isArray(result)) return result
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const list = r.classes ?? r.periods ?? r.schedules ?? r.data ?? []
  return Array.isArray(list) ? list : []
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function addDaysISO(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00.000Z`).getTime() + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}
function toMinutesLocal(t: string | null | undefined): number | null {
  if (!t) return null
  const m = String(t).trim().match(/^(\d{1,2})\s*:\s*(\d{2})\s*([AP]M)?$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ap = (m[3] || '').toUpperCase()
  if (ap) {
    if (h < 1 || h > 12) return null
    h = ap === 'AM' ? h % 12 : (h % 12) + 12
  } else if (h < 0 || h > 23) return null
  if (min < 0 || min > 59) return null
  return h * 60 + min
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<any[]>([])
  const [overrides, setOverrides] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1)
  // Editable Period Grid — view toggle Weekly | Range
  const [viewMode, setViewMode] = useState<'weekly' | 'range'>('weekly')
  const [rangeFrom, setRangeFrom] = useState(() => toISODate(new Date()))
  const [rangeTo, setRangeTo] = useState(() => addDaysISO(toISODate(new Date()), 6))
  const [rangeEntries, setRangeEntries] = useState<any[]>([])
  const [rangeLoading, setRangeLoading] = useState(false)

  // Upload modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadMode, setUploadMode] = useState<'image' | 'text'>('text')
  const [timetableText, setTimetableText] = useState('')
  const [parsedClasses, setParsedClasses] = useState<any[]>([])
  const [parsing, setParsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [offlineOcrLoading, setOfflineOcrLoading] = useState(false)
  const [saveClearOverrides, setSaveClearOverrides] = useState(false)
  const { confirm: confirmDialog } = useConfirm()

  // Add Class modal — GCal-aligned Repeats (Does not repeat / Daily / Weekly).
  // WHY GCal model: manual adding follows Google Calendar "Does not repeat"
  // dropdown mental model; Weekly maps to recurring template (infinite, like
  // upload), Daily / Does not repeat map to dated TEMP overrides (62d cap).
  // Monthly omitted V1 (weekly template + 62d range cap, no new tables).
  const [addOpen, setAddOpen] = useState(false)
  const [addRepeat, setAddRepeat] = useState<GCalRepeat>('weekly')
  const [addForm, setAddForm] = useState({ title: '', course: '', location: '', teacher: '', dayOfWeek: 0, startTime: '09:00', endTime: '10:00', type: 'CLASS', validFrom: toISODate(new Date()), validUntil: addDaysISO(toISODate(new Date()), 5) })
  const [addSaving, setAddSaving] = useState(false)

  // Edit modal — scope radio Every week vs Only this range
  const [editOpen, setEditOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [editScope, setEditScope] = useState<'every' | 'range'>('every')
  const [editForm, setEditForm] = useState({ title: '', course: '', location: '', teacher: '', dayOfWeek: 0, startTime: '09:00', endTime: '10:00', type: 'CLASS' })
  const [editRange, setEditRange] = useState({ validFrom: toISODate(new Date()), validUntil: addDaysISO(toISODate(new Date()), 5) })
  const [editSaving, setEditSaving] = useState(false)

  // Delete scope modal — Every week vs Only this range
  const [delOpen, setDelOpen] = useState(false)
  const [delTarget, setDelTarget] = useState<any>(null)
  const [delScope, setDelScope] = useState<'every' | 'range'>('every')
  const [delRange, setDelRange] = useState({ validFrom: toISODate(new Date()), validUntil: addDaysISO(toISODate(new Date()), 5) })
  const [delSaving, setDelSaving] = useState(false)

  // Offline OCR fallback — tesseract.js on demand (backend vision is primary).
  const handleOfflineOcr = async () => {
    if (!file || offlineOcrLoading) return
    setOfflineOcrLoading(true)
    try {
      const url = URL.createObjectURL(file)
      try {
        const { offlineOcrFallback } = await import('../lib/heavyLazy')
        const text = await offlineOcrFallback(url)
        if (String(text || '').trim()) {
          setUploadMode('text')
          setTimetableText(String(text).slice(0, 8000))
          toast.success('Offline OCR extracted text — review and Parse')
        } else {
          toast.error('Offline OCR found no text — try a clearer photo')
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      toast.error('Offline OCR unavailable — check connection and retry')
    } finally {
      setOfflineOcrLoading(false)
    }
  }

  // Task modal
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', startTime: '09:00', endTime: '10:00', category: 'personal', priority: 'MEDIUM' })

  const { newRequest, isCurrent } = useRaceGuard()

  const load = async () => {
    const { signal, seq } = newRequest()
    try {
      const [s, t, o] = await Promise.all([
        timetableAPI.getAll({ signal }),
        taskAPI.getToday(signal),
        scheduleAPI.listOverrides({ signal }).catch(() => []),
      ])
      if (!isCurrent(seq) || signal.aborted) return
      setSchedules(Array.isArray(s) ? s : [])
      setTasks(Array.isArray(t) ? t : [])
      setOverrides(Array.isArray(o) ? o : [])
    } catch (e: any) {
      if (isAbortError(e, signal)) return
    }
    if (isCurrent(seq) && !signal.aborted) setLoading(false)
  }

  const loadRange = async (from: string, to: string) => {
    setRangeLoading(true)
    try {
      // Prefer server merge (single source); fall back to client merge offline.
      const merged = await timetableAPI.getRange(from, to).catch(() => null)
      if (Array.isArray(merged)) {
        setRangeEntries(merged)
      } else {
        setRangeEntries(mergeTimetableForRange(schedules, overrides, from, to))
      }
    } finally {
      setRangeLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (viewMode === 'range' && rangeFrom && rangeTo && rangeFrom <= rangeTo) {
      loadRange(rangeFrom, rangeTo)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, rangeFrom, rangeTo, schedules, overrides])

  // STATE-SYNC: timetable + task changes from any surface (planner, dashboard,
  // other device) refresh the period grid without navigation.
  useEntitySync(['schedule', 'task'], load)

  const dayClasses = useMemo(() => schedules.filter((s) => s.dayOfWeek === selectedDay).sort((a, b) => a.startTime.localeCompare(b.startTime)), [schedules, selectedDay])
  const dayTasks = useMemo(() => tasks.filter((t) => t.startTime && !t.completed), [tasks])

  // Merge classes + tasks into timeline
  const timeline = useMemo(() => {
    const items: any[] = []
    dayClasses.forEach((c) => items.push({ ...c, _type: 'class' }))
    dayTasks.forEach((t) => items.push({ id: t.id, title: t.title, startTime: t.startTime, endTime: t.endTime, location: t.location, _colorClass: 'border-l-violet-600 dark:border-l-violet-400', _type: 'task', _data: t }))
    items.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
    return items
  }, [dayClasses, dayTasks])

  // Parse timetable
  const handleParse = async () => {
    if (uploadMode === 'text' && !timetableText.trim()) { toast.error('Enter your timetable text'); return }
    if (uploadMode === 'image' && !file) { toast.error('Select an image'); return }

    setParsing(true)
    try {
      let result
      if (uploadMode === 'image' && file) {
        const provider = getActiveProvider()
        result = await timetableAPI.uploadImage(file, provider)
      } else {
        result = await timetableAPI.parseText(timetableText)
      }
      const list = normalizeTimetableResult(result)
      setParsedClasses(list)
      if (list.length === 0) toast.error((result as any)?.message || 'No classes found. Try a different format.')
    } catch (e: any) {
      const backendMsg = e?.response?.data?.error || e?.response?.data?.message
      const msg = String(e?.message || '')
      const isTimeout = e?.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('exceeded')
      toast.error(backendMsg || (isTimeout ? 'Parse timed out — vision takes up to 60s for large timetables, please retry' : 'Failed to parse timetable'))
    } finally {
      setParsing(false)
    }
  }

  // Save parsed classes — clearExisting wipes TEMPLATES ONLY (overrides survive
  // re-uploads). Checkbox "Also clear temporary edits" maps to clearOverrides.
  const handleSaveClasses = async () => {
    if (parsedClasses.length === 0) return
    setUploading(true)
    try {
      await timetableAPI.save(parsedClasses, true, saveClearOverrides)
      toast.success(`${parsedClasses.length} classes saved!${saveClearOverrides ? '' : ' (temporary edits preserved)'}`)
      setUploadModalOpen(false); setParsedClasses([]); setTimetableText(''); setFile(null); setSaveClearOverrides(false)
      // LISTENER-OWNS-REFETCH (AssignmentDetailPage precedent): notify reloads
      // the grid via useEntitySync(['schedule','task']) — a direct load() here
      // would double-fetch (direct + listener).
      notifyEntityMutated('schedule', { action: 'saved' })
    } catch { toast.error('Failed to save') }
    setUploading(false)
  }

  // Delete opens scope modal (Every week vs Only this range) — not immediate.
  const handleDeleteClass = async (item: any) => {
    if (!item?.id) return
    // Temporary dated entries delete directly (they ARE the override).
    if (item._temp || item._overrideKind === 'TEMP') {
      const ok = await confirmDialog({ title: 'Delete temporary class?', message: `Delete "${item?.title}" (${item?.date || 'dated'})?`, confirmLabel: 'Delete' })
      if (!ok) return
      try {
        await scheduleAPI.deleteOverride(item._overrideId || item.id)
        toast.success('Temporary class deleted')
        notifyEntityMutated('schedule', { action: 'override-deleted' })
      } catch { toast.error('Failed') }
      return
    }
    setDelTarget(item)
    setDelScope('every')
    setDelRange({ validFrom: rangeFrom, validUntil: rangeTo })
    setDelOpen(true)
  }

  const handleConfirmDeleteScope = async () => {
    if (!delTarget?.id) return
    setDelSaving(true)
    try {
      if (delScope === 'every') {
        const snapshot = { ...delTarget }
        await scheduleAPI.delete(delTarget.id)
        notifyEntityMutated('schedule', { scheduleId: delTarget.id, action: 'deleted' })
        showUndoToast('Class deleted (every week)', async () => {
          const { id: _id, _type: _t, _colorClass: _c, _data: _d, date: _dt, _overrideKind: _ok, _overrideId: _oi, _cancelled: _x, _temp: _tp, ...rest } = snapshot
          await timetableAPI.save([rest], false)
          notifyEntityMutated('schedule', { action: 'restored' })
        })
      } else {
        if (delRange.validFrom > delRange.validUntil) { toast.error('Range start must be on or before end'); setDelSaving(false); return }
        const res: any = await scheduleAPI.createOverride({ kind: 'CANCELLED', baseScheduleId: delTarget.id, validFrom: delRange.validFrom, validUntil: delRange.validUntil })
        if (res?.warnings?.length) toast(`Cancelled with ${res.warnings.length} clash warning(s)`, { icon: '⚠️' } as any)
        else toast.success(`Cancelled ${delRange.validFrom} → ${delRange.validUntil}`)
        notifyEntityMutated('schedule', { action: 'override-created' })
      }
      setDelOpen(false); setDelTarget(null)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed')
    }
    setDelSaving(false)
  }

  const openEdit = (item: any) => {
    if (item._temp) {
      // TEMP entries edit their override directly (range scope implied).
      setEditingItem(item)
      setEditScope('range')
      setEditForm({ title: item.title || '', course: item.course || '', location: item.location || '', teacher: item.teacher || '', dayOfWeek: item.dayOfWeek ?? 0, startTime: item.startTime || '09:00', endTime: item.endTime || '10:00', type: item.type || 'CLASS' })
      setEditRange({ validFrom: item.date || rangeFrom, validUntil: item.date || rangeTo })
      setEditOpen(true)
      return
    }
    setEditingItem(item)
    setEditScope('every')
    setEditForm({ title: item.title || '', course: item.course || '', location: item.location || '', teacher: item.teacher || '', dayOfWeek: item.dayOfWeek ?? selectedDay, startTime: item.startTime || '09:00', endTime: item.endTime || '10:00', type: item.type || 'CLASS' })
    setEditRange({ validFrom: rangeFrom, validUntil: rangeTo })
    setEditOpen(true)
  }

  const handleConfirmEdit = async () => {
    if (!editingItem?.id) return
    const sm = toMinutesLocal(editForm.startTime)
    const em = toMinutesLocal(editForm.endTime)
    if (sm === null || em === null || sm >= em) { toast.error('Start time must be before end time'); return }
    setEditSaving(true)
    try {
      if (editScope === 'every' && !editingItem._temp) {
        await scheduleAPI.update(editingItem.id, { ...editForm })
        toast.success('Updated every week')
        notifyEntityMutated('schedule', { action: 'updated' })
      } else {
        if (editRange.validFrom > editRange.validUntil) { toast.error('Range start must be on or before end'); setEditSaving(false); return }
        if (editingItem._temp || editingItem._overrideKind === 'TEMP') {
          await scheduleAPI.updateOverride(editingItem._overrideId || editingItem.id, { ...editForm, validFrom: editRange.validFrom, validUntil: editRange.validUntil, dayOfWeek: null })
          toast.success('Temporary class updated')
        } else {
          const payload = { kind: 'EDITED', baseScheduleId: editingItem.id, ...editForm, validFrom: editRange.validFrom, validUntil: editRange.validUntil }
          const err = validateOverrideInput(payload)
          if (err) { toast.error(err); setEditSaving(false); return }
          const res: any = await scheduleAPI.createOverride(payload)
          if (res?.warnings?.length) toast(`Saved with ${res.warnings.length} clash warning(s)`, { icon: '⚠️' } as any)
          else toast.success(`Edited ${editRange.validFrom} → ${editRange.validUntil}`)
        }
        notifyEntityMutated('schedule', { action: 'override-created' })
      }
      setEditOpen(false); setEditingItem(null)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed')
    }
    setEditSaving(false)
  }

  const handleAdd = async () => {
    const sm = toMinutesLocal(addForm.startTime)
    const em = toMinutesLocal(addForm.endTime)
    if (!addForm.title.trim()) { toast.error('Title required'); return }
    if (sm === null || em === null || sm >= em) { toast.error('Start time must be before end time'); return }
    setAddSaving(true)
    try {
      const mode = resolveAddRepeatMode(addRepeat)
      if (mode === 'weekly-template') {
        await scheduleAPI.create({ title: addForm.title, course: addForm.course, location: addForm.location, teacher: addForm.teacher || undefined, dayOfWeek: addForm.dayOfWeek, startTime: addForm.startTime, endTime: addForm.endTime, type: addForm.type })
        toast.success('Weekly class added — repeats every week')
      } else {
        // GCal Daily / Does not repeat → dated TEMP override (owner-only,
        // clash soft). Does not repeat = single date (validFrom=validUntil).
        const from = addForm.validFrom
        const until = mode === 'single' ? addForm.validFrom : addForm.validUntil
        if (from > until) { toast.error('Range start must be on or before end'); setAddSaving(false); return }
        const payload: any = { kind: 'ADDED_TEMP', title: addForm.title, course: addForm.course, location: addForm.location, teacher: addForm.teacher, type: addForm.type, startTime: addForm.startTime, endTime: addForm.endTime, validFrom: from, validUntil: until, dayOfWeek: null }
        const err = validateOverrideInput(payload)
        if (err) { toast.error(err); setAddSaving(false); return }
        const res: any = await scheduleAPI.createOverride(payload)
        if (res?.warnings?.length) toast(`Added with ${res.warnings.length} clash warning(s)`, { icon: '⚠️' } as any)
        else if (mode === 'single') toast.success(`Added ${from} (does not repeat)`)
        else toast.success(`Added daily ${from} → ${until}`)
      }
      setAddOpen(false)
      setAddForm({ title: '', course: '', location: '', teacher: '', dayOfWeek: 0, startTime: '09:00', endTime: '10:00', type: 'CLASS', validFrom: rangeFrom, validUntil: rangeTo })
      notifyEntityMutated('schedule', { action: 'created' })
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed')
    }
    setAddSaving(false)
  }

  const handleRevert = async (overrideId: string) => {
    if (!overrideId) return
    const ok = await confirmDialog({ title: 'Revert this change?', message: 'Remove the temporary edit/cancellation and restore the weekly template?', confirmLabel: 'Revert' })
    if (!ok) return
    try {
      await scheduleAPI.deleteOverride(overrideId)
      toast.success('Reverted to weekly template')
      notifyEntityMutated('schedule', { action: 'override-deleted' })
    } catch { toast.error('Failed') }
  }

  const formatTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${h > 12 ? h - 12 : h}:${m?.toString().padStart(2, '0') || '00'} ${h >= 12 ? 'PM' : 'AM'}`
  }

  // Clash warnings for current view (soft, non-blocking)
  const clashWarnings = useMemo(() => {
    if (viewMode === 'range') {
      const byDate = new Map<string, any[]>()
      for (const e of rangeEntries) {
        const k = String((e as any).date || '')
        if (!byDate.has(k)) byDate.set(k, [])
        byDate.get(k)!.push(e)
      }
      const out: any[] = []
      for (const [date, list] of byDate) {
        for (const w of findClashes(list.filter((x: any) => !x._cancelled))) out.push({ date, ...w })
      }
      return out.slice(0, 10)
    }
    return findClashes(timeline.filter((x: any) => x._type === 'class' && !x._cancelled) as any[]).map((w: any) => ({ date: days[selectedDay], ...w }))
  }, [viewMode, rangeEntries, timeline, selectedDay])

  const addFormError = useMemo(() => {
    const sm = toMinutesLocal(addForm.startTime)
    const em = toMinutesLocal(addForm.endTime)
    if (sm === null || em === null) return 'Times must be HH:MM'
    if (sm >= em) return 'Start time must be before end time'
    if (addRepeat === 'daily' && addForm.validFrom > addForm.validUntil) return 'Range start must be on or before end'
    if (!addForm.title.trim()) return 'Title required'
    return null
  }, [addForm, addRepeat])

  const editFormError = useMemo(() => {
    const sm = toMinutesLocal(editForm.startTime)
    const em = toMinutesLocal(editForm.endTime)
    if (sm === null || em === null) return 'Times must be HH:MM'
    if (sm >= em) return 'Start time must be before end time'
    if (editScope === 'range' && editRange.validFrom > editRange.validUntil) return 'Range start must be on or before end'
    if (!editForm.title.trim()) return 'Title required'
    return null
  }, [editForm, editScope, editRange])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-[1280px] mx-auto">
      {/* Header — timetable */}
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
        <div className="h-[3px] bg-primary-600" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center"><CalendarDays size={18} className="text-white" /></div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-slate-800 dark:text-night-50 leading-none">Timetable — Period Grid</h1>
              <p className="text-xs text-surface-500 dark:text-night-400">Weekly template + temporary range edits</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setAddForm({ title: '', course: '', location: '', teacher: '', dayOfWeek: selectedDay, startTime: '09:00', endTime: '10:00', type: 'CLASS', validFrom: rangeFrom, validUntil: rangeTo }); setAddRepeat('weekly'); setAddOpen(true) }}>
              <Plus size={16} /> Add Class
            </Button>
            <Button size="sm" variant="accent" onClick={() => { setUploadModalOpen(true); setParsedClasses([]); setTimetableText(''); setFile(null) }}>
              <Upload size={16} /> Upload Timetable
            </Button>
          </div>
        </div>
        {/* View toggle Weekly | Specific range */}
        <div className="px-5 pb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-surface-100 dark:bg-night-700 p-1 rounded-xl" role="tablist" aria-label="Timetable view">
            <button role="tab" aria-selected={viewMode === 'weekly'} onClick={() => setViewMode('weekly')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'weekly' ? 'bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 shadow-sm' : 'text-surface-500'}`}>Weekly</button>
            <button role="tab" aria-selected={viewMode === 'range'} onClick={() => setViewMode('range')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'range' ? 'bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 shadow-sm' : 'text-surface-500'}`}>Specific range</button>
          </div>
          {viewMode === 'range' && (
            <div className="flex items-center gap-2 text-sm">
              <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} aria-label="Range start" className="px-2 py-1.5 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-surface-900 dark:text-night-50" />
              <span className="text-surface-400">→</span>
              <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} aria-label="Range end" className="px-2 py-1.5 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-surface-900 dark:text-night-50" />
              {rangeFrom > rangeTo && <span className="text-xs text-danger-600">Start must be ≤ end</span>}
            </div>
          )}
          {overrides.length > 0 && <Badge variant="accent">{overrides.length} temporary</Badge>}
        </div>
      </div>

      {/* Clash warnings (soft overlap/room) */}
      {clashWarnings.length > 0 && (
        <div className="rounded-xl border border-warning-200 dark:border-amber-900/40 bg-warning-50 dark:bg-amber-950/30 p-3 flex items-start gap-2" role="alert">
          <AlertCircle size={16} className="text-warning-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="text-xs text-warning-800 dark:text-amber-200">
            <p className="font-semibold mb-1">Clash warning ({clashWarnings.length}) — soft, saving still allowed</p>
            <ul className="space-y-0.5">
              {clashWarnings.slice(0, 5).map((w: any, i: number) => (
                <li key={i}>{w.date ? `${w.date}: ` : ''}{w.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Day Tabs */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex gap-2 overflow-x-auto pb-2">
        {days.map((day, i) => {
          const classCount = schedules.filter((s) => s.dayOfWeek === i).length
          return (
              <button key={day} onClick={() => setSelectedDay(i)}
              className={`flex flex-col items-center px-4 py-3 rounded-xl font-medium transition-all duration-150 shrink-0 min-w-[70px] border ${selectedDay === i ? 'bg-primary-700 text-white dark:bg-primary-500/30 dark:text-primary-200 border-primary-700 dark:border-primary-400 shadow-sm' : 'bg-white dark:bg-night-900 text-surface-600 dark:text-night-300 hover:bg-surface-100 dark:hover:bg-night-700 border-surface-200 dark:border-night-700'}`}>
              <span className="text-[10px] opacity-80">{dayShort[i]}</span>
              <span className="text-lg font-bold mt-0.5">{14 + i}</span>
              {classCount > 0 && selectedDay !== i && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1" />}
            </button>
          )
        })}
      </motion.div>

      {/* Range view — merged dated entries (templates - CANCELLED flag + EDITED/ADDED) */}
      {viewMode === 'range' && (
        <Card padding="none" hover className="overflow-hidden">
          <div className="p-5 pb-3 flex items-center justify-between border-b border-surface-100 dark:border-night-600">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-5 h-5 text-primary-600" />
              <h3 className="font-bold text-surface-900 dark:text-night-50">{rangeFrom} → {rangeTo}</h3>
            </div>
            <Badge variant="primary">{rangeEntries.length} items</Badge>
          </div>
          <div className="p-5">
            {rangeLoading ? (
              <CenteredLoader text="Loading range..." minHeight="min-h-[120px]" />
            ) : rangeEntries.length === 0 ? (
              <p className="text-sm text-surface-500 dark:text-night-400 text-center py-8">No classes in this range — add a temporary class or pick another range.</p>
            ) : (
              <div className="space-y-4">
                {Array.from(new Set(rangeEntries.map((e: any) => e.date))).sort().map((date: string) => {
                  const list = rangeEntries.filter((e: any) => e.date === date)
                  return (
                    <div key={date}>
                      <p className="text-xs font-bold text-surface-500 dark:text-night-400 mb-2">{date}</p>
                      <div className="space-y-2">
                        {list.map((item: any) => (
                          <div key={`${item.date}-${item.id}`} className={`p-3 rounded-xl border-l-4 bg-surface-50 dark:bg-night-800 ${item._cancelled ? 'opacity-70' : ''}`} style={{ borderLeftColor: item.color || '#5c7cfa' }}>
                            <div className="flex items-start justify-between gap-2">
                              <div className={item._cancelled ? 'line-through' : ''}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-bold text-sm text-surface-900 dark:text-night-50">{item.title}</p>
                                  {item._overrideKind === 'TEMP' && <Badge variant="accent">TEMP</Badge>}
                                  {item._overrideKind === 'EDITED' && <Badge variant="primary">EDITED</Badge>}
                                  {item._overrideKind === 'CANCELLED' && <Badge variant="accent">CANCELLED</Badge>}
                                  {!item._overrideKind && <Badge variant="primary">{item.type || 'CLASS'}</Badge>}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-xs text-surface-400 dark:text-night-400 flex items-center gap-1"><Clock size={10} />{item.startTime} - {item.endTime}</span>
                                  {item.location && <span className="text-xs text-surface-400 dark:text-night-400">· {item.location}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {(item._overrideKind === 'TEMP' || item._overrideKind === 'EDITED' || item._cancelled) ? (
                                  <button onClick={() => handleRevert(item._overrideId)} aria-label={`Revert ${item.title}`} className="text-xs font-semibold px-3 py-2 rounded-lg bg-surface-100 dark:bg-night-700 hover:bg-surface-200 dark:hover:bg-night-600">Revert</button>
                                ) : (
                                  <>
                                    <button onClick={() => openEdit(item)} aria-label={`Edit ${item.title}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded text-surface-400 hover:text-primary-600"><Edit3 size={14} /></button>
                                    <button onClick={() => handleDeleteClass(item)} aria-label={`Delete ${item.title}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded text-surface-400 hover:text-danger-600"><Trash2 size={14} /></button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2">
          <Card padding="none" hover className="overflow-hidden">
            <div className="p-5 pb-3 flex items-center justify-between border-b border-surface-100 dark:border-night-600">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-5 h-5 text-primary-600" />
                <h3 className="font-bold text-surface-900 dark:text-night-50">{days[selectedDay]}</h3>
              </div>
              <Badge variant="primary">{timeline.length} items</Badge>
            </div>

            <div className="p-5">
              {loading ? (
                <CenteredLoader text="Loading timetable..." minHeight="min-h-[180px]" />
              ) : timeline.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 bg-surface-100 dark:bg-night-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <CalendarDays className="w-8 h-8 text-surface-400 dark:text-night-400" />
                  </div>
                  <p className="text-surface-500 dark:text-night-400 font-medium mb-2">No classes on {days[selectedDay]}</p>
                  <p className="text-sm text-surface-400 dark:text-night-400 mb-4">Upload your timetable to get started</p>
                  <Button size="sm" variant="accent" onClick={() => setUploadModalOpen(true)}><Upload size={16} /> Upload Timetable</Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {hours.map((hour) => {
                    const hourStr = hour.toString().padStart(2, '0')
                    const itemsAtHour = timeline.filter((t) => t.startTime?.startsWith(hourStr))
                    if (itemsAtHour.length === 0) return null

                    return (
                      <div key={hour} className="flex gap-4 min-h-[60px] group">
                        <div className="w-14 shrink-0 text-right pt-1">
                          <span className="text-xs font-medium text-surface-400 dark:text-night-400">{formatTime(`${hourStr}:00`)}</span>
                        </div>
                        <div className="flex-1 border-l-2 border-surface-100 dark:border-night-600 pl-4 relative">
                          <div className="absolute left-[-5px] top-3 w-2 h-2 rounded-full bg-surface-200 group-hover:bg-primary-400 transition-colors dark:bg-[#282828]" />
                          {itemsAtHour.map((item) => (
                            <motion.div key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                              className={`mb-2 p-3 rounded-xl border-l-4 bg-surface-50 dark:bg-night-800 hover:bg-surface-100 dark:hover:bg-night-700 transition-all group/item cursor-pointer ${item._colorClass ? item._colorClass : item.color ? '' : 'border-l-primary-500 dark:border-l-primary-400'}`}
                              style={item.color ? { borderLeftColor: item.color } : undefined}>
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-sm text-surface-900 dark:text-night-50">{item.title}</p>
                                    <Badge variant={item._type === 'class' ? 'primary' : 'accent'}>{item._type === 'class' ? 'CLASS' : 'TASK'}</Badge>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-surface-400 dark:text-night-400 flex items-center gap-1"><Clock size={10} />{formatTime(item.startTime)} - {formatTime(item.endTime || item.startTime)}</span>
                                    {item.location && <span className="text-xs text-surface-400 dark:text-night-400">· {item.location}</span>}
                                  </div>
                                  {item.teacher && <p className="text-[11px] text-surface-400 dark:text-night-400 mt-1">{/^(Prof|Dr|Mr|Mrs|Ms|Sir|Ma'am)\./i.test(item.teacher) ? '' : 'Prof. '}{item.teacher}</p>}
                                </div>
                                {item._type === 'class' && (
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => openEdit(item)} aria-label={`Edit class ${item.title}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded text-surface-400 dark:text-night-400 hover:text-primary-600 opacity-100 focus-visible:opacity-100 transition-all"><Edit3 size={14} aria-hidden="true" /></button>
                                    <button onClick={() => handleDeleteClass(item)} aria-label={`Delete class ${item.title}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1 rounded text-surface-400 dark:text-night-400 hover:text-danger-600 opacity-100 focus-visible:opacity-100 transition-all"><Trash2 size={14} aria-hidden="true" /></button>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* Right Sidebar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-6">
          {/* Week Overview */}
          <Card hover>
            <h3 className="font-bold text-surface-900 dark:text-night-50 mb-4">Week Overview</h3>
            <div className="space-y-3">
              {days.map((day, i) => {
                const count = schedules.filter((s) => s.dayOfWeek === i).length
                const isSelected = selectedDay === i
                return (
                  <button key={day} onClick={() => setSelectedDay(i)} className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${isSelected ? 'bg-primary-50 dark:bg-sky-950/30 border border-primary-200 dark:border-sky-800/40' : 'hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 border border-transparent'}`}>
                    <span className="text-xs font-medium text-surface-500 dark:text-night-400 w-8">{dayShort[i]}</span>
                    <div className="flex-1 h-5 bg-surface-100 dark:bg-night-700 rounded overflow-hidden">
                      <div className="h-full bg-primary-500 rounded" style={{ width: `${(count / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold text-surface-700 dark:text-night-200 w-6 text-right">{count}</span>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Stats */}
          <Card hover>
            <h3 className="font-bold text-slate-800 dark:text-night-50 mb-4">Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-primary-50 dark:bg-sky-950/30 rounded-xl text-center border border-primary-200 dark:border-sky-900/30">
                <p className="text-2xl font-bold text-primary-700 dark:text-sky-300">{schedules.length}</p>
                <p className="text-[10px] text-primary-600 dark:text-sky-400 font-medium">Total Classes</p>
              </div>
              <div className="p-3 bg-warning-50 dark:bg-amber-950/30 rounded-xl text-center border border-warning-200 dark:border-amber-900/30">
                <p className="text-2xl font-bold text-brass-700 dark:text-amber-300">{new Set(schedules.map((s) => s.course || s.title)).size}</p>
                <p className="text-[10px] text-brass-500 dark:text-amber-400 font-medium">Subjects</p>
              </div>
              <div className="p-3 bg-success-50 dark:bg-emerald-950/30 rounded-xl text-center border border-success-200 dark:border-emerald-900/30">
                <p className="text-2xl font-bold text-success-700 dark:text-emerald-300">{schedules.filter((s) => s.type === 'LAB').length}</p>
                <p className="text-[10px] text-success-600 dark:text-emerald-400 font-medium">Labs</p>
              </div>
              <div className="p-3 bg-surface-50 dark:bg-zinc-900 rounded-xl text-center border border-surface-200 dark:border-zinc-700">
                <p className="text-2xl font-bold text-slate-700 dark:text-zinc-300">{new Set(schedules.map((s) => s.dayOfWeek)).size}</p>
                <p className="text-[10px] text-slate-600 dark:text-zinc-400 font-medium">Days Active</p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Upload Modal */}
      <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Add Timetable" size="lg">
        <div className="space-y-5">
          {/* Mode Toggle */}
          <div className="flex gap-2 bg-surface-100 dark:bg-night-700 p-1 rounded-xl">
            <button onClick={() => setUploadMode('text')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${uploadMode === 'text' ? 'bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 shadow-sm' : 'text-surface-500'}`}>
              <FileText size={16} /> Paste Text
            </button>
            <button onClick={() => setUploadMode('image')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${uploadMode === 'image' ? 'bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 shadow-sm' : 'text-surface-500'}`}>
              <Image size={16} /> Upload Image
            </button>
          </div>

          {uploadMode === 'text' ? (
            <div>
              <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">Paste your timetable text</label>
              <textarea value={timetableText} onChange={(e) => setTimetableText(e.target.value)} rows={10}
                className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all resize-none font-mono"
                placeholder={"Monday:\n9:00-10:30 - Data Structures - Room 301 - Prof. Sharma\n11:00-12:30 - Machine Learning - Hall A\n2:00-4:00 - DB Lab - Lab 204\n\nTuesday:\n9:00-10:30 - Data Structures - Room 301\n11:00-1:00 - ML Lab - Lab 204"} />
              <p className="text-[11px] text-surface-400 dark:text-night-400 mt-1">Format: Day header, then time - subject - room - teacher (one per line)</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">Upload timetable image</label>
              <div className="border-2 border-dashed border-surface-200 dark:border-night-600 rounded-xl p-8 text-center hover:border-primary-300 transition-colors">
                {file ? (
                  <div className="space-y-2">
                    <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mx-auto"><Image size={24} className="text-primary-600" /></div>
                    <p className="text-sm font-medium text-surface-900 dark:text-night-50">{file.name}</p>
                    <button onClick={() => setFile(null)} className="text-xs text-danger-500 hover:text-danger-600">Remove</button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <div className="w-12 h-12 bg-surface-100 dark:bg-night-700 rounded-xl flex items-center justify-center mx-auto mb-3"><Upload size={24} className="text-surface-400 dark:text-night-400" /></div>
                    <p className="text-sm text-surface-500 dark:text-night-400">Click to upload or drag and drop</p>
                    <p className="text-xs text-surface-400 dark:text-night-400 mt-1">JPG, PNG, WebP up to 10MB</p>
                    <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/heic" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-surface-400 dark:text-night-400 mt-2">Requires a vision AI model (OpenAI or Gemini) configured in Settings</p>
            </div>
          )}

          <Button onClick={handleParse} loading={parsing} className="w-full" variant="secondary">
            <Sparkles size={16} /> Parse Timetable
          </Button>
          {uploadMode === 'image' && file && (
            <div className="space-y-1.5">
              <Button onClick={handleOfflineOcr} loading={offlineOcrLoading} disabled={offlineOcrLoading} className="w-full" variant="secondary">
                {offlineOcrLoading ? 'Reading offline…' : 'Try offline OCR (no upload)'}
              </Button>
              <p className="text-[11px] text-surface-400 dark:text-night-400 text-center">Loads tesseract on demand — zero bundle cost until tapped.</p>
            </div>
          )}

          {/* Parsed Results */}
          {parsedClasses.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-surface-900 dark:text-night-50">Found {parsedClasses.length} classes</h4>
                <Badge variant="success">{parsedClasses.length} classes</Badge>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {parsedClasses.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-night-800 rounded-xl">
                    <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 font-bold text-xs">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-night-50 truncate">{c.title}</p>
                      <p className="text-xs text-surface-400 dark:text-night-400">{dayShort[c.dayOfWeek]} {c.startTime}-{c.endTime} · {c.location || 'No location'}</p>
                      {c.teacher && <p className="text-[11px] text-surface-400 dark:text-night-400">{/^(Prof|Dr|Mr|Mrs|Ms|Sir|Ma'am)\./i.test(c.teacher) ? '' : 'Prof. '}{c.teacher}</p>}
                    </div>
                    <Badge variant={c.type === 'LAB' ? 'accent' : 'primary'}>{c.type}</Badge>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-surface-600 dark:text-night-300">
                <input type="checkbox" checked={saveClearOverrides} onChange={(e) => setSaveClearOverrides(e.target.checked)} className="w-4 h-4 rounded" />
                Also clear temporary edits (otherwise temporaries are preserved)
              </label>
              <div className="flex gap-3">
                <Button onClick={handleSaveClasses} loading={uploading} variant="accent" className="flex-1"><Zap size={16} /> Save to Timetable</Button>
              </div>
              <p className="text-xs text-surface-400 dark:text-night-400 text-center">Upload saves weekly templates that automatically repeat every week (like before) — temporary range edits are preserved unless checked</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Add Class Modal — Google Calendar Repeats mental model (V1: Does not repeat / Daily / Weekly) */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Class" size="lg">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="add-repeat" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Repeats</label>
            <select id="add-repeat" value={addRepeat} onChange={(e) => setAddRepeat(e.target.value as GCalRepeat)} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50">
              {GCAL_REPEAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <p className="text-xs text-surface-500 dark:text-night-400">
            {addRepeat === 'weekly'
              ? 'Weekly — repeats every week on the chosen weekday (template, like Google Calendar Weekly — uploads behave the same).'
              : addRepeat === 'daily'
                ? 'Daily — repeats every day inside the date range below (max 62 days). Clash warnings are soft — saving still allowed.'
                : 'Does not repeat — appears once on the date below (like Google Calendar single event).'}
            {' '}Monthly omitted in V1 (weekly template + 62-day range cap).
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Title *" value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} placeholder="e.g. Data Structures" />
            <Input label="Course / code" value={addForm.course} onChange={(e) => setAddForm({ ...addForm, course: e.target.value })} placeholder="CS201" />
            <Input label="Location / room" value={addForm.location} onChange={(e) => setAddForm({ ...addForm, location: e.target.value })} placeholder="Room 301" />
            <Input label="Teacher" value={addForm.teacher} onChange={(e) => setAddForm({ ...addForm, teacher: e.target.value })} placeholder="Prof. Sharma" />
            <div className="space-y-1.5">
              <label htmlFor="add-type" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Type</label>
              <select id="add-type" value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50">
                {['CLASS', 'LAB', 'SEMINAR', 'OTHER'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {addRepeat === 'weekly' && (
              <div className="space-y-1.5">
                <label htmlFor="add-day" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Weekday</label>
                <select id="add-day" value={addForm.dayOfWeek} onChange={(e) => setAddForm({ ...addForm, dayOfWeek: parseInt(e.target.value, 10) })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50">
                  {days.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="add-start" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Start time</label>
              <input id="add-start" type="time" value={addForm.startTime} onChange={(e) => setAddForm({ ...addForm, startTime: e.target.value })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="add-end" className="block text-sm font-semibold text-surface-700 dark:text-night-200">End time</label>
              <input id="add-end" type="time" value={addForm.endTime} onChange={(e) => setAddForm({ ...addForm, endTime: e.target.value })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
            </div>
          </div>

          {addRepeat === 'does-not-repeat' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="add-date" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Date</label>
                <input id="add-date" type="date" value={addForm.validFrom} onChange={(e) => setAddForm({ ...addForm, validFrom: e.target.value, validUntil: e.target.value })} aria-label="Single date (does not repeat)" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
            </div>
          )}
          {addRepeat === 'daily' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="add-from" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Range start (Until from)</label>
                <input id="add-from" type="date" value={addForm.validFrom} onChange={(e) => setAddForm({ ...addForm, validFrom: e.target.value })} aria-label="Daily range start" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="add-until" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Range end (Until date)</label>
                <input id="add-until" type="date" value={addForm.validUntil} onChange={(e) => setAddForm({ ...addForm, validUntil: e.target.value })} aria-label="Daily range end (until date)" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
            </div>
          )}

          {addFormError && <p role="alert" className="text-sm text-danger-600">{addFormError}</p>}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setAddOpen(false)} className="flex-1">Cancel</Button>
            <Button variant="accent" onClick={handleAdd} loading={addSaving} disabled={!!addFormError} className="flex-1"><Plus size={16} /> {addRepeat === 'weekly' ? 'Add Weekly' : addRepeat === 'daily' ? 'Add Daily' : 'Add once'}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal — GCal scope (Every week = All events, Only this range = This / This and following) */}
      <Modal open={editOpen} onClose={() => { setEditOpen(false); setEditingItem(null) }} title={editingItem ? `Edit ${editingItem.title || 'Class'}` : 'Edit Class'} size="lg">
        <div className="space-y-5">
          {editingItem?._temp || editingItem?._overrideKind === 'TEMP' ? (
            <p className="text-xs text-surface-500 dark:text-night-400">Temporary class (Does not repeat / Daily) — range edit only. Deleting removes just this dated entry.</p>
          ) : (
            <fieldset>
              <legend className="text-sm font-semibold text-surface-700 dark:text-night-200 mb-2">Edit scope (like Google Calendar)</legend>
              <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Edit scope">
                {GCAL_EDIT_SCOPE_OPTIONS.map((o) => (
                  <label key={o.value} className={`flex flex-col p-3 rounded-xl border min-h-[44px] cursor-pointer ${editScope === o.value ? 'border-primary-400 bg-primary-50 dark:bg-sky-950/30' : 'border-surface-200 dark:border-night-600'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="edit-scope" value={o.value} checked={editScope === o.value} onChange={() => setEditScope(o.value)} className="w-4 h-4" />
                      <span className="text-sm font-medium">{o.label}</span>
                    </span>
                    <span className="text-[11px] text-surface-400 dark:text-night-400 ml-6">{o.hint}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">Like Google Calendar: Every week = All events (rewrites template); Only this range = This event / This and following (keeps template, saves temporary override for dates below).</p>
            </fieldset>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Title *" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="e.g. Data Structures" />
            <Input label="Course / code" value={editForm.course} onChange={(e) => setEditForm({ ...editForm, course: e.target.value })} placeholder="CS201" />
            <Input label="Location / room" value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} placeholder="Hall B" />
            <Input label="Teacher" value={editForm.teacher} onChange={(e) => setEditForm({ ...editForm, teacher: e.target.value })} placeholder="Prof. Sharma" />
            <div className="space-y-1.5">
              <label htmlFor="edit-type" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Type</label>
              <select id="edit-type" value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50">
                {['CLASS', 'LAB', 'SEMINAR', 'OTHER'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {editScope === 'every' && !(editingItem?._temp || editingItem?._overrideKind === 'TEMP') && (
              <div className="space-y-1.5">
                <label htmlFor="edit-day" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Weekday</label>
                <select id="edit-day" value={editForm.dayOfWeek} onChange={(e) => setEditForm({ ...editForm, dayOfWeek: parseInt(e.target.value, 10) })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50">
                  {days.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="edit-start" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Start time</label>
              <input id="edit-start" type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="edit-end" className="block text-sm font-semibold text-surface-700 dark:text-night-200">End time</label>
              <input id="edit-end" type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
            </div>
          </div>

          {(editScope === 'range' || editingItem?._temp || editingItem?._overrideKind === 'TEMP') && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="edit-from" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Range start</label>
                <input id="edit-from" type="date" value={editRange.validFrom} onChange={(e) => setEditRange({ ...editRange, validFrom: e.target.value })} aria-label="Edit range start" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="edit-until" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Range end</label>
                <input id="edit-until" type="date" value={editRange.validUntil} onChange={(e) => setEditRange({ ...editRange, validUntil: e.target.value })} aria-label="Edit range end" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
            </div>
          )}

          {editFormError && <p role="alert" className="text-sm text-danger-600">{editFormError}</p>}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setEditOpen(false); setEditingItem(null) }} className="flex-1">Cancel</Button>
            <Button variant="accent" onClick={handleConfirmEdit} loading={editSaving} disabled={!!editFormError} className="flex-1"><Check size={16} /> {editScope === 'every' && !(editingItem?._temp || editingItem?._overrideKind === 'TEMP') ? 'Save every week' : 'Save this range'}</Button>
          </div>
        </div>
      </Modal>

      {/* Delete scope Modal — GCal scope (Every week = All events, Only this range = This / This and following → Revert) */}
      <Modal open={delOpen} onClose={() => { setDelOpen(false); setDelTarget(null) }} title={delTarget ? `Delete ${delTarget.title || 'Class'}` : 'Delete Class'} size="md">
        <div className="space-y-5">
          <fieldset>
            <legend className="text-sm font-semibold text-surface-700 dark:text-night-200 mb-2">Delete scope (like Google Calendar)</legend>
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Delete scope">
              {GCAL_EDIT_SCOPE_OPTIONS.map((o) => (
                <label key={o.value} className={`flex flex-col p-3 rounded-xl border min-h-[44px] cursor-pointer ${delScope === o.value ? 'border-danger-300 bg-danger-50 dark:bg-danger-950/20' : 'border-surface-200 dark:border-night-600'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="del-scope" value={o.value} checked={delScope === o.value} onChange={() => setDelScope(o.value)} className="w-4 h-4" />
                    <span className="text-sm font-medium">{o.label}</span>
                  </span>
                  <span className="text-[11px] text-surface-400 dark:text-night-400 ml-6">{o.hint}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">
              {delScope === 'every' ? 'Every week = All events — deletes the weekly template permanently (undo available).' : 'Only this range = This / This and following — cancels the class for the dates below, template stays and entry shows struck-through with Revert.'}
            </p>
          </fieldset>

          {delScope === 'range' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="del-from" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Range start</label>
                <input id="del-from" type="date" value={delRange.validFrom} onChange={(e) => setDelRange({ ...delRange, validFrom: e.target.value })} aria-label="Delete range start" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="del-until" className="block text-sm font-semibold text-surface-700 dark:text-night-200">Range end</label>
                <input id="del-until" type="date" value={delRange.validUntil} onChange={(e) => setDelRange({ ...delRange, validUntil: e.target.value })} aria-label="Delete range end" className="w-full min-h-[44px] px-4 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-surface-900 dark:text-night-50" />
              </div>
            </div>
          )}

          {delScope === 'range' && delRange.validFrom > delRange.validUntil && (
            <p role="alert" className="text-sm text-danger-600">Range start must be on or before end</p>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setDelOpen(false); setDelTarget(null) }} className="flex-1">Cancel</Button>
            <Button variant="danger" onClick={handleConfirmDeleteScope} loading={delSaving} className="flex-1"><Trash2 size={16} /> {delScope === 'every' ? 'Delete every week' : 'Cancel this range'}</Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  )
}
