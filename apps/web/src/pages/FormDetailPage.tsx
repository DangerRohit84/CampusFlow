import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { formAPI } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { motion } from 'framer-motion'
import { ArrowLeft, FileText, Users, Download, Loader2, CheckCircle, Send, Clock, Plus, GraduationCap, BookOpen, ClipboardList, BarChart2, Timer, Award } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { Department } from '../types/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'
import {
  getVisibleFields,
  validateAnswers,
  computeScore,
  computeDropoff,
  formatDurationMs,
  parseFieldOptions,
  parseScoreMap,
  parseFieldLogic,
  isFieldRequiredLive,
} from '../lib/formLogic'

export default function FormDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<any>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [extendDays, setExtendDays] = useState('7')
  // PERPAGE-HALF2: shared 10-min departments key (was uncached getAll per
  // mount); same array data, zero cross-page dedupe before.
  const { data: departmentsData } = useDepartments()
  const departments: Department[] = (departmentsData as Department[]) ?? []
  // Epoch guard (same pattern as HackathonDetailPage): rapid id switches must
  // never let a slow getOne overwrite the current form.
  const loadSeq = useRef(0)
  const [editingFields, setEditingFields] = useState(false)
  const [editFields, setEditFields] = useState<any[]>([])
  const [savingFields, setSavingFields] = useState(false)
  const [expandedEditLogic, setExpandedEditLogic] = useState<Record<number, boolean>>({})
  // #9 logic-lite: teacher Responses/Analytics tabs.
  const [teacherTab, setTeacherTab] = useState<'responses' | 'analytics'>('responses')
  const [analytics, setAnalytics] = useState<any>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  // #9 time-to-complete: respondent open timestamp + viewed questions for drop-off.
  const startedAtRef = useRef<string>(new Date().toISOString())
  const startMsRef = useRef<number>(Date.now())
  const [viewedIds, setViewedIds] = useState<string[]>([])
  const loggedViewsRef = useRef<Set<string>>(new Set())

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isCRofLinkedRoom = user?.role === 'STUDENT' && form?.formRooms?.some(
    (fr: any) => fr.room.members?.some((m: any) => m.studentId === user.id && m.isCR)
  )
  const canEdit = isTeacher || isCRofLinkedRoom
  const isExpired = form?.expiresAt && new Date() > new Date(form.expiresAt)

  // Eligibility computation
  const safeParse = (json: unknown): string[] => {
    try {
      if (Array.isArray(json)) return json
      if (typeof json === 'string') return JSON.parse(json || '[]')
      return []
    } catch { return [] }
  }

  const targetDeptIds: string[] = safeParse(form?.targetDepartments)
  const targetYearsList: number[] = safeParse(form?.targetYears).map(Number)
  const targetDeptNames = targetDeptIds.length > 0 && departments.length > 0
    ? departments.filter(d => targetDeptIds.includes(d.id)).map(d => d.name)
    : []

  const formRooms = form?.formRooms || []

  const isEligible = (() => {
    if (!user || user.role !== 'STUDENT') return true
    
    // Check room-based eligibility
    if (formRooms.length > 0) {
      // Backend handles actual room membership check, but for UI we show the form
      // The backend will reject if not a member
      return true
    }
    
    // Check department/year eligibility
    if (!form?.eligibilityEnabled) return true
    if (targetDeptIds.length > 0 && (!user.departmentId || !targetDeptIds.includes(user.departmentId))) return false
    if (targetYearsList.length > 0 && user.incomingYear) {
      const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
      if (!targetYearsList.includes(currentYear)) return false
    }
    return true
  })()

  // #9 logic-lite: normalized fields + live visibility/scoring.
  // parseFieldOptions also FIXES choice rendering for legacy rows where
  // `options` is a JSON string (raw `.map` on a string renders nothing).
  const logicFields = useMemo(() => {
    const list: any[] = Array.isArray(form?.fields) ? form.fields : []
    return list.map((f: any, i: number) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: !!f.required,
      options: f.options,
      logic: (f as any).logic ?? '{}',
      scoreMap: (f as any).scoreMap ?? '{}',
      order: f.order ?? i,
      _raw: f,
    }))
  }, [form])
  const visibility = useMemo(() => getVisibleFields(logicFields as any, answers as any), [logicFields, answers])
  const visibleFieldRows = useMemo(() => {
    const set = new Set(visibility.visibleIds)
    return (Array.isArray(form?.fields) ? form.fields : []).filter((f: any) => set.has(f.id))
  }, [form, visibility])
  const liveScore = useMemo(() => {
    try { return computeScore(logicFields as any, answers as any).total } catch { return 0 }
  }, [logicFields, answers])
  const maxScore = useMemo(() => {
    try {
      return logicFields.reduce((sum: number, f: any) => {
        const pts = Object.values(parseScoreMap(f as any)).map(Number).filter(Number.isFinite) as number[]
        const positives = pts.filter((v) => v > 0)
        if (String(f.type).toUpperCase() === 'CHECKBOX') return sum + positives.reduce((a, b) => a + b, 0)
        return sum + (pts.length ? Math.max(...pts, 0) : 0)
      }, 0)
    } catch { return 0 }
  }, [logicFields])
  const hiddenCount = logicFields.length - visibleFieldRows.length
  // Client-side drop-off fallback when the analytics endpoint is unreachable.
  const localDropoff = useMemo(() => {
    try { return computeDropoff(logicFields as any, (form?.responses || []) as any) } catch { return [] }
  }, [logicFields, form])


  useEffect(() => {
    if (id) loadForm()
  }, [id])

  const loadForm = async () => {
    const seq = ++loadSeq.current
    try {
      const data = await formAPI.getOne(id!)
      if (seq !== loadSeq.current) return
      setForm(data)
      // #9: reset open-timer + view tracking per form load.
      startedAtRef.current = new Date().toISOString()
      startMsRef.current = Date.now()
      loggedViewsRef.current = new Set()
      setViewedIds([])
      
      // Pre-fill answers if already responded
      const response = data.responses?.find((r: any) => r.userId === user?.id)
      if (response) {
        try {
          setAnswers(typeof response.answers === 'string' ? JSON.parse(response.answers) : (response.answers || {}))
        } catch { setAnswers({}) }
        setSubmitted(true)
      } else {
        setAnswers({})
        setSubmitted(false)
      }
    } catch (err) {
      toast.error('Failed to load form')
      navigate('/forms')
    } finally {
      setLoading(false)
    }
  }

  // STATE-SYNC: external mutations (other tab/device) refresh without reload.
  useEntitySync('form', loadForm as any)

  // #9: track viewed questions for drop-off + fire-and-forget view logs.
  useEffect(() => {
    if (!id || !form || isTeacher) return
    const fresh = visibility.visibleIds.filter((fid) => !loggedViewsRef.current.has(fid))
    if (fresh.length === 0) return
    fresh.forEach((fid) => loggedViewsRef.current.add(fid))
    setViewedIds((prev) => [...prev, ...fresh.filter((fid) => !prev.includes(fid))])
    formAPI.logViews(id as string, fresh)
  }, [id, form, isTeacher, visibility.visibleIds])

  // #9: teacher analytics (drop-off + median time + scores) — lazy per tab.
  const loadAnalytics = async () => {
    if (!id || analyticsLoading) return
    setAnalyticsLoading(true)
    try {
      const data = await formAPI.analytics(id as string)
      setAnalytics(data)
    } catch {
      setAnalytics(null)
    } finally {
      setAnalyticsLoading(false)
    }
  }
  useEffect(() => {
    if (isTeacher && teacherTab === 'analytics' && !analytics && !analyticsLoading) loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeacher, teacherTab])

  const handleSubmit = async () => {
    // #9 hidden-aware validation (skipped branches never block submit).
    try {
      const v = validateAnswers(logicFields as any, answers as any)
      if (!v.ok) {
        const firstKey = Object.keys(v.errors)[0]
        toast.error(v.errors[firstKey] || 'Please fill required fields')
        return
      }
    } catch {
      for (const field of form.fields) {
        if (field.required && !answers[field.id]) {
          toast.error(`"${field.label}" is required`)
          return
        }
      }
    }

    setSubmitting(true)
    try {
      const durationMs = Math.max(0, Date.now() - startMsRef.current)
      const seen = [...new Set([...viewedIds, ...visibility.visibleIds])].slice(0, 100)
      await formAPI.respond(id!, answers, { startedAt: startedAtRef.current, durationMs, viewedFieldIds: seen })
      toast.success(submitted ? 'Response updated!' : 'Response submitted!')
      setSubmitted(true)
      // LISTENER-OWNS-REFETCH (PERPAGE-HALF2, AssignmentDetailPage precedent):
      // notify busts the RQ forms list AND reloads this detail via the
      // useEntitySync('form') subscription — a direct loadForm() here would
      // double-fetch (direct + listener). Also fixes the missing list
      // invalidation (responses count went stale on /forms before).
      notifyEntityMutated('form', { formId: id })
      if (isTeacher) { setAnalytics(null); if (teacherTab === 'analytics') loadAnalytics() }
    } catch (err: any) {
      const msg = (err as any)?.response?.data?.error || 'Failed to submit'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleExtend = async () => {
    const days = parseInt(extendDays) || 7
    const newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + days)

    try {
      await formAPI.extend(id!, newExpiry.toISOString())
      toast.success(`Extended by ${days} days`)
      // Same listener-owns-refetch as handleSubmit (direct load = 2× GET).
      notifyEntityMutated('form', { formId: id })
    } catch (err) {
      toast.error('Failed to extend')
    }
  }

  const startEditFields = () => {
    setEditFields(form.fields.map((f: any) => {
      let options: string[] = []
      try {
        const raw = typeof f.options === 'string' ? JSON.parse(f.options || '[]') : (f.options || [])
        options = Array.isArray(raw) ? raw.map((o: any) => (typeof o === 'string' ? o : String(o?.label ?? o?.value ?? ''))).filter(Boolean) : []
      } catch { options = [] }
      let logic: any = {}
      try { logic = typeof (f as any).logic === 'string' ? JSON.parse((f as any).logic || '{}') : ((f as any).logic || {}) } catch { logic = {} }
      const asSingle = (v: any): { field: string; value: string } => {
        const c = Array.isArray(v) ? v[0] : v
        if (!c || typeof c !== 'object') return { field: '', value: '' }
        return { field: String(c.fieldId ?? c.field ?? ''), value: String(c.equals ?? '') }
      }
      const show = asSingle(logic.showIf)
      const hide = asSingle(logic.hideIf)
      const req = asSingle(logic.requireIf)
      const jumps = Array.isArray(logic.jumpTo) ? logic.jumpTo : logic.jumpTo ? [logic.jumpTo] : []
      let scoreMap: Record<string, number> = {}
      try { scoreMap = typeof (f as any).scoreMap === 'string' ? JSON.parse((f as any).scoreMap || '{}') : ((f as any).scoreMap || {}) } catch { scoreMap = {} }
      // Merge inline {label,points} options into the points editor.
      try {
        const rawOpts = typeof f.options === 'string' ? JSON.parse(f.options || '[]') : (f.options || [])
        if (Array.isArray(rawOpts)) {
          for (const o of rawOpts) {
            if (o && typeof o === 'object' && (o as any).label && Number.isFinite(Number((o as any).points)) && (scoreMap as any)[(o as any).label] === undefined) {
              (scoreMap as any)[(o as any).label] = Number((o as any).points)
            }
          }
        }
      } catch { /* ignore */ }
      return {
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options,
        optionPoints: scoreMap,
        showIfField: show.field, showIfValue: show.value,
        hideIfField: hide.field, hideIfValue: hide.value,
        requireIfField: req.field, requireIfValue: req.value,
        jumpRules: jumps.filter((r: any) => r && typeof r === 'object' && r.to).map((r: any) => ({
          equals: String(r.equals ?? r.contains ?? ''),
          to: String(r.to ?? ''),
        })),
      }
    }))
    setExpandedEditLogic({})
    setEditingFields(true)
  }

  const addEditField = () => {
    setEditFields([...editFields, { label: '', type: 'TEXT', required: false, options: [], optionPoints: {}, showIfField: '', showIfValue: '', hideIfField: '', hideIfValue: '', requireIfField: '', requireIfValue: '', jumpRules: [] }])
  }

  const updateEditField = (index: number, updates: any) => {
    const updated = [...editFields]
    const next = { ...updated[index], ...updates }
    if (updates.options !== undefined && next.optionPoints) {
      const keep = new Set((Array.isArray(updates.options) ? updates.options : []).map((o: any) => String(o ?? '').trim()).filter(Boolean))
      const pruned: Record<string, number> = {}
      for (const [k, v] of Object.entries(next.optionPoints as Record<string, unknown>)) {
        if (keep.has(k)) pruned[k] = v as number
      }
      next.optionPoints = pruned
    }
    updated[index] = next
    setEditFields(updated)
  }

  const updateEditOptionPoints = (index: number, option: string, points: string) => {
    const updated = [...editFields]
    const prev = { ...(((updated[index] as any).optionPoints || {}) as Record<string, unknown>) }
    if (points === '' || !Number.isFinite(Number(points))) delete prev[option]
    else prev[option] = Math.max(-10000, Math.min(10000, Number(points)))
    updated[index] = { ...updated[index], optionPoints: prev }
    setEditFields(updated)
  }

  const updateEditJumpRule = (index: number, ruleIdx: number, patch: any) => {
    const updated = [...editFields]
    const rules = [...((((updated[index] as any).jumpRules || []) as any[]))]
    rules[ruleIdx] = { ...rules[ruleIdx], ...patch }
    updated[index] = { ...updated[index], jumpRules: rules }
    setEditFields(updated)
  }

  const addEditJumpRule = (index: number) => {
    const updated = [...editFields]
    const rules = [...((((updated[index] as any).jumpRules || []) as any[]))]
    if (rules.length >= 10) return
    rules.push({ equals: '', to: '' })
    updated[index] = { ...updated[index], jumpRules: rules }
    setEditFields(updated)
  }

  const removeEditJumpRule = (index: number, ruleIdx: number) => {
    const updated = [...editFields]
    updated[index] = {
      ...updated[index],
      jumpRules: ((((updated[index] as any).jumpRules || []) as any[])).filter((_: any, i: number) => i !== ruleIdx),
    }
    setEditFields(updated)
  }

  const removeEditField = (index: number) => {
    if (editFields.length <= 1) return
    setEditFields(editFields.filter((_: any, i: number) => i !== index))
  }

  const saveFields = async () => {
    const valid = editFields
      .map((f: any, i: number) => ({ f, i }))
      .filter(({ f }: any) => String(f?.label ?? '').trim())
    if (valid.length === 0) {
      toast.error('Need at least one field')
      return
    }
    setSavingFields(true)
    try {
      // #9: ship logic + scoring; keep old ids so backend can remap refs,
      // mint tmp clientIds for brand-new rows.
      const payload = valid.map(({ f, i }: any) => {
        const options: string[] = Array.isArray(f.options)
          ? f.options.map((o: any) => String(o ?? '').trim()).filter(Boolean)
          : []
        const scoreMap: Record<string, number> = {}
        const pts = (f.optionPoints && typeof f.optionPoints === 'object' ? f.optionPoints : {}) as Record<string, unknown>
        for (const opt of options) {
          const n = Number((pts as any)[opt])
          if (Number.isFinite(n) && n !== 0) scoreMap[opt] = Math.max(-10000, Math.min(10000, n))
        }
        const logic: any = {}
        if (f.showIfField && String(f.showIfValue ?? '').trim()) logic.showIf = [{ field: f.showIfField, equals: String(f.showIfValue).trim() }]
        if (f.hideIfField && String(f.hideIfValue ?? '').trim()) logic.hideIf = [{ field: f.hideIfField, equals: String(f.hideIfValue).trim() }]
        if (f.requireIfField && String(f.requireIfValue ?? '').trim()) logic.requireIf = [{ field: f.requireIfField, equals: String(f.requireIfValue).trim() }]
        const jumps = Array.isArray(f.jumpRules) ? f.jumpRules.filter((r: any) => String(r?.equals ?? '').trim() && r?.to) : []
        if (jumps.length > 0) logic.jumpTo = jumps.map((r: any) => ({ equals: String(r.equals).trim(), to: r.to }))
        return {
          ...(f.id && !String(f.id).startsWith('tmp-') ? { id: f.id } : { clientId: `tmp-edit-${i}` }),
          label: String(f.label).trim(),
          type: f.type || 'TEXT',
          required: !!f.required,
          options,
          ...(Object.keys(scoreMap).length > 0 ? { scoreMap } : {}),
          ...((logic.showIf || logic.hideIf || logic.requireIf || logic.jumpTo) ? { logic } : {}),
        }
      })
      await formAPI.updateFields(id!, payload)
      toast.success('Fields updated!')
      setEditingFields(false)
      setExpandedEditLogic({})
      setAnalytics(null)
      // Same listener-owns-refetch as handleSubmit (direct load = 2× GET).
      notifyEntityMutated('form', { formId: id })
    } catch (err) {
      toast.error('Failed to update fields')
    } finally {
      setSavingFields(false)
    }
  }

  const getFieldIcon = (type: string) => {
    switch (type) {
      case 'TEXT': return '📝'
      case 'TEXTAREA': return '📄'
      case 'SELECT': return '📋'
      case 'RADIO': return '🔘'
      case 'CHECKBOX': return '☑️'
      case 'NUMBER': return '🔢'
      case 'EMAIL': return '📧'
      case 'DATE': return '📅'
      case 'RATING': return '⭐'
      default: return '📝'
    }
  }

  if (loading) {
    return <CenteredLoader text="Loading form..." />
  }

  if (!form) return null

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<ClipboardList size={18} />}
        eyebrow="Form · Detail"
        title={<>Form Detail</>}
        subtitle="Responses, analytics and submissions — everything in one place."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/forms')} className="p-2 rounded-xl bg-surface-100 dark:bg-night-700 hover:bg-surface-200 transition-all">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">{form.title}</h1>
          {form.description && <p className="text-surface-500 dark:text-night-400 text-sm mt-1">{form.description}</p>}
        </div>
        <div className="flex gap-2">
          {isTeacher && (
            <button
              onClick={() => formAPI.exportOne(form.id, `${form.title.replace(/\s+/g, '_')}_responses.xlsx`)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl hover:bg-surface-200 text-sm font-medium"
            >
              <Download size={14} /> Export
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {isTeacher ? (
            /* Teacher View: Responses + Analytics tabs */
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-surface-900 dark:text-night-50">
                  {teacherTab === 'responses' ? `Responses (${form.responses.length})` : 'Analytics'}
                </h2>
                <div className="flex gap-1 p-1 bg-surface-100 dark:bg-night-700 rounded-xl" role="tablist" aria-label="Teacher view">
                  <button
                    role="tab"
                    aria-selected={teacherTab === 'responses'}
                    onClick={() => setTeacherTab('responses')}
                    className={clsx('px-3 py-1 rounded-lg text-xs font-semibold transition-colors', teacherTab === 'responses' ? 'bg-white dark:bg-night-800 shadow text-surface-900 dark:text-night-50' : 'text-surface-500 dark:text-night-400')}
                  >
                    Responses
                  </button>
                  <button
                    role="tab"
                    aria-selected={teacherTab === 'analytics'}
                    onClick={() => setTeacherTab('analytics')}
                    className={clsx('px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1', teacherTab === 'analytics' ? 'bg-white dark:bg-night-800 shadow text-surface-900 dark:text-night-50' : 'text-surface-500 dark:text-night-400')}
                  >
                    <BarChart2 size={12} /> Analytics
                  </button>
                </div>
              </div>
              {teacherTab === 'responses' ? (
              form.responses.length === 0 ? (
                <p className="text-surface-400 dark:text-night-400 text-sm">No responses yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 dark:border-night-600">
                        <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Roll No</th>
                        <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Student</th>
                        {form.fields.map((f: any) => (
                          <th key={f.id} className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">{f.label}</th>
                        ))}
                        {maxScore > 0 && (
                          <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Score</th>
                        )}
                        <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.responses.map((resp: any) => {
                        let answersData: any = {}
                        try { answersData = typeof resp.answers === 'string' ? JSON.parse(resp.answers) : (resp.answers || {}) } catch { answersData = {} }
                        return (
                          <tr key={resp.id} className="border-b border-surface-50 dark:border-night-600">
                            <td className="py-2 font-mono text-xs text-surface-600 dark:text-night-300">{resp.user.studentId || '-'}</td>
                            <td className="py-2">
                              <p className="font-medium text-surface-900 dark:text-night-50">{resp.user.name}</p>
                              <p className="text-xs text-surface-400 dark:text-night-400">{resp.user.email}</p>
                            </td>
                            {form.fields.map((f: any) => (
                              <td key={f.id} className="py-2 text-surface-600 dark:text-night-300">
                                {answersData[f.id] || '-'}
                              </td>
                            ))}
                            {maxScore > 0 && (
                              <td className="py-2 font-bold text-surface-900 dark:text-night-50">
                                {typeof resp.score === 'number' ? resp.score : '–'}
                              </td>
                            )}
                            <td className="py-2 text-xs text-surface-400 dark:text-night-400">
                              {new Date(resp.submittedAt).toLocaleDateString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
              ) : (
              /* Analytics tab: drop-off + time + scores */
              <div className="space-y-4">
                {analyticsLoading && !analytics ? (
                  <p className="text-sm text-surface-500 dark:text-night-400">Loading analytics…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-4 rounded-xl bg-surface-50 dark:bg-night-700 border border-surface-100 dark:border-night-600">
                        <p className="text-xs font-semibold text-surface-500 dark:text-night-400 flex items-center gap-1"><Timer size={12} /> Median time</p>
                        <p className="text-xl font-bold text-surface-900 dark:text-night-50 mt-1">
                          {formatDurationMs(analytics?.time?.medianMs ?? null)}
                        </p>
                        <p className="text-[11px] text-surface-400 dark:text-night-400 mt-0.5">
                          {analytics?.time?.count ? `avg ${formatDurationMs(analytics.time.avgMs)} · ${analytics.time.count} timed` : 'No timing data yet'}
                        </p>
                      </div>
                      <div className="p-4 rounded-xl bg-surface-50 dark:bg-night-700 border border-surface-100 dark:border-night-600">
                        <p className="text-xs font-semibold text-surface-500 dark:text-night-400 flex items-center gap-1"><Award size={12} /> Score</p>
                        <p className="text-xl font-bold text-surface-900 dark:text-night-50 mt-1">
                          {analytics?.scores?.count ? `avg ${analytics.scores.avg}` : maxScore > 0 ? `0 / ${maxScore}` : 'Unscored'}
                        </p>
                        <p className="text-[11px] text-surface-400 dark:text-night-400 mt-0.5">
                          {analytics?.scores?.count
                            ? `median ${analytics.scores.median} · min ${analytics.scores.min} · max ${analytics.scores.max}${analytics?.scores?.maxScore ? ` / ${analytics.scores.maxScore}` : ''}`
                            : maxScore > 0 ? `max ${maxScore} pts · no responses yet` : 'Add per-option points to score'}
                        </p>
                      </div>
                      <div className="p-4 rounded-xl bg-surface-50 dark:bg-night-700 border border-surface-100 dark:border-night-600">
                        <p className="text-xs font-semibold text-surface-500 dark:text-night-400 flex items-center gap-1"><BarChart2 size={12} /> Responses</p>
                        <p className="text-xl font-bold text-surface-900 dark:text-night-50 mt-1">{analytics?.totalResponses ?? form.responses.length}</p>
                        <p className="text-[11px] text-surface-400 dark:text-night-400 mt-0.5">
                          {analytics?.viewsDegraded ? 'views estimated (migration pending)' : `${form.fields.length} questions`}
                        </p>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 mb-2">Drop-off per question</h3>
                      <div className="space-y-2">
                        {(analytics?.dropoff || localDropoff).map((row: any) => (
                          <div key={row.fieldId} className="p-3 rounded-xl border border-surface-100 dark:border-night-600">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="font-medium text-surface-700 dark:text-night-200 truncate">{row.label}</span>
                              <span className="text-xs text-surface-400 dark:text-night-400 shrink-0">
                                {row.answered}/{row.views} answered · {row.dropoffRate}% drop-off
                              </span>
                            </div>
                            <div className="mt-1.5 h-2 rounded-full bg-surface-100 dark:bg-night-700 overflow-hidden" role="progressbar" aria-valuenow={row.answerRate} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.label} answer rate`}>
                              <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, row.answerRate))}%` }} />
                            </div>
                          </div>
                        ))}
                        {(analytics?.dropoff || localDropoff).length === 0 && (
                          <p className="text-xs text-surface-400 dark:text-night-400">No questions yet.</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              )}
            </div>
          ) : (
            /* Student View: Fill Form */
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
              {submitted && (
                <div className="mb-4 p-3 bg-primary-50 rounded-xl border border-primary-200 flex items-center gap-2">
                  <CheckCircle size={18} className="text-primary-500" />
                  <span className="text-sm text-primary-700 font-medium">You've already submitted. You can update your response.</span>
                </div>
              )}

              {!isEligible && (
                <div className="mb-4 p-3 bg-danger-50 rounded-xl border border-danger-200 flex items-center gap-2">
                  <span className="text-sm text-danger-700 font-medium">You are not eligible to respond to this form.</span>
                </div>
              )}

              <div className="space-y-4">
                {maxScore > 0 && (
                  <div className="p-3 bg-accent-50 dark:bg-night-700 rounded-xl border border-accent-200 dark:border-night-600 flex items-center gap-2" aria-live="polite">
                    <Award size={16} className="text-accent-600 shrink-0" />
                    <span className="text-xs font-medium text-surface-700 dark:text-night-200">
                      Live score: <strong>{liveScore}</strong> / {maxScore}
                      {hiddenCount > 0 && ` · ${hiddenCount} question${hiddenCount === 1 ? '' : 's'} skipped by logic`}
                    </span>
                  </div>
                )}
                {visibleFieldRows.map((field: any) => {
                  const logicField = (logicFields as any[]).find((lf: any) => lf.id === field.id)
                  const liveRequired = (() => { try { return isFieldRequiredLive(logicField, answers as any) } catch { return !!field.required } })()
                  const opts = parseFieldOptions({ options: field.options } as any)
                  return (
                  <div key={field.id}>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">
                      {field.label}
                      {liveRequired && <span className="text-danger-500 ml-1">*</span>}
                    </label>
                    
                    {field.type === 'TEXT' && (
                      <input
                        type="text"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                      />
                    )}
                    
                    {field.type === 'TEXTAREA' && (
                      <textarea
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm h-24"
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                      />
                    )}
                    
                    {field.type === 'NUMBER' && (
                      <input
                        type="number"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                        placeholder="Enter number"
                      />
                    )}
                    
                    {field.type === 'EMAIL' && (
                      <input
                        type="email"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                        placeholder="Enter email"
                      />
                    )}
                    
                    {field.type === 'DATE' && (
                      <input
                        type="date"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                      />
                    )}
                    
                    {field.type === 'SELECT' && (
                      <select
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                      >
                        <option value="">Select...</option>
                        {opts.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    )}
                    
                    {field.type === 'RADIO' && (
                      <div className="space-y-2">
                        {opts.map((opt: string) => (
                          <label key={opt} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={field.id}
                              value={opt}
                              checked={answers[field.id] === opt}
                              onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                              className="text-primary-500"
                            />
                            <span className="text-sm text-surface-700 dark:text-night-200">{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    
                    {field.type === 'CHECKBOX' && (
                      <div className="space-y-2">
                        {opts.map((opt: string) => (
                          <label key={opt} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(answers[field.id] || '').includes(opt)}
                              onChange={(e) => {
                                const current = answers[field.id] || ''
                                const updated = e.target.checked
                                  ? (current ? current + ', ' + opt : opt)
                                  : current.split(',').map((s: string) => s.trim()).filter((s: string) => s && s !== opt).join(', ')
                                setAnswers({ ...answers, [field.id]: updated })
                              }}
                              className="text-primary-500 rounded"
                            />
                            <span className="text-sm text-surface-700 dark:text-night-200">{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {(field.type === 'RATING' || field.type === 'SCALE') && (
                      <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setAnswers({ ...answers, [field.id]: String(n) })}
                            aria-label={`Rate ${n}`}
                            aria-pressed={String(answers[field.id] || '') === String(n)}
                            className={clsx('w-9 h-9 rounded-xl border text-sm font-bold transition-colors', String(answers[field.id] || '') === String(n) ? 'bg-amber-400 border-amber-400 text-white' : 'border-surface-200 dark:border-night-600 text-surface-500')}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>

              {isExpired && !submitted ? (
                <div className="mt-6 p-4 bg-danger-50 rounded-xl text-center">
                  <Clock size={24} className="mx-auto text-danger-500 mb-2" />
                  <p className="text-sm font-medium text-danger-700">Form has expired</p>
                  <p className="text-xs text-danger-500">Expired on {new Date(form.expiresAt).toLocaleString()}</p>
                </div>
              ) : !isEligible ? (
                <div className="mt-6 p-4 bg-danger-50 rounded-xl text-center">
                  <p className="text-sm font-medium text-danger-700">You are not eligible to respond to this form</p>
                </div>
              ) : !submitted || form.allowEdit ? (
                <button
                  onClick={handleSubmit}
                  disabled={submitting || isExpired}
                  className="mt-6 w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {submitted ? 'Update Response' : 'Submit Response'}
                </button>
              ) : (
                <div className="mt-6 p-4 bg-surface-50 dark:bg-night-800 rounded-xl text-center">
                  <CheckCircle size={24} className="mx-auto text-primary-500 mb-2" />
                  <p className="text-sm font-medium text-surface-700 dark:text-night-200">You've already submitted</p>
                  <p className="text-xs text-surface-400 dark:text-night-400">Editing is not allowed for this form</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
            <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Form Info</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Fields</span>
                <span className="font-bold text-surface-900 dark:text-night-50">{form.fields.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Responses</span>
                <span className="font-bold text-surface-900 dark:text-night-50">{form.responses.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Created by</span>
                <span className="font-medium text-surface-700 dark:text-night-200">{form.creator.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Created</span>
                <span className="text-surface-700 dark:text-night-200">{new Date(form.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Edit responses</span>
                <span className={clsx('font-medium', form.allowEdit ? 'text-primary-600' : 'text-danger-500')}>
                  {form.allowEdit ? 'Allowed' : 'Locked'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Expires</span>
                {form.expiresAt ? (
                  <span className={clsx('font-medium text-xs', isExpired ? 'text-danger-500' : 'text-warning-600')}>
                    {isExpired ? 'Expired' : new Date(form.expiresAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="font-medium text-surface-400 dark:text-night-400 text-xs">Never</span>
                )}
              </div>
            </div>
          </div>

          {/* Targeting Badges */}
          {form.eligibilityEnabled && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Target Audience</h3>
              <div className="space-y-3">
                {targetDeptNames.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <GraduationCap size={14} className="text-accent-500 shrink-0" />
                    <span className="text-xs font-semibold text-surface-500 dark:text-night-400">Departments:</span>
                    {targetDeptNames.map(name => (
                      <span key={name} className="px-2 py-0.5 bg-accent-100 text-accent-700 rounded-lg text-xs font-bold">{name}</span>
                    ))}
                  </div>
                )}
                {targetYearsList.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <BookOpen size={14} className="text-primary-500 shrink-0" />
                    <span className="text-xs font-semibold text-surface-500 dark:text-night-400">Years:</span>
                    {targetYearsList.sort().map(y => (
                      <span key={y} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-lg text-xs font-bold">Year {y}</span>
                    ))}
                  </div>
                )}
                {targetDeptNames.length === 0 && targetYearsList.length === 0 && (
                  <p className="text-xs text-surface-500 dark:text-night-400">Open to all departments and years</p>
                )}
              </div>
            </div>
          )}

          {form.formRooms && form.formRooms.length > 0 && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Linked Rooms</h3>
              <div className="flex flex-wrap gap-2">
                {form.formRooms.map((fr: any) => (
                  <span key={fr.room.id} className="px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                    🏠 {fr.room.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-surface-900 dark:text-night-50">Form Fields</h3>
                {!editingFields ? (
                  <button onClick={startEditFields} className="text-xs font-semibold text-primary-600 hover:text-primary-700">Edit</button>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={() => setEditingFields(false)} className="text-xs font-semibold text-surface-500 hover:text-surface-700 dark:text-night-200">Cancel</button>
                    <button onClick={saveFields} disabled={savingFields} className="text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50">
                      {savingFields ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {editingFields ? (
                <div className="space-y-2">
                  {editFields.map((field: any, i: number) => (
                    <div key={i} className="p-2.5 bg-surface-50 dark:bg-night-800 rounded-xl border border-surface-100 dark:border-night-600">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-sm">{getFieldIcon(field.type)}</span>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateEditField(i, { label: e.target.value })}
                          className="flex-1 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs"
                          placeholder="Field label"
                        />
                        <button onClick={() => removeEditField(i)} disabled={editFields.length <= 1} className="text-danger-400 hover:text-danger-600 text-xs disabled:opacity-30">✕</button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={field.type}
                          onChange={(e) => updateEditField(i, { type: e.target.value })}
                          className="px-1.5 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs"
                        >
                          <option value="TEXT">Text</option>
                          <option value="TEXTAREA">Long Text</option>
                          <option value="NUMBER">Number</option>
                          <option value="EMAIL">Email</option>
                          <option value="DATE">Date</option>
                          <option value="SELECT">Dropdown</option>
                          <option value="RADIO">Radio</option>
                          <option value="CHECKBOX">Checkbox</option>
                          <option value="RATING">Rating</option>
                        </select>
                        <label className="flex items-center gap-0.5 text-xs">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) => updateEditField(i, { required: e.target.checked })}
                            className="rounded"
                          />
                          Req
                        </label>
                      </div>
                      {(field.type === 'SELECT' || field.type === 'RADIO' || field.type === 'CHECKBOX') && (
                        <>
                          <input
                            type="text"
                            value={field.options?.join(', ') || ''}
                            onChange={(e) => updateEditField(i, { options: e.target.value.split(',').map((o: string) => o.trim()).filter(Boolean) })}
                            className="w-full mt-1.5 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs"
                            placeholder="Options (comma separated)"
                          />
                          {(field.options || []).filter(Boolean).length > 0 && (
                            <div className="mt-1 space-y-1">
                              {(field.options || []).filter(Boolean).map((opt: string) => (
                                <div key={opt} className="flex items-center gap-2">
                                  <span className="flex-1 truncate text-[11px] text-surface-500 dark:text-night-400">{opt}</span>
                                  <input
                                    type="number"
                                    value={(field.optionPoints?.[opt] ?? '') as any}
                                    onChange={(e) => updateEditOptionPoints(i, opt, e.target.value)}
                                    className="w-16 px-1.5 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px]"
                                    placeholder="pts"
                                    aria-label={`Points for ${opt}`}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedEditLogic((prev) => ({ ...prev, [i]: !prev[i] }))}
                        className="mt-1.5 text-[11px] font-semibold text-primary-600 hover:underline"
                      >
                        {expandedEditLogic[i] ? 'Hide logic ▴' : 'Logic ▾'}
                      </button>
                      {expandedEditLogic[i] && (
                        <div className="mt-1 space-y-1.5 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 p-1.5">
                          {[
                            { title: 'Show if', fk: 'showIfField', vk: 'showIfValue', pool: 'prev' },
                            { title: 'Hide if', fk: 'hideIfField', vk: 'hideIfValue', pool: 'prev' },
                            { title: 'Require if', fk: 'requireIfField', vk: 'requireIfValue', pool: 'prev' },
                          ].map((row: any) => (
                            <div key={row.fk} className="flex items-center gap-1">
                              <span className="text-[10px] text-surface-400 w-14 shrink-0">{row.title}</span>
                              <select
                                value={(field as any)[row.fk] || ''}
                                onChange={(e) => updateEditField(i, { [row.fk]: e.target.value })}
                                className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px]"
                              >
                                <option value="">Never</option>
                                {editFields.slice(0, i).map((prev: any, pi: number) => (
                                  <option key={pi} value={prev.id || `tmp-edit-${pi}`}>
                                    {String(prev.label || `Q${pi + 1}`).slice(0, 20) || `Q${pi + 1}`}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={(field as any)[row.vk] || ''}
                                onChange={(e) => updateEditField(i, { [row.vk]: e.target.value })}
                                disabled={!(field as any)[row.fk]}
                                className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px] disabled:opacity-40"
                                placeholder="is…"
                              />
                            </div>
                          ))}
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-surface-400">Jump if answer…</p>
                            {(((field as any).jumpRules || []) as any[]).map((rule: any, ri: number) => (
                              <div key={ri} className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={rule.equals || ''}
                                  onChange={(e) => updateEditJumpRule(i, ri, { equals: e.target.value })}
                                  className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px]"
                                  placeholder="equals…"
                                />
                                <span className="text-[10px]">→</span>
                                <select
                                  value={rule.to || ''}
                                  onChange={(e) => updateEditJumpRule(i, ri, { to: e.target.value })}
                                  className="flex-1 px-1 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-[11px]"
                                >
                                  <option value="">…</option>
                                  {editFields.slice(i + 1).map((next: any, ni: number) => (
                                    <option key={ni} value={next.id || `tmp-edit-${i + 1 + ni}`}>
                                      {String(next.label || `Q${i + 2 + ni}`).slice(0, 20) || `Q${i + 2 + ni}`}
                                    </option>
                                  ))}
                                  <option value="__END__">End</option>
                                </select>
                                <button type="button" onClick={() => removeEditJumpRule(i, ri)} className="text-danger-400 text-[11px]">✕</button>
                              </div>
                            ))}
                            <button type="button" onClick={() => addEditJumpRule(i)} className="text-[11px] font-semibold text-primary-600 hover:underline">+ Jump</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <button onClick={addEditField} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg">
                    <Plus size={12} /> Add Field
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {form.fields.map((field: any) => {
                    let logicBadge = ''
                    try {
                      const l = parseFieldLogic({ logic: (field as any).logic } as any)
                      const parts: string[] = []
                      if ((l as any).showIf) parts.push('show-if')
                      if ((l as any).hideIf) parts.push('hide-if')
                      if ((l as any).requireIf) parts.push('req-if')
                      const jumps = Array.isArray((l as any).jumpTo) ? (l as any).jumpTo : (l as any).jumpTo ? [1] : []
                      if (jumps.length) parts.push(`jump×${jumps.length}`)
                      if (Object.keys(parseScoreMap({ scoreMap: (field as any).scoreMap } as any)).length) parts.push('scored')
                      logicBadge = parts.join(' · ')
                    } catch { logicBadge = '' }
                    return (
                    <div key={field.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs">{getFieldIcon(field.type)}</span>
                        <span className="text-surface-600 dark:text-night-300 truncate">{field.label}</span>
                        {field.required && <span className="text-danger-500 text-xs">*</span>}
                        {logicBadge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-600 font-semibold">{logicBadge}</span>}
                      </div>
                      <span className="text-xs text-surface-400 dark:text-night-400 shrink-0">{field.type}</span>
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {isTeacher && form.expiresAt && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3 flex items-center gap-2">
                <Clock size={16} /> Extend Expiry
              </h3>
              <div className="flex gap-2">
                <select
                  value={extendDays}
                  onChange={(e) => setExtendDays(e.target.value)}
                  className="flex-1 px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
                <button
                  onClick={handleExtend}
                  className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 flex items-center gap-1"
                >
                  <Plus size={14} /> Extend
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
